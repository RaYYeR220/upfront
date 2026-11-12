import { randomBytes, randomUUID } from "node:crypto";
import type { Client } from "@libsql/client";
import { computeFloor, type Fact } from "@upfront/core";
import { claimDeadline, claimDraft, liquidatorFromNotice } from "@upfront/engine";
import type { KiteExecutor, PayerRef } from "@upfront/kite";
import { deriveFacts, parseSirenic, WATCH_LOOKUP } from "@upfront/sources";
import { houseSpentLastDay, insertReceipt } from "./repo.ts";
import type { Notifier } from "./telegram.ts";

export interface WatchRow {
  id: string;
  siren: string;
  label: string | null;
  invoiceAmountEur: number;
  dueOn: string | null;
  lastCheckedOn: string;
  token: string;
  /** Single-use token for the Telegram deep link; cleared once a chat is linked. */
  linkToken: string | null;
  telegramChatId: string | null;
}

const toWatch = (r: Record<string, unknown>): WatchRow => ({
  id: String(r.id),
  siren: String(r.siren),
  label: (r.label as string | null) ?? null,
  invoiceAmountEur: Number(r.invoice_amount_eur),
  dueOn: (r.due_on as string | null) ?? null,
  lastCheckedOn: String(r.last_checked_on),
  token: String(r.token),
  linkToken: (r.link_token as string | null) ?? null,
  telegramChatId: (r.telegram_chat_id as string | null) ?? null,
});

