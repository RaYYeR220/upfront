import type { Jurisdiction } from "@upfront/core";
import { type SirenicRoute, sirenicUrl } from "./sirenic.ts";

export interface LookupOpts {
  since?: string;
  amountEur?: number;
  netDays?: number;
}

export interface LookupSpec {
  key: string;
  jurisdiction: Jurisdiction;
  merchant: string;
  priceUsd: number;
  purpose: string;
  essential: boolean;
  route?: SirenicRoute;
  url(entityId: string, opts?: LookupOpts): string;
}

const sirenic = (
  key: string,
  route: SirenicRoute,
  priceUsd: number,
  purpose: string,
  essential = false,
): LookupSpec => ({
  key,
  jurisdiction: "FR",
  merchant: "Sirenic",
  priceUsd,
  purpose,
  essential,
  route,
  url: (siren, o) =>
    sirenicUrl(route, {
      siren,
      depuis: o?.since,
      montant: o?.amountEur,
      delai_jours: o?.amountEur !== undefined ? (o?.netDays ?? 30) : undefined,
    }),
});

// Prices from Sirenic's live grid (Nov 2026). The 402 quote is authoritative.
const FR: LookupSpec[] = [
  sirenic("fr.profile", "entreprise", 0.005, "Registry profile: legal form, creation date, status, VAT number", true),
  sirenic("fr.gazette", "alertes", 0.01, "Official gazette (BODACC): insolvency proceedings and their dates", true),
  sirenic("fr.filings", "documents", 0.02, "Annual accounts on file and when each was filed"),
  sirenic("fr.finances", "finances", 0.01, "Filed financials: revenue, net income, equity ratio"),
  sirenic("fr.court", "contentieux", 0.01, "Commercial-court decisions: orders to pay, disputes"),
  sirenic("fr.vendor_limit", "encours", 0.12, "The data vendor's own indicative credit limit, for comparison"),
];

export const WATCH_LOOKUP: LookupSpec = sirenic(
  "fr.changes",
  "changements",
  0.01,
  "New gazette notices since the last check",
);
export const SEARCH_LOOKUP: LookupSpec = {
  ...sirenic("fr.search", "recherche", 0.002, "Find the company in the national register"),
  url: (q) => sirenicUrl("recherche", { q }),
};

export function menuFor(j: Jurisdiction): LookupSpec[] {
  return j === "FR" ? FR : [];
}

const micro = (usd: number) => Math.round(usd * 1_000_000);

/**
 * Keeps essentials, adds the planner's choices, then drops the most expensive
 * optional lookups until the total fits the budget.
 */
export function affordable(
  menu: LookupSpec[],
  chosenKeys: string[],
  budgetUsd: number,
): { keys: string[]; dropped: string[]; totalUsd: number } {
  const wanted = new Set(chosenKeys);
  let picked = menu.filter((m) => m.essential || wanted.has(m.key));
  const dropped: string[] = [];
  const total = () => picked.reduce((s, m) => s + micro(m.priceUsd), 0);
  while (total() > micro(budgetUsd)) {
    const optional = picked.filter((m) => !m.essential).sort((a, b) => b.priceUsd - a.priceUsd);
    const drop = optional[0];
    if (!drop) break;
    dropped.push(drop.key);
    picked = picked.filter((m) => m !== drop);
  }
  return { keys: picked.map((m) => m.key), dropped, totalUsd: total() / 1_000_000 };
}
