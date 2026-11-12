import type { Decision, Fact, Policy, Terms } from "@upfront/core";

/** Facts that identify the client. They never leave our servers. */
const IDENTIFYING = new Set(["identity.name", "identity.vat"]);
const DROP_KEYS = new Set(["noticeId", "link", "url", "siren", "siret", "representatives", "name", "denomination"]);

function scrub(v: unknown): unknown {
  if (typeof v === "string") return v.replace(/\d{9,}/g, "[id]").replace(/\b[A-Z]\d{9,}\b/g, "[id]");
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([k]) => !DROP_KEYS.has(k))
        .map(([k, x]) => [k, scrub(x)]),
    );
  }
  return v;
}

function describeTerms(t: Terms): string {
  switch (t.mode) {
    case "net":
      return `net ${t.netDays ?? 30} days${t.creditLimitEur ? `, credit limit ${t.creditLimitEur} EUR` : ""}`;
    case "deposit":
      return `deposit ${t.depositPct ?? 50}% up front, balance on delivery`;
    case "prepay":
      return "full prepayment before work starts";
    case "decline":
      return "decline the work";
  }
}

const show = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : JSON.stringify(v));

/**
 * The packet an independent reviewer sees. Reppo's evaluation feed is public,
 * so the client is "Company A" and identifiers are removed.
 */
export function buildReviewPacket(a: { policy: Policy; facts: Fact[]; decision: Decision; amountEur: number }): {
  taskType: "action";
  input: string;
} {
  const facts = a.facts
    .filter((f) => !IDENTIFYING.has(f.kind))
    .map((f) => `[${f.id}] ${f.kind}: ${show(scrub(f.value))} (${f.observedAt})`);
  const reasons = a.decision.reasons.map((r) => `- (${r.factIds.join(", ")}) ${scrub(r.text)}`);
  const input = [
    `The user asked: decide the payment terms a small business should offer Company A for an invoice of ${a.amountEur} EUR, following the credit policy below and using only the listed facts.`,
    "",
    "Credit policy:",
    a.policy.text,
    "",
    "Facts about Company A (id, kind, value, date it became public):",
    ...facts,
    "",
    "The agent's decision:",
    `Terms: ${describeTerms(a.decision.terms)}.`,
    "Reasons:",
    ...reasons,
    `Confidence: ${a.decision.confidence}`,
    "",
    "Evaluate whether this decision follows the policy and is supported by the facts it cites. Flag reasons whose cited facts do not support them, policy rules that were ignored, and terms that are too loose or too strict for the evidence.",
  ].join("\n");
  return { taskType: "action", input: input.slice(0, 49_000) };
}
