import type { Fact } from "@upfront/core";
import { describe, expect, it } from "vitest";
import { ruleArm } from "../src/arms.ts";
import { armMetrics, type EvalRow, lossOnDefault } from "../src/metrics.ts";
import { markersIn, renderNumbers } from "../src/render.ts";

const f = (id: string, kind: Fact["kind"], value: unknown, observedAt: string): Fact => ({ id, kind, value, observedAt, source: "t", receiptId: null });

describe("ruleArm", () => {
  it("follows the floor first", () => {
    expect(ruleArm([f("a", "proceeding.open", { category: "ouverture_liquidation" }, "2026-01-01")], "2026-02-01").terms).toEqual({ mode: "decline" });
  });
  it("asks a deposit for 18+ months of overdue accounts", () => {
    expect(ruleArm([f("a", "accounts.overdue_months", 18, "2026-02-01")], "2026-02-01").terms.mode).toBe("deposit");
    expect(ruleArm([f("a", "accounts.overdue_months", 17, "2026-02-01")], "2026-02-01").terms.mode).toBe("net");
  });
  it("asks a deposit after a recent proceeding or court order to pay", () => {
    expect(ruleArm([f("a", "proceeding.past", { category: "plan_redressement" }, "2024-06-01")], "2026-02-01").terms.mode).toBe("deposit");
    expect(ruleArm([f("a", "proceeding.past", { category: "plan_redressement" }, "2021-06-01")], "2026-02-01").terms.mode).toBe("net");
    expect(ruleArm([f("a", "court.decision", { nature: "injonction de payer" }, "2025-09-01")], "2026-02-01").terms.mode).toBe("deposit");
  });
});

describe("metrics", () => {
  const rows: EvalRow[] = [
    { siren: "1", group: "failing", T: "2026-01-01", arms: { upfront: { mode: "deposit", depositPct: 50 }, net30: { mode: "net", netDays: 30 } } },
    { siren: "2", group: "failing", T: "2026-01-01", arms: { upfront: { mode: "net", netDays: 30 }, net30: { mode: "net", netDays: 30 } } },
    { siren: "3", group: "control", T: "2026-01-01", arms: { upfront: { mode: "prepay" }, net30: { mode: "net", netDays: 30 } } },
    { siren: "4", group: "control", T: "2026-01-01", arms: { upfront: { mode: "net", netDays: 30 }, net30: { mode: "net", netDays: 30 } } },
    { siren: "5", group: "failing", T: "2026-01-01", arms: { upfront: null, net30: { mode: "net", netDays: 30 } } },
  ];
  it("measures catch rate, false alarms and loss per invoice on the rows each arm ran", () => {
    expect(armMetrics(rows, "upfront")).toEqual({ nFailing: 2, nControls: 2, caughtFailing: 0.5, falseAlarmControls: 0.5, avgLossPerInvoiceEur: 3750 });
    expect(armMetrics(rows, "net30")).toEqual({ nFailing: 3, nControls: 2, caughtFailing: 0, falseAlarmControls: 0, avgLossPerInvoiceEur: 5000 });
  });
  it("counts what is at risk if the client never pays", () => {
    expect(lossOnDefault({ mode: "deposit", depositPct: 30 })).toBe(3500);
    expect(lossOnDefault({ mode: "decline" })).toBe(0);
  });
});

describe("renderNumbers", () => {
  const doc = "Median <!-- num:gap.median -->?<!-- /num --> days; caught <!-- num:bt.caught -->old<!-- /num -->.";
  it("rewrites only the marked spans", () => {
    expect(renderNumbers(doc, { "gap.median": "144", "bt.caught": "61%" })).toBe(
      "Median <!-- num:gap.median -->144<!-- /num --> days; caught <!-- num:bt.caught -->61%<!-- /num -->.",
    );
    expect(markersIn(doc)).toEqual(["gap.median", "bt.caught"]);
  });
  it("refuses to render a number it has no value for", () => {
    expect(() => renderNumbers(doc, { "gap.median": "144" })).toThrow(/bt.caught/);
  });
});
