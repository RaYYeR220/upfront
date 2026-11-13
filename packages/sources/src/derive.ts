import type { Fact } from "@upfront/core";
import { addMonths, monthsBetween } from "./dates.ts";

/** Months after a fiscal year closes by which its accounts should be on file (12 + 7). */
const FILING_GRACE_MONTHS = 19;
/** A first fiscal year can run up to 24 months, plus 7 to file. */
const FIRST_FILING_MONTHS = 31;

type Notice = {
  category?: string;
  publishedOn?: string;
  [k: string]: unknown;
};

function stateOf(category: string): "open" | "past" | null {
  if (category.startsWith("ouverture") || category.startsWith("conversion")) return "open";
  if (category.startsWith("plan") || category.startsWith("cloture") || category.includes("resolution")) return "past";
  return null;
}

/**
 * Facts computed from other facts, always relative to a reference date
 * (the as-of date in a backtest, today in a live check). Run it AFTER
 * point-in-time filtering so nothing from the future shapes the result.
 */
export function deriveFacts(facts: Fact[], refDate: string, opts: { documentsFetched?: boolean } = {}): Fact[] {
  const out: Fact[] = [];

  // Insolvency proceedings: replay gazette notices in publication order.
  const notices = facts
    .filter((f) => f.kind === "bodacc.event" && (f.value as Notice)?.category)
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  let open: Fact | null = null;
  for (const n of notices) {
    const v = n.value as Notice;
    const s = stateOf(String(v.category));
    if (s === "open") open = n;
    else if (s === "past") {
      out.push({
        ...n,
        id: `drv:proceeding.past#${out.length}`,
        kind: "proceeding.past",
        value: { ...v, openedBy: open ? (open.value as Notice) : null },
      });
      open = null;
    }
  }
  if (open) {
    const v = open.value as Notice;
    const category = String(v.category).startsWith("conversion") ? "ouverture_liquidation" : v.category;
    out.push({ ...open, id: `drv:proceeding.open#${out.length}`, kind: "proceeding.open", value: { ...v, category } });
  }

  // Accounts filing lateness.
  const filed = facts
    .filter((f) => f.kind === "accounts.filed")
    .map((f) => f.value as { closingDate: string; filedOn: string })
    .sort((a, b) => b.closingDate.localeCompare(a.closingDate));
  const latest = filed[0];
  const createdOn = facts.find((f) => f.kind === "identity.created_on")?.value as string | undefined;
  if (latest) {
    // How late the most recent filing itself was: months past the legal filing deadline (closing + 7 months).
    const lastFiled = [...filed].sort((a, b) => b.filedOn.localeCompare(a.filedOn))[0]!;
    const deadline = addMonths(lastFiled.closingDate, FILING_GRACE_MONTHS - 12);
    out.push({
      id: "drv:accounts.late_filing_months#0",
      kind: "accounts.late_filing_months",
      value: Math.max(0, monthsBetween(deadline, lastFiled.filedOn)),
      observedAt: lastFiled.filedOn,
      source: "derived",
      receiptId: facts.find((f) => f.kind === "accounts.filed")?.receiptId ?? null,
    });
    const due = addMonths(latest.closingDate, FILING_GRACE_MONTHS);
    out.push({
      id: "drv:accounts.overdue_months#0",
      kind: "accounts.overdue_months",
      value: Math.max(0, monthsBetween(due, refDate)),
      observedAt: refDate,
      source: "derived",
      receiptId: facts.find((f) => f.kind === "accounts.filed")?.receiptId ?? null,
    });
  } else if (opts.documentsFetched && createdOn) {
    const due = addMonths(createdOn, FIRST_FILING_MONTHS);
    out.push({
      id: "drv:accounts.overdue_months#0",
      kind: "accounts.overdue_months",
      value: Math.max(0, monthsBetween(due, refDate)),
      observedAt: refDate,
      source: "derived (no accounts ever filed)",
      receiptId: null,
    });
  }

  return out;
}
