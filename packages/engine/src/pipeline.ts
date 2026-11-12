import { randomUUID } from "node:crypto";
import {
  clampToFloor,
  computeFloor,
  type Decision,
  evidenceBudgetUsd,
  type Fact,
  type FloorResult,
  floorDefault,
  type Jurisdiction,
  type Policy,
  type Reason,
  type Receipt,
  type Terms,
  tightenOneNotch,
  validateDecision,
} from "@upfront/core";
import type { KiteExecutor, PayerRef } from "@upfront/kite";
import { awaitReview, buildReviewPacket, type ReppoClient, type ReviewResult } from "@upfront/reppo";
import type { DecideArgs } from "@upfront/serv";
import {
  type Candidate,
  deriveFacts,
  filterAsOf,
  type LookupSpec,
  menuFor,
  parseCandidates,
  parseSirenic,
  SEARCH_LOOKUP,
} from "@upfront/sources";
import { type NodeRecord, runNode } from "./graph.ts";
import { termsSummary } from "./issue.ts";

export interface ServPort {
  plan(a: { menu: LookupSpec[]; amountEur: number; budgetUsd: number }): Promise<{
    keys: string[];
    dropped: string[];
    why: string;
    costUsd: number;
    model: string;
  }>;
  decide(a: DecideArgs): Promise<{ raw: unknown; costUsd: number; ms: number; model: string }>;
  pick(a: { query: string; candidates: Candidate[] }): Promise<{ siren: string | null; yesProb: number; costUsd: number; model: string }>;
}

export type EngineEvent =
  | { type: "node"; node: NodeRecord }
  | { type: "receipt"; receipt: Receipt }
  | { type: "review"; review: ReviewResult };

export interface EngineDeps {
  kite: KiteExecutor;
  payer: PayerRef;
  serv: ServPort;
  reppo: ReppoClient | null;
  now(): Date;
  emit(e: EngineEvent): void;
}

export interface CheckInput {
  query: string;
  jurisdiction?: Jurisdiction;
  amountEur: number;
  netDaysRequested?: number;
  policy: Policy;
  /** Point-in-time mode: only evidence public on this date reaches the decision. */
  asOf?: string;
  /** Fixed lookup keys (backtest), instead of letting the planner choose. */
  planKeys?: string[];
  review?: "await" | "async" | "skip";
  reviewTimeoutMs?: number;
  reviewPollMs?: number;
  checkId?: string;
}

export interface CheckResult {
  checkId: string;
  entity: { jurisdiction: Jurisdiction; id: string; name: string };
  amountEur: number;
  policy: { id: string; version: number; hash: string };
  asOf: string | null;
  facts: Fact[];
  receipts: Receipt[];
  floor: FloorResult;
  proposed: Decision | null;
  decisionConfidence: Decision["confidence"];
  final: Terms;
  finalReasons: Reason[];
  review: ReviewResult | null;
  reviewed: boolean;
  notes: string[];
  issue: { summary: string; termsText: string };
  nodes: NodeRecord[];
  costs: { evidenceUsd: number; servUsd: number; reviewUsd: number };
}

export type CheckOutcome =
  | { kind: "done"; result: CheckResult }
  | { kind: "needs_choice"; candidates: Candidate[]; checkId: string }
  | { kind: "cannot_check_individual"; checkId: string }
  | { kind: "not_found"; checkId: string }
  | { kind: "unavailable"; checkId: string; reason: string; receipts: Receipt[] }
  | { kind: "unsupported_jurisdiction"; checkId: string };

const REVIEW_TIMEOUT_MS = 180_000;
/** Reppo sells evaluations at 2,000 credits per USDC. */
export const REPPO_CREDITS_PER_USD = 2000;

function identify(query: string): { siren: string | null; method: string } {
  const compact = query.replace(/[\s.\-]/g, "").toUpperCase();
  if (/^\d{9}$/.test(compact)) return { siren: compact, method: "siren" };
  if (/^\d{14}$/.test(compact)) return { siren: compact.slice(0, 9), method: "siret" };
  const vat = /^FR[0-9A-Z]{2}(\d{9})$/.exec(compact);
  if (vat) return { siren: vat[1]!, method: "vat" };
  return { siren: null, method: "search" };
}

const INDIVIDUAL = /R1|non_diffusible|diffusion_partielle|personne_physique/i;

/** French legal-form codes in the 1000 series are sole traders: people, not companies. */
function isIndividual(profile: unknown): boolean {
  const p = (profile && typeof profile === "object" ? profile : {}) as Record<string, unknown>;
  const form = String(p.nature_juridique ?? "");
  if (form.startsWith("1")) return true;
  if (typeof p.statut_diffusion === "string" && p.statut_diffusion !== "totale") return true;
  return false;
}

