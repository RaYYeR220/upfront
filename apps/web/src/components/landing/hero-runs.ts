/**
 * The two live checks replayed by the landing hero.
 *
 * Distilled from production checks run on 15 Nov 2026 for KD SOCCER CONSULTING (841936560) and
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
  /** Milliseconds the compiled policy took to decide. */
  decideMs: number;
  /** What the policy's compiled rules concluded, for the narration. */
  decideNote: string;
  terms: string;
  l1: string;
  l2: string;
  review: { score: number; route: "ship" | "review"; note: string };
  src: HeroSource[];
}

export type HeroRunKey = "kd" | "danone";

export const RUNS: Record<HeroRunKey, HeroRun> = {
  kd: {
    checkId: "ce94109b-39ca-4e62-b0fb-bb713e0014b7",
    name: "KD SOCCER CONSULTING",
    siren: "841936560",
    amount: "€6,800",
    budget: 0.3,
    total: 0.175,
    floor: true,
    decideMs: 15,
    decideNote: "the hard rule sets the terms",
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
        tx: "0x6e9ea7f38441908dc197324a3cac797a603d83233979f56f818ba2a6314e4c48",
        facts: ["name", "legal form 5710 (SAS)", "created Aug 2018", "NAF 70.22Z", "no employees declared", "VAT number", "active in the register"],
      },
      {
        name: "gazette alerts",
        usd: 0.01,
        st: "settled",
        url: "…/entreprise/841936560/alertes",
        tx: "0xe50ac4da9a9a55f2fc146fa7a14aa1c95f2e978be7fdb65a44c8e59b946741c5",
        facts: ["liquidation published 14 Oct 2026; stopped paying 28 Mar 2025", "open proceeding"],
        hard: 1,
      },
      {
        name: "filed accounts",
        usd: 0.02,
        st: "settled",
        url: "…/entreprise/841936560/documents",
        tx: "0xb2b85e057800e5ac30aabcc3fe44d71a0d4a1f8839e959b32a30e0f77cbdf3cb",
        facts: ["last accounts FY2019, filed Dec 2020", "filed 4 months late", "63 months overdue"],
      },
      {
        name: "financials",
        usd: 0.01,
        st: "settled",
        url: "…/entreprise/841936560/finances",
        tx: "0x59145fcc1b9a4e8b3f21e582c98e6f1d8f480a3dcf87f75bc227368f7124de1c",
        facts: ["FY2019: loss €226"],
      },
      {
        name: "court decisions",
        usd: 0.01,
        st: "settled",
        url: "…/entreprise/841936560/contentieux",
        tx: "0xcbfc4d231edf4cbb9b7bdcaaf4f59bb520bd838d8d9ca48f850b74e8ba710d69",
        facts: [],
      },
      {
        name: "vendor's credit limit",
        usd: 0.12,
        st: "settled",
        url: "…/entreprise/841936560/encours",
        tx: "0x49f7e1aaf06eaa0b775c66f87487de7cd7da96749c2397c96e59af69b68439c7",
        facts: ["risk class: proven default"],
      },
    ],
  },
  danone: {
    checkId: "73903a1b-ab5c-4a76-9b07-b27cf06219ed",
    name: "DANONE",
    siren: "552032534",
    amount: "€4,000",
    budget: 0.15,
    total: 0.025,
    floor: false,
    decideMs: 15,
    decideNote: "none of its 10 rules fires",
    terms: "Net 30",
    l1: 'Net 30 kept · <span class="why">no rule in your freelancer policy fires</span>',
    l2: '<span class="fin">Full amount due within 30 days · up to €4,000 on credit.</span>',
    review: { score: 77, route: "review", note: "agrees with Net 30; flags the debt ratio for a second look" },
    src: [
      {
        name: "registry profile",
        usd: 0.005,
        st: "settled",
        url: "api.sirenic.eu/v1/entreprise/552032534",
        tx: "0x716ad000fb4100bcd3d82cb401899c99f7a5697ab6528fdf54383824c11a4faa",
        facts: ["name", "legal form 5599 (SA)", "created 1955", "NAF 70.10Z", "workforce band", "VAT number", "active in the register"],
      },
      {
        name: "gazette alerts",
        usd: 0.01,
        st: "settled",
        url: "…/entreprise/552032534/alertes",
        tx: "0xa385f925bc53e5af17476f47e7bacf11b9267c3be851457c34d4c6fa55be735a",
        facts: [],
      },
      { name: "filed accounts", usd: 0.02, st: "skipped", facts: [] },
      {
        name: "financials",
        usd: 0.01,
        st: "settled",
        url: "…/entreprise/552032534/finances",
        tx: "0x562cab88ebe8f3c59c91d11406fffd6746487d03c2e8840c8d3d73a1ff771c44",
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
