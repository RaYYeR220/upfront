/**
 * How much evidence is worth buying for one check, in USD, given the amount
 * at stake in EUR. Small invoices get a cheap check; large exposures get more.
 */
export function evidenceBudgetUsd(amountEur: number): number {
  if (amountEur <= 1_000) return 0.05;
  if (amountEur <= 5_000) return 0.15;
  if (amountEur <= 20_000) return 0.3;
  return 0.6;
}
