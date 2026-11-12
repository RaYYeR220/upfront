import type { Terms } from "@upfront/core";
import type { Arm } from "./arms.ts";

export interface EvalRow {
  siren: string;
  group: "failing" | "control";
  T: string;
  /** Terms each arm offered on date T; null when that arm could not run for this company. */
  arms: Partial<Record<Arm, Terms | null>>;
}

export interface ArmMetrics {
  nFailing: number;
  nControls: number;
  /** Share of failing companies asked for a deposit, prepayment or declined on the day they stopped paying. */
  caughtFailing: number;
  /** Share of healthy matched companies asked for the same. */
  falseAlarmControls: number;
  /** Average euros lost on a standard invoice to a failing company, if unpaid in full. */
  avgLossPerInvoiceEur: number;
}

export const STANDARD_INVOICE_EUR = 5000;

/** Anything stricter than plain credit counts as a warning. */
export const flagged = (t: Terms) => t.mode !== "net";

/** Exposure if the client never pays: credit loses all of it, a deposit only the balance, prepay/decline nothing. */
export function lossOnDefault(t: Terms, invoiceEur = STANDARD_INVOICE_EUR): number {
  switch (t.mode) {
    case "net":
      return invoiceEur;
    case "deposit":
      return invoiceEur * (1 - (t.depositPct ?? 50) / 100);
    default:
      return 0;
  }
}

const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

export function armMetrics(rows: EvalRow[], arm: Arm): ArmMetrics {
  const failing = rows.filter((r) => r.group === "failing" && r.arms[arm]);
  const controls = rows.filter((r) => r.group === "control" && r.arms[arm]);
  const caught = failing.filter((r) => flagged(r.arms[arm]!)).length;
  const alarms = controls.filter((r) => flagged(r.arms[arm]!)).length;
  const loss = failing.reduce((s, r) => s + lossOnDefault(r.arms[arm]!), 0);
  return {
    nFailing: failing.length,
    nControls: controls.length,
    caughtFailing: failing.length ? round(caught / failing.length) : 0,
    falseAlarmControls: controls.length ? round(alarms / controls.length) : 0,
    avgLossPerInvoiceEur: failing.length ? Math.round(loss / failing.length) : 0,
  };
}
