import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { openDb } from "./db.ts";
import { engineDeps, loadConfig } from "./deps.ts";
import { Hub } from "./hub.ts";
import { CheckService } from "./service.ts";

const cfg = loadConfig();
const db = await openDb(cfg.databaseUrl);
const hub = new Hub();
const engine = engineDeps(cfg);
const checks = new CheckService({
  db,
  hub,
  engine,
  limits: { checksPerIpPerDay: cfg.checksPerIpPerDay, houseDailyCapUsd: cfg.houseDailyCapUsd },
  salt: cfg.ipSalt,
  review: { mode: cfg.reviewMode, timeoutMs: 240_000, pollMs: 4_000 },
});

const app = createApp({ db, hub, checks, adminToken: cfg.adminToken, corsOrigins: cfg.corsOrigins });

serve({ fetch: app.fetch, port: cfg.port }, (info) => {
  console.log(`upfront api listening on :${info.port}`);
});