/**
 * Turns a (validated) model decision and the hard-fact floor into the terms we
 * actually offer. No decision, or one that failed validation, falls back to the
 * floor, or to a deposit when there is no floor: the step fails closed.
 */
export function settle(proposed: Decision | null, floor: FloorResult): { final: Terms; finalReasons: Reason[] } {
  if (proposed) return { final: clampToFloor(proposed.terms, floor.floor), finalReasons: proposed.reasons };
  const hard = floor.because.map((b) => ({ factIds: [b.factId], text: `Hard rule: ${b.rule.replace(/_/g, " ")}.` }));
  if (floor.floor) {
    return {
      final: floorDefault(floor.floor),
      finalReasons: [...hard, { factIds: [], text: "The reasoning step's answer failed validation against this floor; the floor applies." }],
    };
  }
  return {
    final: floorDefault("deposit"),
    finalReasons: [{ factIds: [], text: "The reasoning step failed validation, so the safe default applies." }],
  };
}

/** Applies an independent review to a finished check. Used inline and when a review lands later. */
export function applyReview(r: CheckResult, review: ReviewResult): CheckResult {
  const out = { ...r, review };
  if (review.status !== "done" || !r.proposed) return { ...out, reviewed: false };
  if (review.route === "block") {
    return {
      ...out,
      reviewed: true,
      final: tightenOneNotch(r.final),
      finalReasons: [
        ...r.finalReasons,
        { factIds: [], text: `Independent reviewer disagreed${review.reason ? `: ${review.reason}` : "."} Terms tightened one step.` },
      ],
    };
  }
  return { ...out, reviewed: true };
}