export async function createWatch(
  db: Client,
  w: { siren: string; label?: string; invoiceAmountEur: number; dueOn?: string; since: string; lastCheckId?: string; ipHash?: string | null },
): Promise<WatchRow> {
  const id = randomUUID();
  const token = randomBytes(18).toString("base64url");
  const linkToken = randomBytes(18).toString("base64url");
  await db.execute({
    sql: `INSERT INTO watches (id, created_at, siren, label, invoice_amount_eur, due_on, last_checked_on, token, link_token, ip_hash, last_check_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, new Date().toISOString(), w.siren, w.label ?? null, w.invoiceAmountEur, w.dueOn ?? null, w.since, token, linkToken, w.ipHash ?? null, w.lastCheckId ?? null],
  });
  return { id, siren: w.siren, label: w.label ?? null, invoiceAmountEur: w.invoiceAmountEur, dueOn: w.dueOn ?? null, lastCheckedOn: w.since, token, linkToken, telegramChatId: null };
}

export async function activeWatchesByIp(db: Client, ipHash: string): Promise<number> {
  const r = await db.execute({ sql: "SELECT COUNT(*) AS n FROM watches WHERE ip_hash = ? AND status = 'active'", args: [ipHash] });
  return Number(r.rows[0]?.n ?? 0);
}

export async function watchByToken(db: Client, token: string): Promise<WatchRow | null> {
  const r = await db.execute({ sql: "SELECT * FROM watches WHERE token = ?", args: [token] });
  return r.rows[0] ? toWatch(r.rows[0] as unknown as Record<string, unknown>) : null;
}

/** Links a chat once. The link token is single-use and a linked watch can't be redirected. */
export async function linkTelegram(db: Client, linkToken: string, chatId: string): Promise<WatchRow | null> {
  const found = await db.execute({ sql: "SELECT token FROM watches WHERE link_token = ? AND telegram_chat_id IS NULL", args: [linkToken] });
  const token = found.rows[0]?.token;
  if (typeof token !== "string") return null;
  const r = await db.execute({
    sql: "UPDATE watches SET telegram_chat_id = ?, link_token = NULL WHERE link_token = ? AND telegram_chat_id IS NULL",
    args: [chatId, linkToken],
  });
  return r.rowsAffected === 1 ? watchByToken(db, token) : null;
}

export async function watchEvents(db: Client, watchId: string) {
  const r = await db.execute({ sql: "SELECT at, kind, payload FROM watch_events WHERE watch_id = ? ORDER BY id DESC LIMIT 50", args: [watchId] });
  return r.rows.map((x) => ({ at: String(x.at), kind: String(x.kind), payload: JSON.parse(String(x.payload)) }));
}

export interface WatchDeps {
  db: Client;
  kite: KiteExecutor;
  payer: PayerRef;
  notifier: Notifier | null;
  /** Free lookup of the full gazette notice text (for the representative's name). */
  noticeText?: (noticeId: string) => Promise<string | null>;
  webUrl: string;
  today: string;
  /** Daily cap on house spending; a watch lookup is skipped rather than overspend. */
  houseDailyCapUsd?: number;
}

const eur = (n: number) => new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

/** One pass over every active watch: buy the gazette changes since the last pass and alert on news. One failing watch never stops the others. */
export async function runWatches(d: WatchDeps): Promise<{ checked: number; alerts: number; failed: number; skipped: number }> {
  const rows = await d.db.execute("SELECT * FROM watches WHERE status = 'active'");
  let alerts = 0;
  let failed = 0;
  let skipped = 0;
  for (const raw of rows.rows) {
    const w = toWatch(raw as unknown as Record<string, unknown>);
    if (d.houseDailyCapUsd !== undefined && (await houseSpentLastDay(d.db)) + WATCH_LOOKUP.priceUsd > d.houseDailyCapUsd) {
      skipped++;
      await event(d.db, w.id, "skipped_budget", {}).catch(() => {});
      continue;
    }
    try {
      if (await processWatch(d, w)) alerts++;
    } catch (e) {
      failed++;
      console.error(`watch ${w.id} failed`, e);
      await event(d.db, w.id, "error", { message: "watch_failed" }).catch(() => {});
    }
  }
  return { checked: rows.rows.length, alerts, failed, skipped };
}

/** Returns true when an alert was raised. */
async function processWatch(d: WatchDeps, w: WatchRow): Promise<boolean> {
  const url = WATCH_LOOKUP.url(w.siren, { since: w.lastCheckedOn });
  const res = await d.kite.execute({ url, idempotencyKey: `watch:${w.id}:${d.today}` }, d.payer);
  await insertReceipt(d.db, res.receipt, { watchId: w.id });
  if (res.receipt.status !== "settled") {
    await event(d.db, w.id, "lookup_failed", { code: res.receipt.refusalCode ?? res.receipt.status });
    return false;
  }
  const facts: Fact[] = parseSirenic("changements", res.body, { receiptId: res.receipt.id, fetchedAt: d.today });
  await d.db.execute({ sql: "UPDATE watches SET last_checked_on = ? WHERE id = ?", args: [d.today, w.id] });
  if (facts.length === 0) {
    await event(d.db, w.id, "no_change", { since: w.lastCheckedOn, costUsd: res.receipt.amountUsd });
    return false;
  }
  const derived = deriveFacts(facts, d.today);
  const floor = computeFloor(derived);
  const open = derived.find((f) => f.kind === "proceeding.open");
  const name = w.label ?? w.siren;
  let text: string;
  if (open) {
    const v = open.value as {
      category: string;
      publishedOn: string;
      judgmentDate: string | null;
      court: string | null;
      noticeId: string | null;
      cessationDate: string | null;
    };
    const deadline = claimDeadline(v.publishedOn);
    const fullText = v.noticeId && d.noticeText ? await d.noticeText(v.noticeId).catch(() => null) : null;
    const representative = fullText ? liquidatorFromNotice(fullText) : null;
    const draft = claimDraft({
      creditor: { name: "[your business]", address: "[your address]" },
      debtor: { name, siren: w.siren },
      amountEur: w.invoiceAmountEur,
      invoiceRefs: ["[invoice numbers]"],
      representative,
      court: v.court ?? "Tribunal de commerce",
      judgmentDate: v.judgmentDate,
      publishedOn: v.publishedOn,
    });
    const liquidation = v.category.includes("liquidation");
    text = [
      `${name}: ${liquidation ? "liquidation" : "insolvency proceeding"} opened (${v.court ?? "commercial court"}, published ${v.publishedOn}).`,
      v.cessationDate ? `The court dates their payment stop to ${v.cessationDate}.` : null,
      `You have ${eur(w.invoiceAmountEur)} outstanding. ${liquidation ? "Stop work now." : "Ask for prepayment on anything new."}`,
      `Declare your claim by ${deadline}${representative ? ` to ${representative.name} (${representative.role})` : ""}. Draft ready: ${d.webUrl}/watch/${w.token}`,
    ]
      .filter(Boolean)
      .join("\n");
    await event(d.db, w.id, "insolvency", { floor: floor.floor, deadline, representative, draft, notice: v });
  } else {
    text = `${name}: ${facts.length} new gazette notice${facts.length > 1 ? "s" : ""} since ${w.lastCheckedOn}. Re-check before the next invoice: ${d.webUrl}/watch/${w.token}`;
    await event(d.db, w.id, "notice", { notices: facts.map((f) => f.value) });
  }
  if (d.notifier && w.telegramChatId) {
    // A failed message must not lose the alert: it stays on the watch page.
    await d.notifier.send(w.telegramChatId, text).catch(async (e) => {
      console.error(`telegram send failed for watch ${w.id}`, e);
      await event(d.db, w.id, "notify_failed", {});
    });
  }
  return true;
}

async function event(db: Client, watchId: string, kind: string, payload: unknown) {
  await db.execute({
    sql: "INSERT INTO watch_events (watch_id, at, kind, payload) VALUES (?, ?, ?, ?)",
    args: [watchId, new Date().toISOString(), kind, JSON.stringify(payload)],
  });
}

/** BODACC open data, free: the full text of one notice, for the representative's name and address. */
export function bodaccNoticeText(f: typeof fetch = fetch) {
  return async (noticeId: string): Promise<string | null> => {
    const where = encodeURIComponent(`id='${noticeId.replace(/[^A-Za-z0-9]/g, "")}'`);
    const r = await f(
      `https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records?select=jugement&where=${where}&limit=1`,
    );
    if (!r.ok) return null;
    const body = (await r.json()) as { results?: { jugement?: string }[] };
    const j = body.results?.[0]?.jugement;
    if (!j) return null;
    try {
      return String((JSON.parse(j) as { complementJugement?: string }).complementJugement ?? "");
    } catch {
      return null;
    }
  };
}
