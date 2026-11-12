import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeKite } from "@upfront/kite";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { startToken } from "../src/telegram.ts";
import { createWatch, linkTelegram, runWatches, watchEvents } from "../src/watch.ts";

const fx = (n: string): unknown =>
  JSON.parse(readFileSync(join(import.meta.dirname, "../../../packages/sources/test/fixtures/sirenic", `${n}.json`), "utf8"));
const KD = "841936560";
const URL_SINCE = `https://api.sirenic.eu/v1/entreprise/${KD}/changements?depuis=2026-09-27`;

async function setup(body: unknown) {
  const db = await openDb(":memory:");
  const sent: { chatId: string; text: string }[] = [];
  const kite = new FakeKite({ [URL_SINCE]: { status: 200, body, priceUsd: 0.01 } });
  const w = await createWatch(db, { siren: KD, label: "KD Soccer Consulting", invoiceAmountEur: 6800, since: "2026-09-27" });
  await linkTelegram(db, w.linkToken!, "555");
  const run = () =>
    runWatches({
      db,
      kite,
      payer: { payer: "house", home: "/tmp" },
      notifier: { send: async (chatId, text) => void sent.push({ chatId, text }) },
      noticeText: async () =>
        "Jugement prononçant la liquidation judiciaire, désignant liquidateur Selarl Exemple Me Martin 1 rue Haute 77100 Meaux.Les déclarations des créances…",
      webUrl: "https://upfront.example",
      today: "2026-11-12",
    });
  return { db, sent, kite, w, run };
}

describe("runWatches", () => {
  it("alerts once with the amount, the claim deadline and the representative when a client enters liquidation", async () => {
    const { db, sent, kite, w, run } = await setup(fx("entreprise-siren-changements"));
    expect(await run()).toMatchObject({ checked: 1, alerts: 1, failed: 0 });
    expect(kite.calls).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.chatId).toBe("555");
    expect(sent[0]!.text).toContain("€6,800");
    expect(sent[0]!.text).toContain("2026-12-14");
    expect(sent[0]!.text).toContain("Meaux");
    expect(sent[0]!.text).toContain("Selarl Exemple");
    expect(sent[0]!.text).toContain("2025-03-28");
    const [ev] = await watchEvents(db, w.id);
    expect(ev).toMatchObject({ kind: "insolvency", payload: { deadline: "2026-12-14", floor: "decline" } });
    expect(ev!.payload.draft).toContain("Déclaration de créance");
  });

  it("stays quiet when nothing changed and still records the paid lookup", async () => {
    const { db, sent, kite, w, run } = await setup({ nouveaux_evenements_bodacc: { nombre: 0, annonces: [] } });
    expect(await run()).toMatchObject({ checked: 1, alerts: 0, failed: 0 });
    expect(sent).toHaveLength(0);
    expect(kite.calls).toHaveLength(1);
    const receipts = await db.execute("SELECT watch_id, amount_usd FROM receipts");
    expect(receipts.rows).toHaveLength(1);
    expect(Number(receipts.rows[0]!.amount_usd)).toBe(0.01);
    expect((await watchEvents(db, w.id))[0]!.kind).toBe("no_change");
  });
});

describe("runWatches resilience", () => {
  it("keeps going when one watch fails and when Telegram is down", async () => {
    const db = await openDb(":memory:");
    const good = await createWatch(db, { siren: KD, invoiceAmountEur: 6800, since: "2026-09-27" });
    await linkTelegram(db, good.linkToken!, "1");
    await createWatch(db, { siren: "000000000", invoiceAmountEur: 100, since: "2026-09-27" });
    const kite = new FakeKite({ [URL_SINCE]: { status: 200, body: fx("entreprise-siren-changements"), priceUsd: 0.01 } });
    const throwingKite = {
      execute: async (req: { url: string; idempotencyKey: string }, payer: { payer: "house" | "user"; home: string }) => {
        if (req.url.includes("000000000")) throw new Error("boom");
        return kite.execute(req, payer);
      },
      activity: async () => ({ events: [] }),
    };
    const r = await runWatches({
      db,
      kite: throwingKite,
      payer: { payer: "house", home: "/tmp" },
      notifier: { send: async () => { throw new Error("telegram down"); } },
      webUrl: "https://upfront.example",
      today: "2026-11-12",
    });
    expect(r).toMatchObject({ checked: 2, alerts: 1, failed: 1 });
    const kinds = (await watchEvents(db, good.id)).map((e) => e.kind);
    expect(kinds).toContain("insolvency");
    expect(kinds).toContain("notify_failed");
  });

  it("skips paid lookups once the house budget is spent", async () => {
    const db = await openDb(":memory:");
    await createWatch(db, { siren: KD, invoiceAmountEur: 6800, since: "2026-09-27" });
    const kite = new FakeKite({});
    const r = await runWatches({ db, kite, payer: { payer: "house", home: "/tmp" }, notifier: null, webUrl: "x", today: "2026-11-12", houseDailyCapUsd: 0 });
    expect(r).toMatchObject({ skipped: 1 });
    expect(kite.calls).toHaveLength(0);
  });
});

describe("startToken", () => {
  it("reads the deep-link token", () => {
    expect(startToken({ message: { text: "/start abcDEF123_-xyz", chat: { id: 42 } } })).toEqual({ chatId: "42", token: "abcDEF123_-xyz" });
    expect(startToken({ message: { text: "hello", chat: { id: 42 } } })).toBeNull();
  });
});

describe("watch routes", () => {
  it("creates a watch, links Telegram only with the webhook secret, and never exposes the chat id", async () => {
    const { Hono } = await import("hono");
    const { registerWatchRoutes } = await import("../src/routes-watch.ts");
    const db = await openDb(":memory:");
    const sent: string[] = [];
    const app = new Hono();
    registerWatchRoutes(app, {
      db,
      telegramSecret: "sekret",
      telegramBotUsername: "upfront_watch_bot",
      notifier: { send: async (_c, t) => void sent.push(t) },
      webUrl: "https://upfront.example",
      maxActiveWatches: 10,
      maxWatchesPerIp: 5,
      salt: "s",
      clientIp: () => "1.2.3.4",
      watchDeps: () => {
        throw new Error("not used");
      },
    });
    const res = await app.request("/api/watch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ siren: KD, invoiceAmountEur: 6800, label: "KD" }),
    });
    expect(res.status).toBe(201);
    const { token, telegramLink } = (await res.json()) as { token: string; telegramLink: string };
    const linkToken = telegramLink.split("start=")[1]!;
    expect(linkToken).not.toBe(token);
    const update = { message: { text: `/start ${linkToken}`, chat: { id: 777 } } };
    const forged = await app.request("/api/telegram/webhook", { method: "POST", body: JSON.stringify(update), headers: { "content-type": "application/json" } });
    expect(forged.status).toBe(403);
    await app.request("/api/telegram/webhook", {
      method: "POST",
      body: JSON.stringify(update),
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "sekret" },
    });
    expect(sent[0]).toMatch(/Watching KD/);
    // The link is single-use: a second chat can't take the alerts over.
    await app.request("/api/telegram/webhook", {
      method: "POST",
      body: JSON.stringify({ message: { text: `/start ${linkToken}`, chat: { id: 999 } } }),
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "sekret" },
    });
    expect(sent[1]).toMatch(/already used/);
    const view = (await (await app.request(`/api/watch/${token}`)).json()) as Record<string, unknown>;
    expect(view.telegramLinked).toBe(true);
    expect(JSON.stringify(view)).not.toContain("777");
    expect(view.token).toBeUndefined();
    expect(view.linkToken).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain("999");
  });
});
