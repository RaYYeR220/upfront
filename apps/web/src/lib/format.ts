import type { Fact, NodeName, Receipt, Terms } from "./types.ts";

export const eur = (n: number) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

export function usd(n: number): string {
  if (n === 0) return "$0";
  const digits = n < 0.01 ? 3 : 2;
  return `$${n.toFixed(digits)}`;
}

export function termsHeadline(t: Terms): string {
  switch (t.mode) {
    case "net":
      return `Net ${t.netDays ?? 30}`;
    case "deposit":
      return `${t.depositPct ?? 50}% deposit`;
    case "prepay":
      return "Prepay only";
    case "decline":
      return "Decline";
  }
}

export function termsDetail(t: Terms): string | null {
  if (t.mode === "net" && t.creditLimitEur) return `up to ${eur(t.creditLimitEur)} on credit`;
  if (t.mode === "deposit") return "balance on delivery";
  if (t.mode === "prepay") return "full payment before work starts";
  if (t.mode === "decline") return "don't extend credit or take the work";
  return null;
}

const MODE_RANK = { net: 1, deposit: 2, prepay: 3, decline: 4 } as const;
export const stricterThanRequested = (t: Terms) => MODE_RANK[t.mode] > 1;

export const fmtDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export const shortHash = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;
export const txUrl = (r: Receipt) =>
  r.txHash && r.network === "eip155:8453" ? `https://basescan.org/tx/${r.txHash}` : null;

/** Which public source a lookup URL bought from, in plain words. */
export function sourceOf(url: string): string {
  const path = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  })();
  if (path.endsWith("/alertes") || path.includes("/changements")) return "gazette";
  if (path.endsWith("/documents")) return "filings";
  if (path.endsWith("/finances")) return "financials";
  if (path.endsWith("/contentieux")) return "court";
  if (path.endsWith("/encours")) return "vendor limit";
  if (path.includes("/recherche")) return "search";
  if (/\/entreprise\/\d{9}$/.test(path)) return "registry";
  return "record";
}

export const sourceOfFact = (f: Fact) => {
  const s = f.source.replace("sirenic/", "");
  return (
    { entreprise: "registry", alertes: "gazette", changements: "gazette", documents: "filings", finances: "financials", contentieux: "court", encours: "vendor limit" } as Record<string, string>
  )[s] ?? (f.source === "derived" || f.source.startsWith("derived") ? "derived" : s);
};

type V = Record<string, unknown>;

/** A fact as one short sentence a person can read. */
export function factSentence(f: Fact): string {
  const v = (f.value ?? {}) as V;
  switch (f.kind) {
    case "identity.name":
      return String(f.value);
    case "identity.created_on":
      return `Registered ${fmtDate(String(f.value))}`;
    case "identity.legal_form":
      return `Legal form ${String(f.value)}`;
    case "identity.naf":
      return `Activity code ${String(f.value)}`;
    case "identity.vat":
      return `VAT number ${String(f.value)}`;
    case "identity.workforce_band":
      return `Workforce band ${String(f.value)}`;
    case "status.active":
      return "Active in the register";
    case "status.ceased_on":
      return `Ceased trading ${v ? fmtDate(String(f.value)) : ""}`;
    case "proceeding.open": {
      const cat = String(v.category ?? "");
      const what = cat.includes("liquidation") ? "Liquidation" : cat.includes("sauvegarde") ? "Safeguard proceeding" : "Reorganisation";
      return `${what} published ${fmtDate(String(v.publishedOn ?? f.observedAt))}${v.cessationDate ? `; payments stopped ${fmtDate(String(v.cessationDate))}` : ""}`;
    }
    case "proceeding.past":
      return `Past insolvency proceeding, closed ${fmtDate(f.observedAt)}`;
    case "bodacc.event":
      return `Gazette notice ${fmtDate(f.observedAt)}: ${String(v.nature ?? v.family ?? "notice")}`;
    case "accounts.filed":
      return `Accounts for ${String(v.closingDate ?? "").slice(0, 4)} filed ${fmtDate(String(v.filedOn ?? f.observedAt))}`;
    case "accounts.late_filing_months":
      return Number(f.value) > 0 ? `Last accounts filed ${f.value} months after the deadline` : "Last accounts filed on time";
    case "accounts.overdue_months":
      return Number(f.value) > 0 ? `Accounts ${f.value} months overdue` : "Accounts filed on time";
    case "finance.year": {
      const rev = typeof v.revenue === "number" ? eur(v.revenue) : "n/a";
      const net = typeof v.netIncome === "number" ? eur(v.netIncome) : "n/a";
      return `${String(v.closingDate ?? "").slice(0, 4)}: revenue ${rev}, result ${net}`;
    }
    case "court.decision":
      return `Court decision ${fmtDate(String(v.date ?? f.observedAt))}: ${String(v.nature ?? "")}`;
    case "sanctions.hit":
      return "On a sanctions list";
    case "vat.valid":
      return f.value ? "VAT number valid" : "VAT number invalid";
    case "vendor.credit_limit":
      return `Data vendor's indicative limit: ${typeof v.amountEur === "number" ? eur(v.amountEur) : "none"}`;
  }
}

export const NODE_COPY: Record<NodeName, { title: string; who?: string; what: string }> = {
  resolve: { title: "Resolve", what: "Find the exact company in the register." },
  plan: { title: "Plan", who: "SERV", what: "Decide which records are worth buying for this amount." },
  buy: { title: "Buy", who: "Kite", what: "Pay for each record within the spending cap." },
  extract: { title: "Extract", what: "Turn the records into dated facts." },
  floors: { title: "Floors", what: "Hard rules the decision can never go below." },
  decide: { title: "Decide", who: "SERV", what: "Apply your policy to the facts." },
  review: { title: "Review", who: "Reppo", what: "An independent panel checks the decision." },
  issue: { title: "Terms", what: "The terms, ready for your quote." },
};
