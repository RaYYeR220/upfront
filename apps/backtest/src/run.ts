// Runs the backtest: every company in results/cohort.json is checked on the day it
// (or its matched twin) stopped paying, with only the evidence public on that day.
// The evidence comes from free public records (the gazette and the national register)
// and is kept in results/raw/. The decision is the policy as SERV compiled it, applied
// by code, so anyone can replay the numbers from the stored program without a key.
//
//   pnpm --filter @upfront/backtest run [-- --limit 10]
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { applyProgram, computeFloor, type Fact, type Policy, type Terms } from "@upfront/core";
import { settle } from "@upfront/engine";
import { type Compiled, compilePolicy, loadPolicy, servClient, storedProgram } from "@upfront/serv";
import { deriveFacts, filterAsOf } from "@upfront/sources";
import { ARMS, type Arm, net30Arm, ruleArm } from "./arms.ts";
import { publicFacts } from "./free-evidence.ts";
import { armMetrics, type EvalRow, STANDARD_INVOICE_EUR } from "./metrics.ts";

const RESULTS = fileURLToPath(new URL("../results/", import.meta.url));
const RAW = join(RESULTS, "raw");


interface CohortRow {
  siren: string;
  T: string;
  pairedWith?: string;
}

export interface Saved {
  siren: string;
  group: "failing" | "control";
  T: string;
  outcome: "done" | "not_found";
  facts: Fact[];
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

/** The facts public on date T: point-in-time filtering first, then derived facts as of T. */
async function evidenceAsOf(siren: string, T: string): Promise<Fact[] | null> {
  const all = await publicFacts(siren);
  if (!all.length) return null;
  const pit = filterAsOf(all, T);
  return [...pit, ...deriveFacts(pit, T, { documentsFetched: true })].map((f, i) => ({ ...f, id: `f_${i + 1}` }));
}

/** The production decision step: hard-fact floors, then the compiled policy, settled fail-closed. */
export function decideWith(c: Compiled, facts: Fact[], T: string): Terms {
  const floor = computeFloor(facts);
  const { decision } = applyProgram(c.program, facts, { today: T, amountEur: STANDARD_INVOICE_EUR });
  return settle(decision, floor).final;
}

/** The stored program for a policy, compiled through SERV only when none is stored. */
export async function programFor(policy: Policy): Promise<Compiled> {
  const stored = storedProgram(policy.hash);
  if (stored) return stored;
  const key = process.env.SERV_API_KEY;
  if (!key) throw new Error(`no stored program for ${policy.id} v${policy.version}; set SERV_API_KEY to compile it`);
  return compilePolicy(servClient(key), policy);
}

async function main() {
  const { values } = parseArgs({
    options: {
      limit: { type: "string", default: "0" },
      concurrency: { type: "string", default: "4" },
    },
  });
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

  let done = 0;
  await pool(rows, Number(values.concurrency), async (row) => {
    const file = join(RAW, `${row.group}-${row.siren}-${row.T}.json`);
    if (existsSync(file)) {
      done++;
      return;
    }
    const facts = await evidenceAsOf(row.siren, row.T);
    const saved: Saved = { siren: row.siren, group: row.group, T: row.T, outcome: facts ? "done" : "not_found", facts: facts ?? [] };
    await writeFile(file, JSON.stringify(saved));
    done++;
    if (done % 25 === 0) log(`${done}/${rows.length} evidence collected`);
  });

  const policy = loadPolicy("freelancer");
  const compiled = await programFor(policy);
  const evalRows: EvalRow[] = [];
  let unavailable = 0;
  for (const row of rows) {
    const s = JSON.parse(await readFile(join(RAW, `${row.group}-${row.siren}-${row.T}.json`), "utf8")) as Saved;
    if (s.outcome !== "done") {
      unavailable++;
      evalRows.push({ siren: s.siren, group: s.group, T: s.T, arms: {} });
      continue;
    }
    const arms: Partial<Record<Arm, Terms | null>> = {
      upfront: decideWith(compiled, s.facts, s.T),
      rule: ruleArm(s.facts, s.T).terms,
      net30: net30Arm(),
    };
    evalRows.push({ siren: s.siren, group: s.group, T: s.T, arms });
  }

  const metrics = Object.fromEntries(ARMS.map((a) => [a, armMetrics(evalRows, a)]));
  const out = {
    generatedAt: new Date().toISOString(),
    setup: {
      invoiceEur: STANDARD_INVOICE_EUR,
      evaluatedOn: "T = the court-fixed date the company stopped paying (its matched control is checked on the same date)",
      evidence: ["gazette (BODACC), every notice about the company", "national company register"],
      pointInTime: "only facts published or filed on or before T; current-state facts dropped; fiscal years only once filed",
      policy: { id: policy.id, version: policy.version, hash: policy.hash },
      program: { model: compiled.model, compiledAt: compiled.compiledAt, rules: compiled.program.rules.length, warnings: compiled.warnings },
    },
    counts: { companies: rows.length, unavailable },
    metrics,
    rows: evalRows,
  };
  await writeFile(join(RESULTS, "backtest.json"), `${JSON.stringify(out, null, 2)}\n`);
  log(`wrote backtest.json: ${JSON.stringify(metrics)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  });
}
