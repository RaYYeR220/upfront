import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import { registerAgentRoutes } from "./agents.ts";
import { clientIp, createApp } from "./app.ts";
import { openDb } from "./db.ts";
import { engineDeps, loadConfig } from "./deps.ts";
import { Hub } from "./hub.ts";
import { offlineEngine } from "./offline.ts";
import { registerWatchRoutes } from "./routes-watch.ts";
import { CheckService } from "./service.ts";
import { telegramNotifier } from "./telegram.ts";
import { bodaccNoticeText, runWatches, type WatchDeps } from "./watch.ts";

const cfg = loadConfig();
const db = await openDb(cfg.databaseUrl);
const hub = new Hub();
const engine = process.env.UPFRONT_OFFLINE === "1" ? offlineEngine() : engineDeps(cfg);
if (process.env.UPFRONT_OFFLINE === "1") console.warn("OFFLINE MODE: recorded evidence, fixed decisions, nothing is paid");
const notifier = cfg.telegramToken ? telegramNotifier(cfg.telegramToken) : null;
const checks = new CheckService({
  db,
  hub,
  engine,
  limits: { checksPerIpPerDay: cfg.checksPerIpPerDay, houseDailyCapUsd: cfg.houseDailyCapUsd },
  salt: cfg.ipSalt,
  review: { mode: cfg.reviewMode, timeoutMs: 240_000, pollMs: 4_000 },
});

const watchDeps = (): WatchDeps => ({
  db,
  kite: engine.kite,
  payer: engine.payer,
  notifier,
  noticeText: bodaccNoticeText(),
  webUrl: cfg.publicWebUrl,
  today: new Date().toISOString().slice(0, 10),
  houseDailyCapUsd: cfg.houseDailyCapUsd,
});

const trustProxy = process.env.TRUST_PROXY === "1";
const socketIp = (c: Context): string | null => {
  try {
    return getConnInfo(c).remote.address ?? null;
  } catch {
    return null;
  }
};

const app = createApp({
  db,
  hub,
  checks,
  adminToken: cfg.adminToken,
  corsOrigins: cfg.corsOrigins,
  trustProxy,
  socketIp,
  extraRoutes: (a) => {
    registerAgentRoutes(a, { db, checks, payTo: process.env.X402_PAY_TO ?? null, webUrl: cfg.publicWebUrl });
    registerWatchRoutes(a, {
      db,
      adminToken: cfg.adminToken,
      telegramSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
      telegramBotUsername: process.env.TELEGRAM_BOT_USERNAME,
      notifier,
      webUrl: cfg.publicWebUrl,
      maxActiveWatches: Number(process.env.MAX_ACTIVE_WATCHES ?? 300),
      maxWatchesPerIp: Number(process.env.MAX_WATCHES_PER_IP ?? 5),
      salt: cfg.ipSalt,
      clientIp: (c) => clientIp((n) => c.req.header(n), socketIp(c), trustProxy),
      watchDeps,
    });
  },
});

// Watches run once a day after 07:00 Paris time.
let lastWatchRun = "";
setInterval(async () => {
  const paris = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date())
    .reduce<Record<string, string>>((m, p) => ({ ...m, [p.type]: p.value }), {});
  const day = `${paris.year}-${paris.month}-${paris.day}`;
  if (Number(paris.hour) >= 7 && lastWatchRun !== day) {
    lastWatchRun = day;
    try {
      const r = await runWatches(watchDeps());
      console.log(`watch run ${day}: ${r.checked} checked, ${r.alerts} alerts`);
    } catch (e) {
      console.error("watch run failed", e);
    }
  }
}, 10 * 60_000);

serve({ fetch: app.fetch, port: cfg.port }, (info) => {
  console.log(`upfront api listening on :${info.port}`);
});
