import type { Fact, FactKind } from "@upfront/core";

/** Facts that describe the company as it is today, which would leak the present into a past date. */
const CURRENT_STATE: ReadonlySet<FactKind> = new Set<FactKind>([
  "status.active",
  "vendor.credit_limit",
  "identity.workforce_band",
]);

/**
 * Point-in-time view: only what was public on `asOf`. Identity facts are kept
 * (they do not change), current-state facts are dropped, everything else must
 * have been published on or before `asOf`, and a fiscal year's figures count
 * only once its accounts were actually filed.
 */
export function filterAsOf(facts: Fact[], asOf: string): Fact[] {
  const filedClosings = new Set(
    facts
      .filter((f) => f.kind === "accounts.filed" && f.observedAt <= asOf)
      .map((f) => (f.value as { closingDate: string }).closingDate),
  );
  return facts
    .filter((f) => {
      if (CURRENT_STATE.has(f.kind)) return false;
      if (f.kind.startsWith("identity.")) return true;
      if (f.kind === "finance.year") return filedClosings.has((f.value as { closingDate: string }).closingDate);
      return f.observedAt <= asOf;
    })
    .map((f) => (f.observedAt > asOf ? { ...f, observedAt: asOf } : f));
}
