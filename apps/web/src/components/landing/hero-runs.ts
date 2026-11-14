/**
 * The two live checks replayed by the landing hero.
 *
 * Distilled from production checks run on 14 Nov 2026 for KD SOCCER CONSULTING (841936560) and
 * DANONE (552032534): the lookups the plan chose, their prices and Base settlement hashes, the
 * facts each one returned, the terms, and the independent review's verdict. `checkId` opens the
 * full check at /c/<id>.
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
  /** Settlement transaction on Base. */
  tx?: string;
  /** Status text for a failed lookup. */
  code?: string;
  /** Facts the lookup returned, each one a disc that orbits the client. */
  facts: string[];
  /** Index of the fact that triggers a hard rule. */
  hard?: number;
}

export interface HeroRun {
  checkId: string;
  name: string;
  siren: string;
  amount: string;
  /** Evidence budget for this invoice amount, in USD. */
  budget: number;
  /** Total spent on evidence, in USD. */
  total: number;
  /** True when a hard rule (a floor) set the terms rather than the policy. */
  floor: boolean;
  /** Seconds the reasoning step took. */
  decideSec: number;
  terms: string;
  l1: string;
  l2: string;
  review: { score: number; route: "ship" | "review"; note: string };
  src: HeroSource[];
}

export type HeroRunKey = "kd" | "danone";

export const RUNS: Record<HeroRunKey, HeroRun> = {
  kd: {
    checkId: "80685737-d132-4ffd-8b45-5e83c6e7ba6f",
    name: "KD SOCCER CONSULTING",
    siren: "841936560",
    amount: "€6,800",
    budget: 0.3,
    total: 0.025,
    floor: true,
    decideSec: 5.3,
    terms: "Decline",
    l1: '<s>Net 30</s> requested · <span class="why">set by a hard rule: open liquidation</span>',
    l2: '<span class="fin">Do not extend credit or take the work.</span>',
    review: { score: 100, route: "ship", note: "liquidation is a clear decline trigger" },
    src: [
      {
        name: "registry profile",
        usd: 0.005,
        st: "settled",
        url: "api.sirenic.eu/v1/entreprise/841936560",
        tx: "0xc5be567a037660f1a3bd897649e937f8858448afd192be6157635ed7014eb604",
        facts: ["name", "legal form 5710 (SAS)", "created Aug 2018", "NAF 70.22Z", "VAT number", "active in the register"],
      },
      {
        name: "gazette alerts",
        usd: 0.01,
        st: "settled",
        url: "…/entreprise/841936560/alertes",
        tx: "0x0a57b8b71bfd6b1fe548149205caccf6ad507cb583f2d5f5d8a71de84b02e11c",
        facts: ["liquidation published 14 Oct 2026; stopped paying 28 Mar 2025", "open proceeding"],
        hard: 1,
      },
      { name: "filed accounts", usd: 0.02, st: "skipped", facts: [] },
      {
        name: "financials",
        usd: 0.01,
        st: "settled",
        url: "…/entreprise/841936560/finances",
        tx: "0xe2716c712d7c1f9d83d15231cd9a84df3738b32b7c09d343220e581c571064ad",
        facts: ["FY2019: loss €226"],
      },
      { name: "court decisions", usd: 0.01, st: "skipped", facts: [] },
      { name: "vendor's credit limit", usd: 0.12, st: "skipped", facts: [] },
    ],
  },
  danone: {
    checkId: "b3bbbf38-7748-4313-b8f0-ea4ce0ce460b",
    name: "DANONE",
    siren: "552032534",
    amount: "€4,000",
    budget: 0.15,
    total: 0.025,
    floor: false,
    decideSec: 24,
    terms: "Net 30",
    l1: 'Net 30 kept · <span class="why">your freelancer policy, applied by SERV Reasoning</span>',
    l2: '<span class="fin">Full amount due within 30 days · up to €4,000 on credit.</span>',
    review: { score: 100, route: "review", note: "matches the policy; confidence medium, so a person takes a look" },
    src: [
      {
        name: "registry profile",
        usd: 0.005,
        st: "settled",
        url: "api.sirenic.eu/v1/entreprise/552032534",
        tx: "0x2d9cc1e51e269dd1a9656d2995f43d94ca176fa44606de7152739534513adcb7",
        facts: ["name", "legal form 5599 (SA)", "created 1955", "NAF 70.10Z", "workforce band", "VAT number", "active in the register"],
      },
      {
        name: "gazette alerts",
        usd: 0.01,
        st: "settled",
        url: "…/entreprise/552032534/alertes",
        tx: "0x37660e7ed2b925d6a30f168db078c31cf0893ca14f1c7a3844973bd27906caca",
        facts: [],
      },
      { name: "filed accounts", usd: 0.02, st: "skipped", facts: [] },
      {
        name: "financials",
        usd: 0.01,
        st: "settled",
        url: "…/entreprise/552032534/finances",
        tx: "0x06ab67b29725ff6d094c25d1d93a6fff4e3dca27d4c5137964c354d92b80bc9c",
        facts: [
          "FY2024: revenue €1.03bn, net €592m",
          "FY2023: revenue €699m, net €1.35bn",
          "FY2021: revenue €635m",
          "FY2020: revenue €622m",
          "FY2019: revenue €593m",
          "FY2018: revenue €666m",
          "FY2017: revenue €609m",
        ],
      },
      { name: "court decisions", usd: 0.01, st: "skipped", facts: [] },
      { name: "vendor's credit limit", usd: 0.12, st: "skipped", facts: [] },
    ],
  },
};

/** Short source labels for narrow screens, in the same order as `src`. */
export const SOURCE_SHORT = ["registry", "gazette", "filings", "finances", "court", "vendor limit"] as const;

/** First and last characters of a transaction hash. */
export const shortTx = (tx: string): string => `${tx.slice(0, 6)}…${tx.slice(-4)}`;
