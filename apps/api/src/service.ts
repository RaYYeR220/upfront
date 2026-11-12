import { createHash, randomUUID } from "node:crypto";
import type { Client } from "@libsql/client";
import type { Policy } from "@upfront/core";
import { evidenceBudgetUsd } from "@upfront/core";
import { applyReview, type CheckOutcome, type CheckResult, type EngineDeps, REPPO_CREDITS_PER_USD, runCheck } from "@upfront/engine";
import { awaitReview } from "@upfront/reppo";
import type { Hub } from "./hub.ts";
import { checksByIpLastDay, finishCheck, getCheck, houseSpentLastDay, insertCheck, insertReceipt } from "./repo.ts";

export interface ServiceCtx {
  db: Client;
  hub: Hub;
  engine: Omit<EngineDeps, "emit">;
  limits: { checksPerIpPerDay: number; houseDailyCapUsd: number };
  salt: string;
  review: { mode: "async" | "skip"; timeoutMs: number; pollMs: number };
}

export type StartResult = { checkId: string } | { error: "demo_quota" | "house_budget" | "busy" };

export const ipHash = (ip: string | null, salt: string) =>
  ip ? createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32) : null;

/** At most this many checks pay for evidence at the same time. */
const MAX_RUNNING = 4;

export class CheckService {
  private running = new Map<string, Promise<void>>();
  /** Budget reserved by checks that are still running (their maximum evidence spend). */
  private reservedUsd = new Map<string, number>();
  private gate: Promise<void> = Promise.resolve();
  constructor(private ctx: ServiceCtx) {}

  /** Serializes admission so two requests can't both pass the quota and budget checks. */
  private async admit<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.gate;
    let release!: () => void;
    this.gate = new Promise((r) => (release = r));
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  async start(req: {
    query: string;
    amountEur: number;
    netDaysRequested?: number;
    policy: Policy;
    ip: string | null;
    unlimited?: boolean;
    /** Daily checks allowed for this caller's bucket; defaults to the per-visitor limit. */
    quota?: number;
    /** Public checks appear in the recent-checks feed; everything else is reachable only by its unguessable id. */
    visibility?: "public" | "private";
  }): Promise<StartResult> {
    const { db } = this.ctx;
    // A missing address shares one bucket: no address never means no limit.
    const hash = ipHash(req.ip ?? "unknown", this.ctx.salt);
    // Worst case for one check: the search, plus the full evidence budget.
    const reserve = evidenceBudgetUsd(req.amountEur) + 0.01;
    const admitted = await this.admit(async (): Promise<StartResult> => {
      if (!req.unlimited) {
        if (this.running.size >= MAX_RUNNING) return { error: "busy" };
        if (hash && (await checksByIpLastDay(db, hash)) >= (req.quota ?? this.ctx.limits.checksPerIpPerDay)) return { error: "demo_quota" };
        const reserved = [...this.reservedUsd.values()].reduce((s, x) => s + x, 0);
        if ((await houseSpentLastDay(db)) + reserved + reserve > this.ctx.limits.houseDailyCapUsd) return { error: "house_budget" };
      }
      const checkId = randomUUID();
      await insertCheck(db, {
        id: checkId,
        query: req.query,
        amountEur: req.amountEur,
        policy: req.policy,
        ipHash: hash,
        payer: "house",
        visibility: req.visibility ?? "private",
      });
      this.reservedUsd.set(checkId, reserve);
      this.running.set(checkId, Promise.resolve());
      return { checkId };
    });
    if ("error" in admitted) return admitted;
    const { checkId } = admitted;
    this.ctx.hub.publish(checkId, { event: "start", data: { checkId, query: req.query, amountEur: req.amountEur, policy: { id: req.policy.id, version: req.policy.version } } });
    const run = this.run(checkId, req).finally(() => {
      this.running.delete(checkId);
      this.reservedUsd.delete(checkId);
    });
    this.running.set(checkId, run);
    return { checkId };
  }

  /** Resolves when the check (and its inline steps) has finished. Used by tests and the CLI. */
  wait(checkId: string): Promise<void> {
    return this.running.get(checkId) ?? Promise.resolve();
  }

  private async run(checkId: string, req: { query: string; amountEur: number; netDaysRequested?: number; policy: Policy }) {
    const { db, hub } = this.ctx;
    const writes: Promise<void>[] = [];
    let outcome: CheckOutcome;
    try {
      outcome = await runCheck(
        {
          checkId,
          query: req.query,
          amountEur: req.amountEur,
          netDaysRequested: req.netDaysRequested,
          policy: req.policy,
          review: this.ctx.engine.reppo ? this.ctx.review.mode : "skip",
        },
        {
          ...this.ctx.engine,
          emit: (e) => {
            if (e.type === "receipt") writes.push(insertReceipt(db, e.receipt, { checkId }));
            hub.publish(checkId, { event: e.type, data: e.type === "node" ? e.node : e.type === "receipt" ? e.receipt : e.review });
          },
        },
      );
    } catch (e) {
      console.error(`check ${checkId} failed`, e);
      await Promise.allSettled(writes);
      await finishCheck(db, checkId, { status: "error", error: "internal_error" });
      hub.publish(checkId, { event: "outcome", data: { kind: "error", error: "internal_error" } });
      hub.close(checkId);
      return;
    }

    await Promise.allSettled(writes);
    if (outcome.kind !== "done") {
      await finishCheck(db, checkId, { status: outcome.kind, candidates: outcome.kind === "needs_choice" ? outcome.candidates : undefined });
      hub.publish(checkId, { event: "outcome", data: outcome });
      hub.close(checkId);
      return;
    }

    const result = outcome.result;
    await finishCheck(db, checkId, { status: "done", result });
    hub.publish(checkId, { event: "outcome", data: { kind: "done", result } });

    const evalId = result.review?.status === "pending" ? result.review.evalId : undefined;
    if (evalId && this.ctx.engine.reppo) {
      void this.finishReview(result, evalId);
    } else {
      hub.close(checkId);
    }
  }

  private async finishReview(result: CheckResult, evalId: string) {
    const { db, hub } = this.ctx;
    try {
      const review = await awaitReview(this.ctx.engine.reppo!, evalId, { timeoutMs: this.ctx.review.timeoutMs, pollMs: this.ctx.review.pollMs });
      const updated = applyReview(result, review);
      updated.costs = { ...updated.costs, reviewUsd: (review.creditsCharged ?? 0) / REPPO_CREDITS_PER_USD };
      await finishCheck(db, result.checkId, { status: "done", result: updated });
      hub.publish(result.checkId, { event: "review", data: { review, final: updated.final, finalReasons: updated.finalReasons, reviewed: updated.reviewed } });
    } catch (e) {
      console.error(`review for ${result.checkId} failed`, e);
      const failed = { ...result, review: { status: "failed" as const, evalId, reason: "review_unavailable" }, reviewed: false };
      await finishCheck(db, result.checkId, { status: "done", result: failed }).catch(() => {});
      hub.publish(result.checkId, { event: "review", data: { review: failed.review, final: failed.final, finalReasons: failed.finalReasons, reviewed: false } });
    } finally {
      hub.close(result.checkId);
    }
  }

  async get(checkId: string) {
    return getCheck(this.ctx.db, checkId);
  }
}
