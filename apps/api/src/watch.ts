import { randomBytes, randomUUID } from "node:crypto";
import type { Client } from "@libsql/client";
import { computeFloor, type Fact } from "@upfront/core";
import { claimDeadline, claimDraft, liquidatorFromNotice } from "@upfront/engine";
import type { KiteExecutor, PayerRef } from "@upfront/kite";
import { deriveFacts, parseSirenic, WATCH_LOOKUP } from "@upfront/sources";
import { insertReceipt } from "./repo.ts";
import type { Notifier } from "./telegram.ts";

export interface WatchRow {
  id: string;
  siren: string;
  label: string | null;
  invoiceAmountEur: number;
  dueOn: string | null;
  lastCheckedOn: string;
  token: string;
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
  telegramChatId: (r.telegram_chat_id as string | null) ?? null,
});

export async function createWatch(
  db: Client,
  w: { siren: string; label?: string; invoiceAmountEur: number; dueOn?: string; since: string; lastCheckId?: string },
): Promise<WatchRow> {
  const id = randomUUID();
  const token = randomBytes(12).toString("base64url");
  await db.execute({
    sql: `INSERT INTO watches (id, created_at, siren, label, invoice_amount_eur, due_on, last_checked_on, token, last_check_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, new Date().toISOString(), w.siren, w.label ?? null, w.invoiceAmountEur, w.dueOn ?? null, w.since, token, w.lastCheckId ?? null],
  });
  return { id, siren: w.siren, label: w.label ?? null, invoiceAmountEur: w.invoiceAmountEur, dueOn: w.dueOn ?? null, lastCheckedOn: w.since, token, telegramChatId: null };
}

export async function watchByToken(db: Client, token: string): Promise<WatchRow | null> {
  const r = await db.execute({ sql: "SELECT * FROM watches WHERE token = ?", args: [token] });
  return r.rows[0] ? toWatch(r.rows[0] as unknown as Record<string, unknown>) : null;
}

export async function linkTelegram(db: Client, token: string, chatId: string): Promise<WatchRow | null> {
  await db.execute({ sql: "UPDATE watches SET telegram_chat_id = ? WHERE token = ?", args: [chatId, token] });
  return watchByToken(db, token);
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
}

const eur = (n: number) => new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

/** One pass over every active watch: buy the gazette changes since the last pass and alert on news. */
export async function runWatches(d: WatchDeps): Promise<{ checked: number; alerts: number }> {
  const rows = await d.db.execute("SELECT * FROM watches WHERE status = 'active'");
  let alerts = 0;
  for (const raw of rows.rows) {
    const w = toWatch(raw as unknown as Record<string, unknown>);
    const url = WATCH_LOOKUP.url(w.siren, { since: w.lastCheckedOn });
    const res = await d.kite.execute({ url, idempotencyKey: `watch:${w.id}:${d.today}` }, d.payer);
    await insertReceipt(d.db, res.receipt, { watchId: w.id });
    if (res.receipt.status !== "settled") {
      await event(d.db, w.id, "lookup_failed", { code: res.receipt.refusalCode ?? res.receipt.status });
      continue;
    }
    const facts: Fact[] = parseSirenic("changements", res.body, { receiptId: res.receipt.id, fetchedAt: d.today });
    await d.db.execute({ sql: "UPDATE watches SET last_checked_on = ? WHERE id = ?", args: [d.today, w.id] });
    if (facts.length === 0) {
      await event(d.db, w.id, "no_change", { since: w.lastCheckedOn, costUsd: res.receipt.amountUsd });
      continue;
    }
    const derived = deriveFacts(facts, d.today);
    const floor = computeFloor(derived);
    const open = derived.find((f) => f.kind === "proceeding.open");
    const name = w.label ?? w.siren;
    let text: string;
    let payload: Record<string, unknown>;
    if (open) {
      const v = open.value as { category: string; publishedOn: string; judgmentDate: string | null; court: string | null; noticeId: string | null; cessationDate: string | null };
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
      payload = { floor: floor.floor, deadline, representative, draft, notice: v };
      await event(d.db, w.id, "insolvency", payload);
    } else {
      text = `${name}: ${facts.length} new gazette notice${facts.length > 1 ? "s" : ""} since ${w.lastCheckedOn}. Re-check before the next invoice: ${d.webUrl}/watch/${w.token}`;
      payload = { notices: facts.map((f) => f.value) };
      await event(d.db, w.id, "notice", payload);
    }
    alerts++;
    if (d.notifier && w.telegramChatId) await d.notifier.send(w.telegramChatId, text);
  }
  return { checked: rows.rows.length, alerts };
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
