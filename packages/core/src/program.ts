import { z } from "zod";
import { monthsBetween } from "./dates.ts";
import { stricterOf } from "./terms.ts";
import type { Decision, Fact, Reason, Terms } from "./types.ts";

/**
 * A credit policy compiled into rules. SERV Reasoning writes it once from the
 * user's plain-English policy; code applies it to every check, the same way
 * every time, so any decision can be replayed from the facts and the program.
 */

/** What a rule can test, each computed from dated facts. */
export const SIGNALS = {
  age_months: "Months since the company was created.",
  accounts_overdue_months: "Months by which the company is late with its next annual accounts (0 when up to date). Absent when it never filed any.",
  accounts_never_filed_months: "Months since the company's first accounts were due, for a company that has never filed any. Absent when it has filed.",
  last_filing_late_months: "How many months after the legal deadline the most recent accounts were filed (0 when on time).",
  filings_count: "Number of sets of annual accounts on file.",
  past_proceeding_months: "Months since a past insolvency proceeding ended (plan adopted or proceeding closed). Absent when there was none.",
  court_decision_months: "Months since the most recent commercial-court decision involving the company. Absent when there is none.",
  last_year_net_margin_pct: "Last filed year's net result as a percentage of revenue (negative for a loss). Absent without results or revenue.",
  last_year_equity_ratio_pct: "Last filed year's equity as a percentage of the balance sheet (negative for negative equity). Absent without results.",
  finances_known: "1 when at least one year of financial results is on file, otherwise 0. Always present: test it with == 0 or == 1.",
  invoice_eur: "The invoice amount in euros. Always present.",
} as const;

export type SignalName = keyof typeof SIGNALS;
export const SIGNAL_NAMES = Object.keys(SIGNALS) as [SignalName, ...SignalName[]];
export const OPS = [">=", "<=", ">", "<", "==", "present", "absent"] as const;

const condition = z.object({ signal: z.enum(SIGNAL_NAMES), op: z.enum(OPS), value: z.number() });
// Unused numbers are dropped rather than rejected: a deposit's netDays or a net term's depositPct means nothing.
const ruleTerms = z
  .object({
    mode: z.enum(["net", "deposit", "prepay", "decline"]),
    netDays: z.number().int().min(0).max(120).nullable(),
    depositPct: z.number().int().min(0).max(100).nullable(),
    creditLimitEur: z.number().min(0).nullable().optional(),
  })
  .transform((t) => ({
    mode: t.mode,
    netDays: t.mode === "net" ? t.netDays : null,
    depositPct: t.mode === "deposit" && t.depositPct ? t.depositPct : null,
    creditLimitEur: t.mode === "net" && t.creditLimitEur ? t.creditLimitEur : null,
  }));
const group = z
  .object({
    all: z.array(condition).max(16),
    any: z.array(condition).max(16),
    // "Two or more of these triggers": counts other rules that fire, by id.
    atLeast: z.object({ n: z.number().int().min(1), rules: z.array(z.string()).min(1).max(30) }).nullable(),
  })
  .refine((g) => g.all.length + g.any.length + (g.atLeast ? 1 : 0) > 0, "a rule needs at least one condition");
