import { describe, expect, it } from "vitest";
import { applyProgram, computeSignals, lintProgram, type Program, parseProgram } from "../src/program.ts";
import type { Fact } from "../src/types.ts";

const fact = (id: string, kind: Fact["kind"], value: unknown, observedAt = "2026-01-01"): Fact => ({
  id,
  kind,
  value,
  observedAt,
  source: "t",
  receiptId: null,
});

const T = "2026-11-12";
const company: Fact[] = [
  fact("f_1", "identity.name", "ACME"),
  fact("f_2", "identity.created_on", "2015-03-01", "2015-03-01"),
  fact("f_3", "accounts.filed", { closingDate: "2024-12-31", filedOn: "2025-06-30" }, "2025-06-30"),
  fact("f_4", "accounts.overdue_months", 0, T),
  fact("f_5", "accounts.late_filing_months", 0, "2025-06-30"),
  fact("f_6", "finance.year", { closingDate: "2024-12-31", revenue: 1_000_000, netIncome: -250_000, equityRatio: 12 }, "2024-12-31"),
];

const program: Program = {
  default: { mode: "net", netDays: 30, depositPct: null, creditLimitEur: null },
  creditLimitIsInvoice: true,
  maxNetDays: 45,
  rules: [
    {
      id: "young",
      when: { all: [{ signal: "age_months", op: "<", value: 24 }], any: [], atLeast: null },
      then: { mode: "deposit", netDays: null, depositPct: 30, creditLimitEur: null },
      why: "Under two years old",
    },
    {
      id: "loss",
      when: { all: [{ signal: "last_year_net_margin_pct", op: "<", value: -20 }], any: [], atLeast: null },
      then: { mode: "deposit", netDays: null, depositPct: 50, creditLimitEur: null },
      why: "Last filed year lost more than 20% of revenue",
    },
    {
      id: "two",
      when: {
        all: [],
        any: [],
        atLeast: { n: 2, rules: ["young", "loss", "never"] },
      },
      then: { mode: "prepay", netDays: null, depositPct: null, creditLimitEur: null },
      why: "Two or more warning signs together",
    },
    {
      id: "never",
      when: { all: [{ signal: "accounts_never_filed_months", op: "present", value: 0 }], any: [], atLeast: null },
      then: { mode: "deposit", netDays: null, depositPct: 30, creditLimitEur: null },
      why: "No accounts ever filed",
    },
  ],
  untranslated: [],
};

describe("computeSignals", () => {
  it("reads each signal with the facts it rests on", () => {
    const s = computeSignals(company, T, 5000);
    expect(s.age_months).toEqual({ value: 140, factIds: ["f_2"] });
    expect(s.last_year_net_margin_pct).toEqual({ value: -25, factIds: ["f_6"] });
    expect(s.last_year_equity_ratio_pct).toEqual({ value: 12, factIds: ["f_6"] });
    expect(s.accounts_overdue_months?.value).toBe(0);
    expect(s.filings_count).toEqual({ value: 1, factIds: ["f_3"] });
    expect(s.finances_known?.value).toBe(1);
    expect(s.invoice_eur?.value).toBe(5000);
    expect(s.accounts_never_filed_months).toBeUndefined();
  });
});

describe("applyProgram", () => {
  it("returns the strictest terms among the rules that fire, each reason citing its facts", () => {
    const d = applyProgram(program, company, { today: T, amountEur: 5000 });
    expect(d.decision.terms).toEqual({ mode: "deposit", depositPct: 50 });
    expect(d.fired).toEqual(["loss"]);
    expect(d.decision.reasons[0]).toEqual({ factIds: ["f_6"], text: "Last filed year lost more than 20% of revenue (net result -25% of revenue)." });
  });

  it("falls back to the default, with the invoice as credit limit, when nothing fires", () => {
    const healthy = company.map((f) => (f.id === "f_6" ? fact("f_6", "finance.year", { closingDate: "2024-12-31", revenue: 1_000_000, netIncome: 90_000 }) : f));
    const d = applyProgram(program, healthy, { today: T, amountEur: 4000 });
    expect(d.fired).toEqual([]);
    expect(d.decision.terms).toEqual({ mode: "net", netDays: 30, creditLimitEur: 4000 });
    expect(d.decision.reasons).toHaveLength(1);
    expect(d.decision.reasons[0]!.factIds.length).toBeGreaterThan(0);
  });

  it("counts warning signs for an at-least rule", () => {
    const young = company.map((f) => (f.id === "f_2" ? fact("f_2", "identity.created_on", "2025-06-01", "2025-06-01") : f));
    const d = applyProgram(program, young, { today: T, amountEur: 5000 });
    expect(d.decision.terms.mode).toBe("prepay");
    expect(d.fired).toEqual(expect.arrayContaining(["young", "loss", "two"]));
  });

  it("treats a missing signal as not met, and present/absent as tests on it", () => {
    const never = [fact("f_1", "identity.name", "X"), fact("f_2", "identity.created_on", "2015-01-01", "2015-01-01"), fact("f_9", "accounts.never_filed", 40, T)];
    const d = applyProgram(program, never, { today: T, amountEur: 5000 });
    expect(d.fired).toEqual(["never"]);
    expect(d.decision.reasons[0]!.factIds).toEqual(["f_9"]);
  });

  it("caps net days", () => {
    const p = { ...program, default: { mode: "net" as const, netDays: 60, depositPct: null, creditLimitEur: null }, rules: [] };
    expect(applyProgram(p, company, { today: T, amountEur: 1000 }).decision.terms).toMatchObject({ netDays: 45 });
  });
});

describe("parseProgram", () => {
  it("rejects an at-least rule that names a missing rule", () => {
    const bad = { ...program, rules: [...program.rules, { ...program.rules[2]!, id: "three", when: { all: [], any: [], atLeast: { n: 2, rules: ["young", "nope"] } } }] };
    expect(parseProgram(bad).ok).toBe(false);
  });

  it("accepts a well-formed program and rejects unknown signals", () => {
    expect(parseProgram(program).ok).toBe(true);
    const bad = { ...program, rules: [{ ...program.rules[0]!, when: { all: [{ signal: "credit_score", op: ">", value: 1 }], any: [], atLeast: null } }] };
    const r = parseProgram(bad);
    expect(r.ok).toBe(false);
  });
});

describe("lintProgram", () => {
  it("passes a program whose rules each test their own trigger", () => {
    expect(lintProgram(program)).toEqual([]);
  });

  it("flags a rule that asks a healthy client for more, one that fires for everyone, and out-of-scope rules", () => {
    const bad: Program = {
      ...program,
      rules: [
        ...program.rules,
        {
          id: "any_invoice",
          when: { all: [{ signal: "invoice_eur", op: ">", value: 0 }], any: [], atLeast: null },
          then: { mode: "prepay", netDays: null, depositPct: null, creditLimitEur: null },
          why: "Large invoices",
        },
        {
          id: "decline_liquidation",
          when: { all: [{ signal: "court_decision_months", op: "present", value: 0 }], any: [], atLeast: null },
          then: { mode: "decline", netDays: null, depositPct: null, creditLimitEur: null },
          why: "Decline when in liquidation",
        },
      ],
    };
    const errors = lintProgram(bad).join(" | ");
    expect(errors).toMatch(/any_invoice fires for every client/);
    expect(errors).toMatch(/any_invoice fire for a healthy client/);
    expect(errors).toMatch(/decline_liquidation is about liquidation/);
  });
});
