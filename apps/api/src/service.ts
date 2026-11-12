import { createHash, randomUUID } from "node:crypto";
import type { Client } from "@libsql/client";
import type { Policy } from "@upfront/core";
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

export type StartResult = { checkId: string } | { error: "demo_quota" | "house_budget" };

export const ipHash = (ip: string | null, salt: string) =>
  ip ? createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32) : null;

export class CheckService {
  private running = new Map<string, Promise<void>>();
  constructor(private ctx: ServiceCtx) {}

  async start(req: {
    query: string;
    amountEur: number;
    netDaysRequested?: number;
    policy: Policy;
    ip: string | null;
    unlimited?: boolean;
  }): Promise<StartResult> {
    const { db } = this.ctx;
    const hash = ipHash(req.ip, this.ctx.salt);
    if (!req.unlimited) {
      if (hash && (await checksByIpLastDay(db, hash)) >= this.ctx.limits.checksPerIpPerDay) return { error: "demo_quota" };
      if ((await houseSpentLastDay(db)) >= this.ctx.limits.houseDailyCapUsd) return { error: "house_budget" };
    }
    const checkId = randomUUID();
    await insertCheck(db, { id: checkId, query: req.query, amountEur: req.amountEur, policy: req.policy, ipHash: hash, payer: "house" });
    this.ctx.hub.publish(checkId, { event: "start", data: { checkId, query: req.query, amountEur: req.amountEur, policy: { id: req.policy.id, version: req.policy.version } } });
    const run = this.run(checkId, req).finally(() => this.running.delete(checkId));
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
      await Promise.allSettled(writes);
      await finishCheck(db, checkId, { status: "error", error: String(e) });
      hub.publish(checkId, { event: "outcome", data: { kind: "error", error: String(e) } });
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
    const review = await awaitReview(this.ctx.engine.reppo!, evalId, { timeoutMs: this.ctx.review.timeoutMs, pollMs: this.ctx.review.pollMs });
    const updated = applyReview(result, review);
    updated.costs = { ...updated.costs, reviewUsd: (review.creditsCharged ?? 0) / REPPO_CREDITS_PER_USD };
    await finishCheck(db, result.checkId, { status: "done", result: updated });
    hub.publish(result.checkId, { event: "review", data: { review, final: updated.final, finalReasons: updated.finalReasons, reviewed: updated.reviewed } });
    hub.close(result.checkId);
  }

  async get(checkId: string) {
    return getCheck(this.ctx.db, checkId);
  }
}