const rule = z.object({ id: z.string().min(1).max(80), when: group, then: ruleTerms, why: z.string().min(1).max(400) });
const programSchema = z
  .object({
    default: ruleTerms,
    creditLimitIsInvoice: z.boolean(),
    maxNetDays: z.number().int().min(0).max(120),
    rules: z.array(rule).max(30),
    untranslated: z.array(z.string().max(300)).max(20),
    // The terms the policy text gives each sample client, read directly; checked against the rules.
    expected: z
      .array(
        z.object({
          probe: z.string(),
          mode: z.enum(["net", "deposit", "prepay", "decline"]),
          depositPct: z.number().nullable(),
          netDays: z.number().nullable(),
        }),
      )
      .max(20)
      .optional(),
  })
  .superRefine((p, ctx) => {
    const plain = new Set(p.rules.filter((r) => !r.when.atLeast).map((r) => r.id));
    const ids = new Set<string>();
    p.rules.forEach((r, i) => {
      if (ids.has(r.id)) ctx.addIssue({ code: "custom", path: ["rules", i, "id"], message: `duplicate rule id ${r.id}` });
      ids.add(r.id);
      for (const ref of r.when.atLeast?.rules ?? []) {
        if (!plain.has(ref)) ctx.addIssue({ code: "custom", path: ["rules", i, "when", "atLeast"], message: `atLeast must name rules without atLeast; ${ref} is not one` });
      }
      if (r.when.atLeast && r.when.atLeast.n > r.when.atLeast.rules.length) {
        ctx.addIssue({ code: "custom", path: ["rules", i, "when", "atLeast", "n"], message: "n is larger than the number of rules listed" });
      }
    });
  });

export type Condition = z.infer<typeof condition>;
export type RuleTerms = z.output<typeof ruleTerms>;
export type Rule = z.output<typeof rule>;
export type Program = z.output<typeof programSchema>;

export function parseProgram(raw: unknown): { ok: true; program: Program } | { ok: false; errors: string[] } {
  const r = programSchema.safeParse(raw);
  if (r.success) return { ok: true, program: r.data };
  return { ok: false, errors: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
}

export interface Signal {
  value: number;
  factIds: string[];
}
export type Signals = Partial<Record<SignalName, Signal>>;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const latest = (facts: Fact[]) => [...facts].sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];

/** Every signal that the facts support, as of `today`. */
export function computeSignals(facts: Fact[], today: string, amountEur: number): Signals {
  const s: Signals = { invoice_eur: { value: amountEur, factIds: [] } };
  const one = (kind: Fact["kind"]) => facts.find((f) => f.kind === kind);

  const created = one("identity.created_on");
  if (created && typeof created.value === "string") s.age_months = { value: monthsBetween(created.value, today), factIds: [created.id] };
  for (const [name, kind] of [
    ["accounts_overdue_months", "accounts.overdue_months"],
    ["accounts_never_filed_months", "accounts.never_filed"],
    ["last_filing_late_months", "accounts.late_filing_months"],
  ] as const) {
    const f = one(kind);
    const v = f ? num(f.value) : null;
    if (f && v !== null) s[name] = { value: v, factIds: [f.id] };
  }
  const filed = facts.filter((f) => f.kind === "accounts.filed");
  if (filed.length) s.filings_count = { value: filed.length, factIds: [latest(filed)!.id] };
  else if (one("accounts.never_filed")) s.filings_count = { value: 0, factIds: [one("accounts.never_filed")!.id] };

  const past = latest(facts.filter((f) => f.kind === "proceeding.past"));
  if (past) s.past_proceeding_months = { value: monthsBetween(past.observedAt, today), factIds: [past.id] };
  const court = latest(facts.filter((f) => f.kind === "court.decision"));
  if (court) s.court_decision_months = { value: monthsBetween(court.observedAt, today), factIds: [court.id] };

  const years = facts
    .filter((f) => f.kind === "finance.year")
    .sort((a, b) => String((b.value as { closingDate?: string })?.closingDate).localeCompare(String((a.value as { closingDate?: string })?.closingDate)));
  const last = years[0];
  s.finances_known = { value: last ? 1 : 0, factIds: last ? [last.id] : [] };
  if (last) {
    const v = last.value as { revenue?: unknown; netIncome?: unknown; equityRatio?: unknown };
    const revenue = num(v.revenue);
    const net = num(v.netIncome);
    if (revenue && revenue > 0 && net !== null) s.last_year_net_margin_pct = { value: Math.round((net / revenue) * 100), factIds: [last.id] };
    const eq = num(v.equityRatio);
    if (eq !== null) s.last_year_equity_ratio_pct = { value: Math.round(eq), factIds: [last.id] };
  }
  return s;
}

