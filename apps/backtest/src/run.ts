// Runs the backtest: every company in results/cohort.json is checked on the day it
// (or its matched twin) stopped paying, with only the evidence public on that day.
// Evidence is bought through Kite Passport once per company and kept in results/raw/
// so the other arms reuse it.
//
//   SERV_API_KEY=... KITE_HOME=... pnpm --filter @upfront/backtest run -- --limit 10
//   OPENROUTER_API_KEY=... adds the raw-model arm (same model, no SERV).
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { Decision, Fact, FloorResult, Terms } from "@upfront/core";
import { type CheckResult, runCheck, servPort } from "@upfront/engine";
import { createKpassExecutor } from "@upfront/kite";
import { baseModel, loadPolicy, MODELS, servClient } from "@upfront/serv";
import { ARMS, type Arm, decideArgs, net30Arm, rawArm, rawClient, ruleArm } from "./arms.ts";
import { armMetrics, type EvalRow, STANDARD_INVOICE_EUR } from "./metrics.ts";

const RESULTS = fileURLToPath(new URL("../results/", import.meta.url));
const RAW = join(RESULTS, "raw");

const { values } = parseArgs({
  options: {
    limit: { type: "string", default: "0" },
    concurrency: { type: "string", default: "3" },
    "raw-model": { type: "string", default: "" },
  },
});

/** Lookups that existed on the date T. The vendor's own credit limit is computed today, so it would leak. */
const PLAN = ["fr.profile", "fr.gazette", "fr.filings", "fr.finances", "fr.court"];

interface CohortRow {
  siren: string;
  T: string;
  pairedWith?: string;
}

interface Saved {
  siren: string;
  group: "failing" | "control";
  T: string;
  outcome: string;
  facts: Fact[];
  floor: FloorResult | null;
  upfront: Terms | null;
  proposed: Decision | null;
  proposedValid: boolean;
  evidenceUsd: number;
  servUsd: number;
  receipts: { url: string; status: string; amountUsd: number; txHash: string | null; code?: string }[];
}

const log = (m: string) => process.stderr.write(`${new Date().toISOString().slice(11, 19)} ${m}\n`);

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (queue.length) await fn(queue.shift()!);
    }),
  );
}

async function main() {
  const servKey = process.env.SERV_API_KEY;
  if (!servKey) throw new Error("SERV_API_KEY is required");
  const cohort = JSON.parse(await readFile(join(RESULTS, "cohort.json"), "utf8")) as { failing: CohortRow[]; controls: CohortRow[] };
  let rows = [
    ...cohort.failing.map((r) => ({ ...r, group: "failing" as const })),
    ...cohort.controls.map((r) => ({ ...r, group: "control" as const })),
  ];
  const limit = Number(values.limit);
  if (limit > 0) {
    // Keep pairs together so a small run is still a matched comparison.
    const failing = rows.filter((r) => r.group === "failing").slice(0, limit);
    const ids = new Set(failing.map((r) => r.siren));
    rows = [...failing, ...rows.filter((r) => r.group === "control" && ids.has(r.pairedWith ?? ""))];
  }
  await mkdir(RAW, { recursive: true });

  const policy = loadPolicy("freelancer");
  const serv = servPort(servClient(servKey));
  const kite = createKpassExecutor();
  const payer = { payer: "house" as const, home: process.env.KITE_HOME ?? `${process.env.HOME}` };

  let done = 0;
  await pool(rows, Number(values.concurrency), async (row) => {
    const file = join(RAW, `${row.group}-${row.siren}-${row.T}.json`);
    if (existsSync(file)) {
      done++;
      return;
    }
    const outcome = await runCheck(
      { query: row.siren, amountEur: STANDARD_INVOICE_EUR, policy, asOf: row.T, planKeys: PLAN, review: "skip" },
      { kite, payer, serv, reppo: null, now: () => new Date(), emit: () => {} },
    );
    const r: CheckResult | null = outcome.kind === "done" ? outcome.result : null;
    const saved: Saved = {
      siren: row.siren,
      group: row.group,
      T: row.T,
      outcome: outcome.kind,
      facts: r?.facts ?? [],
      floor: r?.floor ?? null,
      upfront: r?.final ?? null,
      proposed: r?.proposed ?? null,
      proposedValid: !!r?.proposed,
      evidenceUsd: r?.costs.evidenceUsd ?? 0,
      servUsd: r?.costs.servUsd ?? 0,
      receipts: (r?.receipts ?? (outcome.kind === "unavailable" ? outcome.receipts : [])).map((x) => ({
        url: x.url,
        status: x.status,
        amountUsd: x.amountUsd,
        txHash: x.txHash,
        code: x.refusalCode,
      })),
    };
    await writeFile(file, JSON.stringify(saved));
    done++;
    log(`${done}/${rows.length} ${row.group} ${row.siren} T=${row.T} → ${outcome.kind}${r ? ` ${r.final.mode}` : ""}`);
  });

  // Evaluate every arm on the saved evidence.
  const rawModel = values["raw-model"] || baseModel(MODELS.decide);
  const raw = process.env.OPENROUTER_API_KEY ? rawClient(process.env.OPENROUTER_API_KEY) : null;
  const evalRows: EvalRow[] = [];
  let evidenceUsd = 0;
  let servUsd = 0;
  let unavailable = 0;
  let invalid = 0;
  const rawInvalid: string[] = [];
  for (const row of rows) {
    const s = JSON.parse(await readFile(join(RAW, `${row.group}-${row.siren}-${row.T}.json`), "utf8")) as Saved;
    evidenceUsd += s.evidenceUsd;
    servUsd += s.servUsd;
    if (s.outcome !== "done") {
      unavailable++;
      evalRows.push({ siren: s.siren, group: s.group, T: s.T, arms: {} });
      continue;
    }
    if (!s.proposedValid) invalid++;
    const arms: Partial<Record<Arm, Terms | null>> = {
      upfront: s.upfront,
      rule: ruleArm(s.facts, s.T).terms,
      net30: net30Arm(),
    };
    if (raw) {
      const out = await rawArm(raw, `openai/${rawModel}`, decideArgs(policy, s.facts, STANDARD_INVOICE_EUR, s.T));
      arms.raw = out.terms;
      if (!out.valid) rawInvalid.push(s.siren);
    }
    evalRows.push({ siren: s.siren, group: s.group, T: s.T, arms });
  }

  const metrics = Object.fromEntries(ARMS.map((a) => [a, armMetrics(evalRows, a)]));
  const out = {
    generatedAt: new Date().toISOString(),
    setup: {
      invoiceEur: STANDARD_INVOICE_EUR,
      evaluatedOn: "T = the court-fixed date the company stopped paying (its matched control is checked on the same date)",
      evidence: PLAN,
      pointInTime: "only facts published or filed on or before T; current-state facts dropped; fiscal years only once filed",
      policy: { id: policy.id, version: policy.version, hash: policy.hash },
      decideModel: MODELS.decide,
      rawModel: raw ? rawModel : null,
    },
    counts: { companies: rows.length, unavailable, upfrontDecisionsFailedValidation: invalid, rawDecisionsFailedValidation: rawInvalid.length },
    costs: { evidenceUsd: Math.round(evidenceUsd * 1e6) / 1e6, servUsd: Math.round(servUsd * 1e4) / 1e4 },
    metrics,
    rows: evalRows,
  };
  await writeFile(join(RESULTS, "backtest.json"), `${JSON.stringify(out, null, 2)}\n`);
  log(`wrote backtest.json: ${JSON.stringify(metrics)}`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
