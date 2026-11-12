/**
 * The two recorded checks replayed by the landing hero.
 *
 * Distilled from the check run log for DANONE (552032534) and KD SOCCER CONSULTING (841936560).
 * Facts, step order, prices per lookup and the floor are as recorded. Settlement hashes are not
 * published yet, so receipts read "tx pending". The decide step ran on a fixed rule, so DANONE's
 * Net 30 is illustrative until a live SERV run. The independent review has not landed, so it reads
 * "pending". Swap this object for live run logs when they exist; the shape is all the hero needs.
 *
 * `l1` / `l2` are the two narration lines shown under the hub once the terms are set (trusted HTML).
 */

export type SourceStatus = "settled" | "failed" | "skipped";

export interface HeroSource {
  /** Source name, as shown next to its node. */
  name: string;
  /** Price of the lookup in USD. */
  usd: number;
  st: SourceStatus;
  /** Endpoint called, shown in the receipt. */
  url?: string;
  /** Status text for a failed lookup. */
  code?: string;
  /** Facts the lookup returned, each one a disc that orbits the client. */
  facts: string[];
  /** Index of the fact that triggers a hard rule. */
  hard?: number;
}

export interface HeroRun {
  name: string;
  siren: string;
  amount: string;
  /** Evidence budget for this invoice amount, in USD. */
  budget: number;
  /** Total spent on evidence, in USD. */
  total: number;
  /** True when a hard rule (a floor) set the terms rather than the policy. */
  floor: boolean;
  terms: string;
  l1: string;
  l2: string;
  src: HeroSource[];
}

export type HeroRunKey = "kd" | "danone";

export const RUNS: Record<HeroRunKey, HeroRun> = {
  kd: {
    name: "KD SOCCER CONSULTING",
    siren: "841936560",
    amount: "€6,800",
    budget: 0.3,
    total: 0.035,
    floor: true,
    terms: "Decline",
    l1: '<s>Net 30</s> requested · <span class="why">set by a hard rule: open liquidation</span>',
    l2: '<span class="fin">Do not extend credit or take the work.</span>',
    src: [
      { name: "registry profile", usd: 0.005, st: "settled", url: "api.sirenic.eu/v1/entreprise/841936560", facts: ["name", "legal form 5710 (SAS)", "created 2018", "NAF 70.22Z", "active"] },
      { name: "gazette alerts", usd: 0.01, st: "settled", url: "…/entreprise/841936560/alertes", facts: ["liquidation published 14 Oct 2026; stopped paying 28 Mar 2025", "open proceeding"], hard: 1 },
      { name: "filed accounts", usd: 0.02, st: "failed", url: "…/entreprise/841936560/documents", code: "404 · not billed", facts: [] },
      { name: "financials", usd: 0.01, st: "settled", url: "…/entreprise/841936560/finances", facts: ["FY2019: revenue €0, loss €226"] },
      { name: "court decisions", usd: 0.01, st: "settled", url: "…/entreprise/841936560/contentieux", facts: [] },
      { name: "vendor's credit limit", usd: 0.12, st: "skipped", facts: [] },
    ],
  },
  danone: {
    name: "DANONE",
    siren: "552032534",
    amount: "€4,000",
    budget: 0.15,
    total: 0.055,
    floor: false,
    terms: "Net 30",
    l1: 'Net 30 kept · <span class="why">your freelancer policy</span> · illustrative until a live SERV run',
    l2: '<span class="fin">Full amount due within 30 days of the invoice date.</span>',
    src: [
      { name: "registry profile", usd: 0.005, st: "settled", url: "api.sirenic.eu/v1/entreprise/552032534", facts: ["name", "legal form 5599", "created 1955", "NAF 70.10Z", "workforce band", "VAT number", "active"] },
      { name: "gazette alerts", usd: 0.01, st: "settled", url: "…/entreprise/552032534/alertes", facts: [] },
      { name: "filed accounts", usd: 0.02, st: "settled", url: "…/entreprise/552032534/documents", facts: ["accounts filed 27 May 2026 (FY2025)", "0 months overdue"] },
      { name: "financials", usd: 0.01, st: "settled", url: "…/entreprise/552032534/finances", facts: ["FY2017 accounts"] },
      { name: "court decisions", usd: 0.01, st: "settled", url: "…/entreprise/552032534/contentieux", facts: [] },
      { name: "vendor's credit limit", usd: 0.12, st: "skipped", facts: [] },
    ],
  },
};

/** Short source labels for narrow screens, in the same order as `src`. */
export const SOURCE_SHORT = ["registry", "gazette", "filings", "finances", "court", "vendor limit"] as const;