function holds(c: Condition, s: Signals): boolean {
  const sig = s[c.signal];
  if (c.op === "present") return sig !== undefined;
  if (c.op === "absent") return sig === undefined;
  if (!sig) return false;
  switch (c.op) {
    case ">=":
      return sig.value >= c.value;
    case "<=":
      return sig.value <= c.value;
    case ">":
      return sig.value > c.value;
    case "<":
      return sig.value < c.value;
    case "==":
      return sig.value === c.value;
  }
}

/** The conditions that made a rule fire, or null when it doesn't. `fired` maps rules already known to fire to their conditions. */
function fires(r: Rule, s: Signals, fired: Map<string, Condition[]>): Condition[] | null {
  const { all, any, atLeast } = r.when;
  if (!all.every((c) => holds(c, s))) return null;
  const anyMet = any.filter((c) => holds(c, s));
  if (any.length && !anyMet.length) return null;
  const counted = atLeast ? atLeast.rules.filter((id) => fired.has(id)) : [];
  if (atLeast && counted.length < atLeast.n) return null;
  return [...all, ...anyMet, ...counted.flatMap((id) => fired.get(id) ?? [])];
}

const LABEL: Record<SignalName, (v: number) => string> = {
  age_months: (v) => (v < 24 ? `${v} months old` : `${Math.floor(v / 12)} years old`),
  accounts_overdue_months: (v) => (v > 0 ? `accounts ${v} months overdue` : "accounts up to date"),
  accounts_never_filed_months: (v) => `no accounts ever filed, the first were due ${v} months ago`,
  last_filing_late_months: (v) => (v > 0 ? `last accounts filed ${v} months late` : "last accounts filed on time"),
  filings_count: (v) => `${v} sets of accounts on file`,
  past_proceeding_months: (v) => `insolvency proceeding ended ${v} months ago`,
  court_decision_months: (v) => `court decision ${v} months ago`,
  last_year_net_margin_pct: (v) => `net result ${v}% of revenue`,
  last_year_equity_ratio_pct: (v) => `equity ${v}% of the balance sheet`,
  finances_known: (v) => (v ? "financial results on file" : "no financial results among the records checked"),
  invoice_eur: (v) => `invoice €${v.toLocaleString("en-IE")}`,
};

function describe(names: SignalName[], s: Signals): { text: string; factIds: string[] } {
  const seen = [...new Set(names)].filter((n) => n !== "invoice_eur" || names.length === 1);
  const parts: string[] = [];
  const ids = new Set<string>();
  for (const n of seen) {
    const sig = s[n];
    if (!sig) continue;
    parts.push(LABEL[n](sig.value));
    for (const id of sig.factIds) ids.add(id);
  }
  return { text: parts.join("; "), factIds: [...ids] };
}

const toTerms = (t: RuleTerms): Terms => {
  const out: Terms = { mode: t.mode };
  if (t.mode === "net") out.netDays = t.netDays ?? 30;
  if (t.mode === "net" && t.creditLimitEur) out.creditLimitEur = t.creditLimitEur;
  if (t.mode === "deposit") out.depositPct = t.depositPct ?? 50;
  return out;
};

export interface ProgramResult {
  decision: Decision;
  /** Ids of the rules that fired, in program order. */
  fired: string[];
  signals: Signals;
}

type Hit = { rule: Rule; met: Condition[]; terms: Terms };

/** The rules that fire on these signals, in program order. Plain rules first, then those counting other rules. */
function evaluate(p: Program, s: Signals): Hit[] {
  const fired = new Map<string, Condition[]>();
  const hits: Hit[] = [];
  for (const pass of [false, true]) {
    for (const r of p.rules.filter((x) => !!x.when.atLeast === pass)) {
      const met = fires(r, s, fired);
      if (!met) continue;
      fired.set(r.id, met);
      hits.push({ rule: r, met, terms: toTerms(r.then) });
    }
  }
  return hits.sort((x, y) => p.rules.indexOf(x.rule) - p.rules.indexOf(y.rule));
}

