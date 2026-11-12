import type { Terms } from "@upfront/core";

const eur = (n: number) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

/** One-line summary plus a payment-terms clause ready to paste into a quote or invoice. */
export function termsSummary(t: Terms, amountEur: number): { summary: string; termsText: string } {
  switch (t.mode) {
    case "net": {
      const days = t.netDays ?? 30;
      const limit = t.creditLimitEur;
      const summary = `Net ${days} days${limit ? `, up to ${eur(limit)} on credit` : ""}.`;
      const over = limit !== undefined && amountEur > limit;
      const termsText = over
        ? `Payment terms: ${eur(amountEur - limit!)} due on signature; the balance of ${eur(limit!)} due within ${days} days of the invoice date.`
        : `Payment terms: full amount due within ${days} days of the invoice date.`;
      return { summary, termsText };
    }
    case "deposit": {
      const pct = t.depositPct ?? 50;
      const dep = Math.round((amountEur * pct) / 100);
      return {
        summary: `${pct}% deposit up front (${eur(dep)}), the rest on delivery.`,
        termsText: `Payment terms: a deposit of ${pct}% (${eur(dep)}) is due on signature; work starts on receipt. The balance of ${eur(amountEur - dep)} is due on delivery.`,
      };
    }
    case "prepay":
      return {
        summary: `Prepay only: ${eur(amountEur)} before work starts.`,
        termsText: `Payment terms: the full amount of ${eur(amountEur)} is due before work starts.`,
      };
    case "decline":
      return {
        summary: "Decline: do not extend credit or take the work.",
        termsText: "We are unable to take on this engagement.",
      };
  }
}
