import { computeSignals, type Fact, type SignalName } from "@upfront/core";
import { STANDARD_INVOICE_EUR } from "./metrics.ts";

/** Warning signs at the thresholds a policy would use. */
export const THRESHOLDS: [string, SignalName, (v: number) => boolean][] = [
  ["accounts 1+ months overdue", "accounts_overdue_months", (v) => v >= 1],
  ["accounts 6+ months overdue", "accounts_overdue_months", (v) => v >= 6],
  ["accounts 12+ months overdue", "accounts_overdue_months", (v) => v >= 12],
  ["accounts 18+ months overdue", "accounts_overdue_months", (v) => v >= 18],
  ["never filed accounts", "accounts_never_filed_months", () => true],
  ["last accounts filed 1+ months late", "last_filing_late_months", (v) => v >= 1],
  ["last accounts filed 6+ months late", "last_filing_late_months", (v) => v >= 6],
  ["last accounts filed 12+ months late", "last_filing_late_months", (v) => v >= 12],
  ["under 2 years old", "age_months", (v) => v < 24],
  ["under 5 years old", "age_months", (v) => v < 60],
  ["last filed year a loss", "last_year_net_margin_pct", (v) => v < 0],
  ["last filed year lost 20%+ of revenue", "last_year_net_margin_pct", (v) => v < -20],
  ["negative equity", "last_year_equity_ratio_pct", (v) => v < 0],
  ["no financial results on file", "finances_known", (v) => v === 0],
  ["court decision in the last 12 months", "court_decision_months", (v) => v <= 12],
];

export interface SignCount {
  sign: string;
  failing: number;
  controls: number;
  /** Share of failing companies with the sign minus share of healthy ones. */
  separation: number;
}

/** How often each sign appears among companies that stopped paying and among their healthy twins. */
export function signCounts(rows: { group: "failing" | "control"; facts: Fact[]; T: string }[]): SignCount[] {
  const nf = rows.filter((r) => r.group === "failing").length || 1;
  const nc = rows.filter((r) => r.group === "control").length || 1;
  return THRESHOLDS.map(([sign, name, test]) => {
    let failing = 0;
    let controls = 0;
    for (const r of rows) {
      const s = computeSignals(r.facts, r.T, STANDARD_INVOICE_EUR)[name];
      if (!s || !test(s.value)) continue;
      if (r.group === "failing") failing++;
      else controls++;
    }
    return { sign, failing, controls, separation: Math.round((failing / nf - controls / nc) * 1000) / 1000 };
  });
}