const sig = (v: Partial<Record<SignalName, number>>): Signals =>
  Object.fromEntries(Object.entries(v).map(([k, value]) => [k, { value, factIds: [] }])) as Signals;
const CLEAN = {
  age_months: 120,
  accounts_overdue_months: 0,
  last_filing_late_months: 0,
  filings_count: 8,
  last_year_net_margin_pct: 8,
  last_year_equity_ratio_pct: 40,
  finances_known: 1,
  invoice_eur: 5000,
};

/** Sample clients a compiled policy is tried on before it is used. */
export const PROBES: { id: string; label: string; signals: Signals }[] = [
  { id: "clean", label: "a healthy client: 10 years old, accounts on time, profitable, no court or insolvency history, €5,000 invoice", signals: sig(CLEAN) },
  { id: "young", label: "a 1-year-old client with no accounts due yet", signals: sig({ age_months: 12, finances_known: 0, invoice_eur: 5000 }) },
  { id: "late", label: "a healthy client whose accounts are 9 months overdue", signals: sig({ ...CLEAN, accounts_overdue_months: 9 }) },
  { id: "very_late", label: "a client whose accounts are 24 months overdue", signals: sig({ ...CLEAN, accounts_overdue_months: 24 }) },
  { id: "never", label: "a 5-year-old client that never filed accounts", signals: sig({ age_months: 60, accounts_never_filed_months: 29, filings_count: 0, finances_known: 0, invoice_eur: 5000 }) },
  { id: "loss", label: "a healthy client whose last year lost 35% of revenue", signals: sig({ ...CLEAN, last_year_net_margin_pct: -35 }) },
  { id: "negative_equity", label: "a healthy client with negative equity", signals: sig({ ...CLEAN, last_year_equity_ratio_pct: -10 }) },
  { id: "court", label: "a healthy client with a court decision 4 months ago", signals: sig({ ...CLEAN, court_decision_months: 4 }) },
  { id: "past_proceeding", label: "a healthy client whose insolvency proceeding ended 12 months ago", signals: sig({ ...CLEAN, past_proceeding_months: 12 }) },
  { id: "big_invoice", label: "a healthy client with a €40,000 invoice", signals: sig({ ...CLEAN, invoice_eur: 40000 }) },
];

const ALWAYS_PRESENT = new Set<SignalName>(["finances_known", "invoice_eur"]);
export const OUT_OF_SCOPE = /liquidat|ceased|cease trading|sanction/i;

/**
 * Checks a compiled policy for the mistakes that make it unusable, by running it
 * on sample clients. Each problem is a sentence the compiler can act on.
 */
export function lintProgram(p: Program): string[] {
  const errors: string[] = [];
  for (const r of p.rules) {
    if (OUT_OF_SCOPE.test(`${r.id} ${r.why}`)) {
      errors.push(`Rule ${r.id} is about liquidation, ceased trading or sanctions; those are decided outside the program. Remove it.`);
    }
    for (const c of [...r.when.all, ...r.when.any]) {
      if (ALWAYS_PRESENT.has(c.signal) && (c.op === "present" || c.op === "absent")) {
        errors.push(`Rule ${r.id} tests whether ${c.signal} is present, but it always is; compare its value instead.`);
      }
    }
  }
  const results = PROBES.map((probe) => ({ probe, hits: evaluate(p, probe.signals) }));
  for (const r of p.rules) {
    if (results.every((x) => x.hits.some((h) => h.rule.id === r.id))) {
      errors.push(`Rule ${r.id} fires for every client, so its conditions test nothing; make them test the trigger it names.`);
    }
  }
  const clean = results.find((x) => x.probe.id === "clean")!;
  const strict = clean.hits.filter((h) => h.terms.mode !== "net");
  if (strict.length) {
    errors.push(`Rules ${strict.map((h) => h.rule.id).join(", ")} fire for ${clean.probe.label}; a rule must only fire on the warning sign it names.`);
  }
  return errors;
}