export async function runCheck(input: CheckInput, deps: EngineDeps): Promise<CheckOutcome> {
  const checkId = input.checkId ?? randomUUID();
  const nodes: NodeRecord[] = [];
  const receipts: Receipt[] = [];
  const emitNode = (node: NodeRecord) => deps.emit({ type: "node", node });
  const today = deps.now().toISOString().slice(0, 10);
  const refDate = input.asOf ?? today;
  const jurisdiction: Jurisdiction = input.jurisdiction ?? "FR";

  const pay = async (key: string, url: string) => {
    const res = await deps.kite.execute({ url, idempotencyKey: `${checkId}:${key}` }, deps.payer);
    receipts.push(res.receipt);
    deps.emit({ type: "receipt", receipt: res.receipt });
    return res;
  };

  if (jurisdiction !== "FR") return { kind: "unsupported_jurisdiction", checkId };

  // 1. resolve: register number, VAT number, or a name search the model helps disambiguate.
  type Resolved = { siren: string; method: string } | { needsChoice: Candidate[] } | { notFound: true };
  const resolved = await runNode<Resolved>(
    { checkId, name: "resolve", type: "decision", input: { query: input.query } },
    emitNode,
    nodes,
    async () => {
      const id = identify(input.query);
      if (id.siren) return { value: { siren: id.siren, method: id.method } };
      const res = await pay(SEARCH_LOOKUP.key, SEARCH_LOOKUP.url(input.query.trim()));
      const candidates = parseCandidates(res.body).filter((c) => c.fullyPublic && /^\d{9}$/.test(c.siren));
      if (candidates.length === 0) return { value: { notFound: true }, receiptIds: [res.receipt.id] };
      const exact = candidates.filter((c) => c.nameMatch === "exacte" && c.confidence >= 0.95);
      if (exact.length === 1) return { value: { siren: exact[0]!.siren, method: "search+exact" }, receiptIds: [res.receipt.id] };
      const pick = await deps.serv.pick({ query: input.query, candidates: candidates.slice(0, 8) });
      const value: Resolved = pick.siren
        ? { siren: pick.siren, method: "search+pick" }
        : { needsChoice: candidates.slice(0, 5) };
      return { value, output: { ...value, yesProb: pick.yesProb }, costUsd: pick.costUsd, model: pick.model, receiptIds: [res.receipt.id] };
    },
  );
  if ("notFound" in resolved) return { kind: "not_found", checkId };
  if ("needsChoice" in resolved) return { kind: "needs_choice", candidates: resolved.needsChoice, checkId };
  const siren = resolved.siren;

  // 2. plan: what is worth buying for this amount.
  const menu = menuFor(jurisdiction);
  const budgetUsd = evidenceBudgetUsd(input.amountEur);
  const plan = await runNode(
    { checkId, name: "plan", type: "agent", input: { amountEur: input.amountEur, budgetUsd } },
    emitNode,
    nodes,
    async () => {
      if (input.planKeys) {
        const keys = menu.filter((m) => m.essential || input.planKeys!.includes(m.key)).map((m) => m.key);
        return { value: { keys, why: "fixed plan" } };
      }
      try {
        const p = await deps.serv.plan({ menu, amountEur: input.amountEur, budgetUsd });
        return { value: { keys: p.keys, why: p.why }, output: p, costUsd: p.costUsd, model: p.model };
      } catch (e) {
        const keys = menu.filter((m) => m.essential).map((m) => m.key);
        return { value: { keys, why: "planner unavailable: essentials only" }, status: "error", error: String(e) };
      }
    },
  );

  // 3. buy: the registry profile first (it tells us if we may check this entity at all), then the rest.
  type Bought = { spec: LookupSpec; status: number | null; body: unknown; receipt: Receipt };
  type Gate = "individual" | "not_found" | "unavailable";
  const bought = await runNode<Bought[] | Gate>(
    { checkId, name: "buy", type: "external", input: { siren, keys: plan.keys } },
    emitNode,
    nodes,
    async () => {
      const specs = plan.keys.map((k) => menu.find((m) => m.key === k)).filter((m): m is LookupSpec => !!m);
      const profileSpec = specs.find((s) => s.key.endsWith(".profile")) ?? specs[0]!;
      const opts = { amountEur: input.amountEur, netDays: input.netDaysRequested ?? 30 };
      const first = await pay(profileSpec.key, profileSpec.url(siren, opts));
      // Fail closed: buy nothing else unless the profile came back and shows a fully public legal person.
      const ok = first.receipt.status === "settled" && first.httpStatus !== null && first.httpStatus >= 200 && first.httpStatus < 300;
      if (!ok) {
        const verdict: Gate = INDIVIDUAL.test(JSON.stringify(first.body ?? ""))
          ? "individual"
          : first.httpStatus === 404
            ? "not_found"
            : "unavailable";
        return { value: verdict, receiptIds: [first.receipt.id], status: "error", error: first.receipt.refusalCode ?? verdict };
      }
      if (isIndividual(first.body)) {
        return { value: "individual", receiptIds: [first.receipt.id], status: "error", error: "individual" };
      }
      const out: Bought[] = [{ spec: profileSpec, status: first.httpStatus, body: first.body, receipt: first.receipt }];
      const rest = specs.filter((s) => s !== profileSpec);
      const results = await Promise.all(
        rest.map(async (spec) => {
          const r = await pay(spec.key, spec.url(siren, opts));
          return { spec, status: r.httpStatus, body: r.body, receipt: r.receipt };
        }),
      );
      out.push(...results);
      const spent = out.reduce((s, b) => s + b.receipt.amountUsd, 0);
      return {
        value: out,
        output: out.map((b) => ({ key: b.spec.key, status: b.receipt.status, amountUsd: b.receipt.amountUsd, code: b.receipt.refusalCode })),
        costUsd: spent,
        receiptIds: out.map((b) => b.receipt.id),
      };
    },
  );
  if (bought === "individual") return { kind: "cannot_check_individual", checkId };
  if (bought === "not_found") return { kind: "not_found", checkId };
  if (bought === "unavailable") {
    const r = receipts[receipts.length - 1];
    return { kind: "unavailable", checkId, reason: r?.refusalCode ?? "registry lookup failed", receipts };
  }

  // 4. extract: parse what we paid for, keep only what was public on the reference date, derive.
  const facts = await runNode<Fact[]>(
    { checkId, name: "extract", type: "script", input: { asOf: input.asOf ?? null } },
    emitNode,
    nodes,
    async () => {
      let parsed: Fact[] = [];
      for (const b of bought) {
        if (b.receipt.status !== "settled" || !b.spec.route) continue;
        parsed.push(...parseSirenic(b.spec.route, b.body, { receiptId: b.receipt.id, fetchedAt: today }));
      }
      if (input.asOf) parsed = filterAsOf(parsed, input.asOf);
      const documentsFetched = bought.some((b) => b.spec.route === "documents" && b.receipt.status === "settled");
      const all = [...parsed, ...deriveFacts(parsed, refDate, { documentsFetched })];
      const numbered = all.map((f, i) => ({ ...f, id: `f_${i + 1}` }));
      return { value: numbered };
    },
  );

  const name = String(facts.find((f) => f.kind === "identity.name")?.value ?? siren);
  const refused = receipts.filter((r) => r.status === "refused");
  const notes: string[] = [];
  if (refused.length) {
    notes.push(
      `${refused.length} lookup${refused.length > 1 ? "s were" : " was"} refused by the spending limit (${[...new Set(refused.map((r) => r.refusalCode))].join(", ")}); the decision uses the evidence that was bought.`,
    );
  }

  // 5. floors: hard facts the model can never go below.
  const floor = await runNode(
    { checkId, name: "floors", type: "script", input: { factCount: facts.length } },
    emitNode,
    nodes,
    async () => ({ value: computeFloor(facts) }),
  );
  notes.push(...floor.notes);

  // 6. decide: the user's policy, compiled by SERV, applied to the facts. Fails closed.
  const decideArgs: DecideArgs = {
    policy: input.policy,
    facts,
    floor,
    amountEur: input.amountEur,
    netDaysRequested: input.netDaysRequested,
    today: refDate,
  };
  const decided = await runNode<{ proposed: Decision | null; errors: string[] }>(
    { checkId, name: "decide", type: "agent", input: { policyHash: input.policy.hash, factIds: facts.map((f) => f.id), floor: floor.floor } },
    emitNode,
    nodes,
    async () => {
      try {
        const d = await deps.serv.decide(decideArgs);
        const v = validateDecision(d.raw, facts, floor);
        if (v.ok) return { value: { proposed: v.decision, errors: [] }, output: { raw: d.raw }, costUsd: d.costUsd, model: d.model };
        return {
          value: { proposed: null, errors: v.errors },
          output: { raw: d.raw, errors: v.errors },
          costUsd: d.costUsd,
          model: d.model,
          status: "error",
          error: v.errors.join("; "),
        };
      } catch (e) {
        return { value: { proposed: null, errors: [String(e)] }, status: "error", error: String(e) };
      }
    },
  );

  let proposed = decided.proposed;
  if (proposed && refused.length && proposed.confidence === "high") proposed = { ...proposed, confidence: "medium" };
  let { final, finalReasons } = settle(proposed, floor);

  const baseResult: CheckResult = {
    checkId,
    entity: { jurisdiction, id: siren, name },
    amountEur: input.amountEur,
    policy: { id: input.policy.id, version: input.policy.version, hash: input.policy.hash },
    asOf: input.asOf ?? null,
    facts,
    receipts,
    floor,
    proposed,
    decisionConfidence: proposed?.confidence ?? "low",
    final,
    finalReasons,
    review: null,
    reviewed: false,
    notes,
    issue: { summary: "", termsText: "" },
    nodes,
    costs: { evidenceUsd: 0, servUsd: 0, reviewUsd: 0 },
  };

  // 7. review: an independent panel judges the decision. The stricter view wins.
  let result = baseResult;
  await runNode(
    { checkId, name: "review", type: "external", input: { mode: input.review ?? "async" } },
    emitNode,
    nodes,
    async () => {
      const mode = input.review ?? "async";
      if (mode === "skip" || !deps.reppo || !proposed) {
        return { value: null, status: "skipped" as const, output: { reason: !proposed ? "no model decision to review" : mode === "skip" ? "skipped" : "reviewer not configured" } };
      }
      try {
        const packet = buildReviewPacket({ policy: input.policy, facts, decision: proposed, amountEur: input.amountEur, identifiers: [siren, input.query] });
        const { id } = await deps.reppo.submit(packet);
        if (mode === "async") {
          result = { ...result, review: { status: "pending", evalId: id } };
          return { value: null, output: { evalId: id, status: "pending" } };
        }
        const review = await awaitReview(deps.reppo, id, {
          timeoutMs: input.reviewTimeoutMs ?? REVIEW_TIMEOUT_MS,
          pollMs: input.reviewPollMs ?? 4000,
        });
        deps.emit({ type: "review", review });
        result = applyReview(result, review);
        const costUsd = (review.creditsCharged ?? 0) / REPPO_CREDITS_PER_USD;
        return { value: null, output: review, costUsd, status: review.status === "done" ? "ok" : "error", error: review.reason };
      } catch (e) {
        result = { ...result, review: { status: "failed", reason: String(e) } };
        return { value: null, status: "error", error: String(e) };
      }
    },
  );

  // 8. issue: the terms as text the user can paste into a quote or invoice.
  const issue = await runNode(
    { checkId, name: "issue", type: "script", input: { final: result.final } },
    emitNode,
    nodes,
    async () => ({ value: termsSummary(result.final, input.amountEur) }),
  );

  const evidenceUsd = receipts.reduce((s, r) => s + r.amountUsd, 0);
  const servUsd = nodes.filter((n) => n.type === "agent" || n.type === "decision").reduce((s, n) => s + n.costUsd, 0);
  const reviewUsd = nodes.find((n) => n.name === "review")?.costUsd ?? 0;
  final = result.final;
  return {
    kind: "done",
    result: {
      ...result,
      final,
      issue,
      nodes,
      costs: { evidenceUsd: Math.round(evidenceUsd * 1e6) / 1e6, servUsd, reviewUsd },
    },
  };
}
