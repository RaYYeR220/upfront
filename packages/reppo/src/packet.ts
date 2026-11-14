import type { Decision, Fact, FactKind, Policy, Terms } from "@upfront/core";

/**
 * Reppo's evaluation feed is public. The reviewer gets enough to judge the
 * decision and nothing that points back to the client: the company is
 * "Company A", identifiers are removed from all free text, dates are reduced
 * to the month, the creation date to the year, and money to two significant
 * figures. Fields are sent from an allowlist, never by stripping a denylist.
 */

const month = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}/.test(v) ? v.slice(0, 7) : null);
const year = (v: unknown) => (typeof v === "string" && /^\d{4}/.test(v) ? v.slice(0, 4) : null);
const sig2 = (v: unknown) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v === 0) return v === 0 ? 0 : null;
  const p = 10 ** (Math.floor(Math.log10(Math.abs(v))) - 1);
  return Math.round(v / p) * p;
};
const round = (digits: number) => (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? Number(v.toFixed(digits)) : null;
const keep = (v: unknown) => (typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : null);

type Shape = Record<string, (v: unknown) => unknown>;
const procedure: Shape = { family: keep, category: keep, judgmentDate: month, publishedOn: month, cessationDate: month };

const ALLOW: Partial<Record<FactKind, Shape | ((v: unknown) => unknown)>> = {
  "identity.created_on": year,
  "identity.legal_form": keep,
  "identity.naf": keep,
  "status.active": keep,
  "status.ceased_on": month,
  "bodacc.event": procedure,
  "proceeding.open": procedure,
  "proceeding.past": procedure,
  "accounts.filed": { closingDate: month, filedOn: month },
  "accounts.overdue_months": keep,
  "accounts.late_filing_months": keep,
  "accounts.never_filed": keep,
  "finance.year": {
    closingDate: month,
    revenue: sig2,
    netIncome: sig2,
    ebitda: sig2,
    equityRatio: round(0),
    debtRatio: round(1),
    reliability: keep,
  },
  "court.decision": { nature: keep, date: month, role: keep },
  "sanctions.hit": { list: keep },
  "vat.valid": keep,
  "vendor.credit_limit": { amountEur: sig2, terms: keep, riskClass: keep },
};

function shapeValue(kind: FactKind, value: unknown): unknown | undefined {
  const rule = ALLOW[kind];
  if (!rule) return undefined;
  if (typeof rule === "function") return rule(value);
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(rule)
      .map(([k, f]) => [k, f(v[k])] as const)
      .filter(([, x]) => x !== null && x !== undefined),
  );
}

const DIGIT_RUN = /\d(?:[\s.\-/]?\d){8,}/g;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every string that would identify the client: names, VAT and register numbers in any spacing. */
function identifiersOf(facts: Fact[], extra: string[]): RegExp[] {
  const raw = new Set<string>(extra.filter(Boolean));
  for (const f of facts) {
    if ((f.kind === "identity.name" || f.kind === "identity.vat") && typeof f.value === "string") raw.add(f.value);
  }
  return [...raw]
    .filter((s) => s.trim().length >= 3)
    .map((s) => {
      // Tolerate any spacing/punctuation between characters of numbers, and any whitespace in names.
      const pattern = /\d/.test(s) && s.replace(/\D/g, "").length >= 9
        ? s.replace(/[\s.\-]/g, "").split("").map(escapeRe).join("[\\s.\\-]?")
        : s.trim().split(/\s+/).map(escapeRe).join("\\s+");
      return new RegExp(pattern, "gi");
    });
}

function scrubText(text: string, ids: RegExp[]): string {
  let out = text;
  for (const re of ids) out = out.replace(re, "Company A");
  return out.replace(DIGIT_RUN, "[id]");
}

function describeTerms(t: Terms): string {
  switch (t.mode) {
    case "net":
      return `net ${t.netDays ?? 30} days${t.creditLimitEur ? `, credit limit about ${sig2(t.creditLimitEur)} EUR` : ""}`;
    case "deposit":
      return `deposit ${t.depositPct ?? 50}% up front, balance on delivery`;
    case "prepay":
      return "full prepayment before work starts";
    case "decline":
      return "decline the work";
  }
}

const show = (v: unknown) => (typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v));

export function buildReviewPacket(a: {
  policy: Policy;
  facts: Fact[];
  decision: Decision;
  amountEur: number;
  /** Extra identifiers to remove, e.g. the register number and the name the user typed. */
  identifiers?: string[];
}): { taskType: "action"; input: string } {
  const ids = identifiersOf(a.facts, a.identifiers ?? []);
  const facts = a.facts.flatMap((f) => {
    const v = shapeValue(f.kind, f.value);
    if (v === undefined) return [];
    return [`[${f.id}] ${f.kind}: ${scrubText(show(v), ids)} (${month(f.observedAt) ?? "undated"})`];
  });
  const reasons = a.decision.reasons.map((r) => `- (${r.factIds.join(", ")}) ${scrubText(r.text, ids)}`);
  const input = [
    `The user asked: decide the payment terms a small business should offer Company A for an invoice of about ${sig2(a.amountEur)} EUR, following the credit policy below and using only the listed facts.`,
    "",
    "Credit policy:",
    scrubText(a.policy.text, ids),
    "",
    "Facts about Company A (id, kind, value, month it became public):",
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