/**
 * Sample clients on which the rules and a direct reading of the policy disagree.
 * Either side can be wrong (policies overlap, readings slip), so these are shown
 * to the user rather than treated as errors.
 */
export function disagreements(p: Program): string[] {
  const errors: string[] = [];
  const results = PROBES.map((probe) => ({ probe, hits: evaluate(p, probe.signals) }));
  const show = (t: { mode: string; depositPct?: number | null; netDays?: number | null }) =>
    t.mode === "deposit" ? `a ${t.depositPct ?? 50}% deposit` : t.mode === "net" ? `Net ${t.netDays ?? 30}` : t.mode;
  for (const e of p.expected ?? []) {
    const r = results.find((x) => x.probe.id === e.probe);
    if (!r) continue;
    const got = r.hits.length ? r.hits.map((h) => h.terms).reduce((x, y) => stricterOf(x, y)) : toTerms(p.default);
    const same = got.mode === e.mode && (e.mode !== "deposit" || !e.depositPct || got.depositPct === e.depositPct);
    if (!same) {
      const why = r.hits.length ? `rules ${r.hits.map((h) => h.rule.id).join(", ")} fire` : "no rule fires";
      errors.push(`For ${r.probe.label}, the policy gives ${show(e)}, but the program gives ${show(got)} (${why}). Fix the rules so they agree with the policy.`);
    }
  }
  return errors;
}

/** What the program offers each sample client, for showing next to the policy. */
export function probeProgram(p: Program): { id: string; label: string; terms: Terms; fired: string[] }[] {
  return PROBES.map((probe) => {
    const hits = evaluate(p, probe.signals);
    const terms = hits.length ? hits.map((h) => h.terms).reduce((x, y) => stricterOf(x, y)) : toTerms(p.default);
    return { id: probe.id, label: probe.label, terms, fired: hits.map((h) => h.rule.id) };
  });
}

/** Applies a compiled policy to a client's facts. Pure: same facts, same answer. */
export function applyProgram(p: Program, facts: Fact[], a: { today: string; amountEur: number }): ProgramResult {
  const s = computeSignals(facts, a.today, a.amountEur);
  const subject = facts.find((f) => f.kind === "identity.name") ?? facts[0];
  const cite = (ids: string[]) => (ids.length ? ids : subject ? [subject.id] : []);

  const hits = evaluate(p, s);

  let terms: Terms;
  const reasons: Reason[] = [];
  if (!hits.length) {
    terms = toTerms(p.default);
    if (terms.mode === "net" && p.creditLimitIsInvoice && terms.creditLimitEur === undefined) terms.creditLimitEur = a.amountEur;
    const d = describe(["age_months", "accounts_overdue_months", "last_filing_late_months", "last_year_net_margin_pct", "finances_known"], s);
    reasons.push({ factIds: cite(d.factIds), text: `No deposit, prepayment or decline rule in your policy applies${d.text ? ` (${d.text})` : ""}.` });
  } else {
    terms = hits.map((h) => h.terms).reduce((x, y) => stricterOf(x, y));
    const ordered = [...hits].sort((x, y) => (stricterOf(x.terms, y.terms) === x.terms ? -1 : 1));
    for (const h of ordered.slice(0, 4)) {
      const d = describe(
        h.met.map((c) => c.signal),
        s,
      );
      reasons.push({ factIds: cite(d.factIds), text: `${h.rule.why}${d.text ? ` (${d.text})` : ""}.` });
    }
  }
  if (terms.mode === "net" && (terms.netDays ?? 30) > p.maxNetDays) terms.netDays = p.maxNetDays;

  return { decision: { terms, reasons, confidence: "high" }, fired: hits.map((h) => h.rule.id), signals: s };
}
