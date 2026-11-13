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
import { computeFloor, type Decision, type Fact, type FloorResult, type Policy, type Terms, validateDecision } from "@upfront/core";
import { type CheckOutcome, type CheckResult, runCheck, type ServPort, servPort, settle } from "@upfront/engine";
import { deriveFacts, filterAsOf } from "@upfront/sources";
import { publicFacts } from "./free-evidence.ts";
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
    // "public": free gazette + register data (default). "kite": the production lookups, paid through Kite Passport.
    source: { type: "string", default: "public" },
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

/**
 * The same decision step as production (hard-fact floors, the policy through
 * SERV, validation, fail-closed settling) on evidence from free public records.
 */
async function decideOnPublicRecords(siren: string, T: string, policy: Policy, serv: ServPort): Promise<CheckOutcome> {
  const checkId = `bt-${siren}-${T}`;
  const all = await publicFacts(siren);
  if (!all.length) return { kind: "not_found", checkId };
  const pit = filterAsOf(all, T);
  const facts = [...pit, ...deriveFacts(pit, T, { documentsFetched: true })].map((f, i) => ({ ...f, id: `f_${i + 1}` }));
  const floor = computeFloor(facts);
  let proposed: Decision | null = null;
  let servUsd = 0;
  try {
    const d = await serv.decide({ policy, facts, floor, amountEur: STANDARD_INVOICE_EUR, today: T });
    servUsd = d.costUsd;
    const v = validateDecision(d.raw, facts, floor);
    if (v.ok) proposed = v.decision;
  } catch (e) {
    // In production a failed call falls back to safe terms. In a measurement it must not pass for a
    // decision: the row is reported as unavailable and re-run, never scored.
    return { kind: "unavailable", checkId, reason: String((e as Error).message ?? e).slice(0, 200), receipts: [] };
  }
  const { final, finalReasons } = settle(proposed, floor);
  const name = String(facts.find((f) => f.kind === "identity.name")?.value ?? siren);
  return {
    kind: "done",
    result: {
      checkId,
      entity: { jurisdiction: "FR", id: siren, name },
      amountEur: STANDARD_INVOICE_EUR,
      policy: { id: policy.id, version: policy.version, hash: policy.hash },
      asOf: T,
      facts,
      receipts: [],
      floor,
      proposed,
      decisionConfidence: proposed?.confidence ?? "low",
      final,
      finalReasons,
      review: null,
      reviewed: false,
      notes: [],
      issue: { summary: "", termsText: "" },
      nodes: [],
      costs: { evidenceUsd: 0, servUsd, reviewUsd: 0 },
    },
  };
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
    const outcome =
      values.source === "kite"
        ? await runCheck(
            { query: row.siren, amountEur: STANDARD_INVOICE_EUR, policy, asOf: row.T, planKeys: PLAN, review: "skip" },
            { kite, payer, serv, reppo: null, now: () => new Date(), emit: () => {} },
          )
        : await decideOnPublicRecords(row.siren, row.T, policy, serv);
    const r: CheckResult | null = outcome.kind === "done" ? outcome.result : null;
    if (outcome.kind === "unavailable" && values.source !== "kite") {
      log(`${row.group} ${row.siren} T=${row.T} → not scored: ${outcome.reason}`);
      return;
    }
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
      evidence: values.source === "kite" ? PLAN : ["gazette (BODACC), every notice about the company", "national company register"],
      source: values.source,
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
