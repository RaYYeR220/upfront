import { describe, expect, it } from "vitest";
import { evidenceBudgetUsd } from "../src/budget.ts";
import type { FloorResult } from "../src/floors.ts";
import type { Fact } from "../src/types.ts";
import { validateDecision } from "../src/validate.ts";

const facts: Fact[] = [
  { id: "f_1", kind: "identity.created_on", value: "2015-03-01", observedAt: "2015-03-01", source: "t", receiptId: null },
  { id: "f_2", kind: "accounts.overdue_months", value: 3, observedAt: "2026-11-12", source: "t", receiptId: null },
];
const noFloor: FloorResult = { floor: null, because: [], notes: [] };
const depositFloor: FloorResult = { floor: "deposit", because: [{ factId: "f_2", rule: "sanctioned" }], notes: [] };

const good = {
  terms: { mode: "net", netDays: 30, creditLimitEur: 4000 },
  reasons: [{ factIds: ["f_1"], text: "Trading for over ten years." }],
  confidence: "medium",
};

describe("validateDecision", () => {
  it("accepts a well-formed decision citing known facts", () => {
    const r = validateDecision(good, facts, noFloor);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.decision.terms.mode).toBe("net");
  });

  it("rejects a schema mismatch", () => {
    const r = validateDecision({ terms: { mode: "maybe" }, reasons: [], confidence: "high" }, facts, noFloor);
    expect(r.ok).toBe(false);
  });

  it("rejects a reason citing a fact that does not exist", () => {
    const r = validateDecision(
      { ...good, reasons: [{ factIds: ["f_999"], text: "Invented." }] },
      facts,
      noFloor,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/f_999/);
  });

  it("rejects a decision with no reasons", () => {
    expect(validateDecision({ ...good, reasons: [] }, facts, noFloor).ok).toBe(false);
  });

  it("rejects terms looser than the floor", () => {
    const r = validateDecision(good, facts, depositFloor);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/floor/);
  });
});

describe("evidenceBudgetUsd", () => {
  it("scales the evidence budget with the amount at stake", () => {
    expect(evidenceBudgetUsd(400)).toBe(0.05);
    expect(evidenceBudgetUsd(1000)).toBe(0.05);
    expect(evidenceBudgetUsd(5000)).toBe(0.15);
    expect(evidenceBudgetUsd(20000)).toBe(0.3);
    expect(evidenceBudgetUsd(50000)).toBe(0.6);
  });
});
