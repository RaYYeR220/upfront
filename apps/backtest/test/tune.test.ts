import { describe, expect, it } from "vitest";
import type { ArmMetrics } from "../src/metrics.ts";
import { accept, splitPairs } from "../src/tune.ts";

const m = (caughtFailing: number, falseAlarmControls: number): ArmMetrics => ({
  nFailing: 60,
  nControls: 60,
  caughtFailing,
  falseAlarmControls,
  avgLossPerInvoiceEur: 0,
});

describe("accept", () => {
  it("keeps a revision that catches more without crossing the false-alarm cap", () => {
    expect(accept(m(0.5, 0.05), m(0.6, 0.08)).accepted).toBe(true);
  });
  it("keeps a revision that cuts false alarms at the same catch rate", () => {
    expect(accept(m(0.5, 0.05), m(0.5, 0.02)).accepted).toBe(true);
  });
  it("rejects a revision with no net gain", () => {
    expect(accept(m(0.5, 0.05), m(0.55, 0.1)).accepted).toBe(false);
  });
  it("from a noisy start, trades a few catches for far fewer false alarms", () => {
    expect(accept(m(0.6, 0.47), m(0.5, 0.2)).accepted).toBe(true);
    expect(accept(m(0.6, 0.47), m(0.3, 0.2)).accepted).toBe(false);
  });
  it("rejects a revision that buys catches with false alarms", () => {
    expect(accept(m(0.5, 0.05), m(0.8, 0.2))).toMatchObject({ accepted: false });
  });
  it("tolerates false alarms up to where they already were", () => {
    expect(accept(m(0.5, 0.15), m(0.6, 0.15)).accepted).toBe(true);
    expect(accept(m(0.5, 0.15), m(0.6, 0.16)).accepted).toBe(false);
  });
});

describe("splitPairs", () => {
  it("keeps each failing company with its matched control and is deterministic", () => {
    const rows = Array.from({ length: 50 }, (_, i) => [
      { siren: `f${i}`, group: "failing" as const },
      { siren: `c${i}`, group: "control" as const, pairedWith: `f${i}` },
    ]).flat();
    const a = splitPairs(rows);
    const b = splitPairs(rows);
    expect(a.holdout.map((r) => r.siren)).toEqual(b.holdout.map((r) => r.siren));
    for (const r of a.holdout.filter((x) => x.group === "control")) {
      expect(a.holdout.some((x) => x.siren === r.pairedWith)).toBe(true);
    }
    expect(a.holdout.length).toBeGreaterThan(20);
    expect(a.train.length).toBeGreaterThan(40);
  });
});
