export type Jurisdiction = "FR" | "UK" | "EU" | "BR" | "US";

export type TermsMode = "net" | "deposit" | "prepay" | "decline";

/** Payment terms offered to a client. Amounts in EUR, whole euros. */
export interface Terms {
  mode: TermsMode;
  netDays?: number;
  creditLimitEur?: number;
  depositPct?: number;
}

export type FactKind =
  | "identity.name"
  | "identity.legal_form"
  | "identity.created_on"
  | "identity.naf"
  | "identity.workforce_band"
  | "identity.vat"
  | "status.active"
  | "status.ceased_on"
  | "proceeding.open"
  | "proceeding.past"
  | "accounts.filed"
  | "accounts.overdue_months"
  | "accounts.late_filing_months"
  | "finance.year"
  | "court.decision"
  | "bodacc.event"
  | "sanctions.hit"
  | "vat.valid"
  | "vendor.credit_limit";

/**
 * One piece of evidence. `observedAt` is the date the fact became public
 * (publication or filing date), which is what point-in-time filtering uses.
 */
export interface Fact {
  id: string;
  kind: FactKind;
  value: unknown;
  observedAt: string;
  source: string;
  receiptId: string | null;
}

export type ReceiptStatus = "settled" | "refused" | "free" | "failed";

/** A paid (or refused) lookup. Amounts in USD, up to 6 decimals. */
export interface Receipt {
  id: string;
  merchant: string;
  url: string;
  amountUsd: number;
  txHash: string | null;
  network: string;
  paidAt: string;
  payer: "house" | "user";
  status: ReceiptStatus;
  refusalCode?: string;
}

export interface Reason {
  factIds: string[];
  text: string;
}

export interface Decision {
  terms: Terms;
  reasons: Reason[];
  confidence: "low" | "medium" | "high";
}

export interface Policy {
  id: string;
  name: string;
  version: number;
  text: string;
  hash: string;
}
