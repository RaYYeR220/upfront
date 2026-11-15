import { type EngineDeps, servPort } from "@upfront/engine";
import { createKpassExecutor } from "@upfront/kite";
import { reppoClient } from "@upfront/reppo";
import { type ProgramCache, programCache, servClient } from "@upfront/serv";

export interface Config {
  port: number;
  databaseUrl: string;
  servApiKey: string;
  reppoApiKey: string | null;
  kiteHome: string;
  kpassBin: string;
  corsOrigins: string[];
  adminToken: string | undefined;
  ipSalt: string;
  checksPerIpPerDay: number;
  houseDailyCapUsd: number;
  reviewMode: "async" | "skip";
  telegramToken: string | null;
  publicWebUrl: string;
}

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

export function loadConfig(): Config {
  return {
    port: Number(process.env.PORT ?? 8787),
    databaseUrl: process.env.DATABASE_URL ?? "file:upfront.db",
    servApiKey: process.env.UPFRONT_OFFLINE === "1" ? "" : need("SERV_API_KEY"),
    reppoApiKey: process.env.REPPO_API_KEY ?? null,
    kiteHome: process.env.KITE_HOME ?? "/data/kite/house",
    kpassBin: process.env.KPASS_BIN ?? "kpass",
    corsOrigins: (process.env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    adminToken: process.env.ADMIN_TOKEN,
    ipSalt: need("IP_SALT"),
    checksPerIpPerDay: Number(process.env.CHECKS_PER_IP_PER_DAY ?? 3),
    houseDailyCapUsd: Number(process.env.HOUSE_DAILY_CAP_USD ?? 5),
    reviewMode: process.env.REVIEW_MODE === "skip" ? "skip" : "async",
    telegramToken: process.env.UPFRONT_TELEGRAM_BOT_TOKEN ?? null,
    publicWebUrl: process.env.PUBLIC_WEB_URL ?? "http://localhost:3000",
  };
}

export function engineDeps(cfg: Config): Omit<EngineDeps, "emit"> & { programs: ProgramCache } {
  const client = servClient(cfg.servApiKey);
  const programs = programCache(client, { dir: process.env.PROGRAMS_DIR ?? "/data/programs" });
  return {
    programs,
    kite: createKpassExecutor({ bin: cfg.kpassBin }),
    payer: { payer: "house", home: cfg.kiteHome },
    serv: servPort(client, { programs }),
    reppo: cfg.reppoApiKey ? reppoClient(cfg.reppoApiKey) : null,
    now: () => new Date(),
  };
}
