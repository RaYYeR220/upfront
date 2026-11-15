// Feedback → measured improvement. The policy's record on the training half (its mistakes and
// which warning signs actually separated failing from healthy companies) drives a revised policy.
// An independent Reppo review vets each revision before it is measured; a revision is kept only
// if caught-minus-false-alarms improves on the training half. The held-out half never decides
// anything: it is measured for every kept version and reported as is.
//
//   SERV_API_KEY=... REPPO_API_KEY=... pnpm --filter @upfront/backtest tune -- --iterations 3
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { computeSignals, type Fact, type Policy, type Terms } from "@upfront/core";
import { awaitReview, type ReviewResult, reppoClient } from "@upfront/reppo";
import { type Compiled, compilePolicy, loadPolicy, makePolicy, type Mistake, PROGRAMS_DIR, programFileName, proposeAmendment, servClient } from "@upfront/serv";
import { monthsBetween } from "@upfront/sources";
import { type ArmMetrics, armMetrics, type EvalRow, flagged, STANDARD_INVOICE_EUR } from "./metrics.ts";
import { decideWith, programFor } from "./run.ts";
import { THRESHOLDS } from "./signs.ts";
import { accept, informedness, splitPairs } from "./tune.ts";

const RESULTS = fileURLToPath(new URL("../results/", import.meta.url));
const { values } = parseArgs({
  options: {
    iterations: { type: "string", default: "3" },
    concurrency: { type: "string", default: "4" },
    "max-usd": { type: "string", default: "2.5" },
  },
});

interface Saved {
  siren: string;
  group: "failing" | "control";
  T: string;
  outcome: string;
  facts: Fact[];
  upfront: Terms | null;
}
type Row = Saved & { pairedWith?: string };

const log = (m: string) => process.stderr.write(`${new Date().toISOString().slice(11, 19)} ${m}\n`);
const val = (facts: Fact[], kind: string) => facts.find((f) => f.kind === kind)?.value;
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** The warning signs present on the as-of date, in plain words. */
export function signs(facts: Fact[], T: string): string[] {
  const out: string[] = [];
  const never = val(facts, "accounts.never_filed");
  if (typeof never === "number") out.push(never >= 18 ? "never filed accounts, 18+ months past the first deadline" : "never filed accounts");
  const od = val(facts, "accounts.overdue_months");
  if (typeof od === "number" && od > 0) out.push(od >= 18 ? "accounts 18+ months overdue" : od >= 6 ? "accounts 6-17 months overdue" : "accounts 1-5 months overdue");
  const lf = val(facts, "accounts.late_filing_months");
  if (typeof lf === "number" && lf > 0) out.push(lf >= 6 ? "last accounts filed 6+ months late" : "last accounts filed 1-5 months late");
  const created = val(facts, "identity.created_on");
  if (typeof created === "string") {
    const age = monthsBetween(created, T);
    if (age < 24) out.push("under 2 years old");
    else if (age < 36) out.push("2-3 years old");
  }
  if (facts.some((f) => f.kind === "proceeding.past")) out.push("past insolvency proceeding");
  const years = facts
    .filter((f) => f.kind === "finance.year")
    .map((f) => f.value as { closingDate: string; revenue?: number | null; netIncome?: number | null })
    .sort((a, b) => b.closingDate.localeCompare(a.closingDate));
  const last = years[0];
  if (last && typeof last.netIncome === "number" && last.netIncome < 0) out.push("last filed year a loss");
  if (facts.some((f) => f.kind === "status.ceased_on")) out.push("struck off the register");
  return out;
}

/** The facts a reviewer needs, without names or identifiers, a dozen lines at most. */
function compact(facts: Fact[], T: string): string[] {
  const out: string[] = [];
  const created = val(facts, "identity.created_on");
  if (created) out.push(`created ${String(created).slice(0, 7)}`);
  const form = val(facts, "identity.legal_form");
  if (form) out.push(`legal form ${String(form)}`);
  const naf = val(facts, "identity.naf");
  if (naf) out.push(`activity ${String(naf)}`);
  const filed = facts
    .filter((f) => f.kind === "accounts.filed")
    .map((f) => f.value as { closingDate: string; filedOn: string })
    .sort((a, b) => b.closingDate.localeCompare(a.closingDate));
  if (filed[0]) out.push(`${filed.length} sets of accounts filed; latest year ${filed[0].closingDate} filed ${filed[0].filedOn}`);
  for (const k of ["accounts.never_filed", "accounts.overdue_months", "accounts.late_filing_months"]) {
    const v = val(facts, k);
    if (typeof v === "number") out.push(`${k}: ${v}`);
  }
  for (const f of facts.filter((x) => x.kind === "finance.year").slice(0, 2)) out.push(`finance.year: ${JSON.stringify(f.value)}`);
  for (const f of facts.filter((x) => /^(proceeding|status\.ceased|bodacc)/.test(x.kind)).slice(-5)) {
    const v = f.value as { family?: string; category?: string; nature?: string };
    out.push(`${f.kind} ${f.observedAt}: ${v?.category ?? v?.nature ?? v?.family ?? JSON.stringify(f.value)}`);
  }
  out.push(`as of ${T}`);
  return out.slice(0, 14);
}

const order = (s: string) => createHash("sha1").update(`tune:${s}`).digest("hex");

async function main() {
  const key = process.env.SERV_API_KEY;
  if (!key) throw new Error("SERV_API_KEY is required");
  const client = servClient(key);
  const reppo = process.env.REPPO_API_KEY ? reppoClient(process.env.REPPO_API_KEY) : null;
  const cohort = JSON.parse(await readFile(join(RESULTS, "cohort.json"), "utf8")) as { controls: { siren: string; pairedWith: string }[] };
  const pair = new Map(cohort.controls.map((c) => [c.siren, c.pairedWith]));
  const rows: Row[] = [];
  for (const f of await readdir(join(RESULTS, "raw"))) {
    const s = JSON.parse(await readFile(join(RESULTS, "raw", f), "utf8")) as Saved;
    if (s.outcome === "done") rows.push({ ...s, pairedWith: pair.get(s.siren) });
  }
  const { train, holdout } = splitPairs(rows);
  log(`${rows.length} companies: ${train.length} train, ${holdout.length} holdout`);

  let spent = 0;
  const budget = Number(values["max-usd"]);
  // Decisions are the compiled program applied by code: free and identical on every replay.
  const decideAll = (c: Compiled, set: Row[]): Map<string, Terms> => new Map(set.map((r) => [`${r.group}-${r.siren}`, decideWith(c, r.facts, r.T)]));
  const keep = async (policy: Policy, c: Compiled) => {
    const { usage: _u, costUsd: _c, ms: _m, ...rest } = c as Compiled & { usage?: unknown; costUsd?: number; ms?: number };
    const stored = { ...rest, policyText: policy.text };
    await writeFile(join(PROGRAMS_DIR, programFileName(policy)), `${JSON.stringify(stored, null, 2)}
`);
  };
  // Only companies every compared version decided are scored, so a failed call never counts as a decision.
  const metricsOf = (set: Row[], terms: Map<string, Terms>): ArmMetrics =>
    armMetrics(
      set.map((r): EvalRow => ({ siren: r.siren, group: r.group, T: r.T, arms: { upfront: terms.get(`${r.group}-${r.siren}`) ?? null } })),
      "upfront",
    );

  const record = (set: Row[], terms: Map<string, Terms>) => {
    const m = metricsOf(set, terms);
    return `caught ${Math.round(m.caughtFailing * m.nFailing)} of ${m.nFailing} clients that stopped paying (${pct(m.caughtFailing)}); flagged ${Math.round(m.falseAlarmControls * m.nControls)} of ${m.nControls} that kept paying (${pct(m.falseAlarmControls)})`;
  };
  const patterns = (set: Row[], terms: Map<string, Terms>): string[] => {
    const t = new Map<string, { f: number; ff: number; c: number; cf: number }>();
    for (const r of set) {
      const k = signs(r.facts, r.T).join(" + ") || "no warning signs";
      const e = t.get(k) ?? { f: 0, ff: 0, c: 0, cf: 0 };
      const fl = terms.get(`${r.group}-${r.siren}`);
      if (r.group === "failing") {
        e.f++;
        if (fl && flagged(fl)) e.ff++;
      } else {
        e.c++;
        if (fl && flagged(fl)) e.cf++;
      }
      t.set(k, e);
    }
    const combos = [...t.entries()]
      .sort((a, b) => b[1].f + b[1].c - (a[1].f + a[1].c))
      .slice(0, 15)
      .map(([k, e]) => `${k}: ${e.f} stopped paying (${e.ff} flagged), ${e.c} kept paying (${e.cf} flagged)`);
    return [...signalTable(set, terms), ...combos];
  };

  // Each warning sign on its own, at the thresholds a policy would use: how many of the clients it
  // marks went on to stop paying, and how many kept paying.
  const signalTable = (set: Row[], terms: Map<string, Terms>): string[] =>
    THRESHOLDS.map(([label, name, test]) => {
      let f = 0;
      let ff = 0;
      let c = 0;
      let cf = 0;
      for (const r of set) {
        const s = computeSignals(r.facts, r.T, STANDARD_INVOICE_EUR)[name];
        if (!s || !test(s.value)) continue;
        const fl = terms.get(`${r.group}-${r.siren}`);
        if (r.group === "failing") {
          f++;
          if (fl && flagged(fl)) ff++;
        } else {
          c++;
          if (fl && flagged(fl)) cf++;
        }
      }
      return `sign "${label}" alone: ${f} stopped paying (${ff} flagged), ${c} kept paying (${cf} flagged)`;
    });

  let current = loadPolicy("freelancer");
  let program = await programFor(current);
  let trainTerms = decideAll(program, train);
  const holdTerms1 = decideAll(program, holdout);
  const history: Array<Record<string, unknown>> = [
    {
      version: 1,
      hash: current.hash,
      text: current.text,
      rationale: "starting preset",
      rules: program.program.rules.length,
      warnings: program.warnings,
      review: null,
      train: metricsOf(train, trainTerms),
      holdout: metricsOf(holdout, holdTerms1),
      accepted: true,
      why: "baseline",
    },
  ];
  // Runs add to the record: earlier candidates stay, and the newest kept version is the starting point.
  if (existsSync(join(RESULTS, "tuning.json"))) {
    const prev = JSON.parse(await readFile(join(RESULTS, "tuning.json"), "utf8")) as { history: Array<Record<string, unknown>> };
    if (prev.history[0]?.hash === current.hash) {
      history.splice(0, history.length, ...prev.history);
      const lastKept = [...history].reverse().find((h) => h.accepted && typeof h.text === "string");
      if (lastKept && lastKept.version !== 1) {
        current = makePolicy("freelancer", current.name, String(lastKept.text), Number(lastKept.version));
        program = await programFor(current);
        trainTerms = decideAll(program, train);
      }
    }
  }
  const nextVersion = () => Math.max(...history.map((h) => Number(h.version))) + 1;
  log(`v${current.version} train ${record(train, trainTerms)}`);

  for (let i = 0; i < Number(values.iterations); i++) {
    if (spent > budget) {
      log(`stopping: $${spent.toFixed(2)} spent of $${budget}`);
      break;
    }
    const wrong = (want: "missed" | "false alarm") =>
      train
        .filter((r) => {
          const t = trainTerms.get(`${r.group}-${r.siren}`);
          if (!t) return false;
          return want === "missed" ? r.group === "failing" && !flagged(t) : r.group === "control" && flagged(t);
        })
        .sort((a, b) => order(a.siren).localeCompare(order(b.siren)))
        .slice(0, 25)
        .map((r): Mistake => ({ kind: want, terms: JSON.stringify(trainTerms.get(`${r.group}-${r.siren}`)), facts: compact(r.facts, r.T) }));
    const mistakes = [...wrong("missed"), ...wrong("false alarm")];
    if (!mistakes.length) break;
    const rec = record(train, trainTerms);
    const pats = patterns(train, trainTerms);
    const amendment = await proposeAmendment(client, { policy: current, mistakes, critiques: [], record: rec, patterns: pats });
    spent += amendment.costUsd;
    const candidate = makePolicy("freelancer", current.name, amendment.text, nextVersion());
    log(`v${candidate.version} proposed: ${amendment.rationale}`);

    let review: ReviewResult | null = null;
    if (reppo) {
      const input = [
        "Task: revise a small business's credit policy (plain-English rules that set the payment terms offered to client companies) so it catches more clients that later stop paying while asking fewer healthy clients for deposits.",
        `Record of the current policy on ${train.length} past clients: ${rec}.`,
        `Warning-sign patterns (stopped paying vs kept paying):\n${pats.slice(0, 15).join("\n")}`,
        `Current policy:\n${current.text}`,
        `Proposed policy:\n${candidate.text}`,
        `What changed: ${amendment.rationale}`,
        "Judge whether the proposed policy is a sound, evidence-based response to this record: thresholds supported by the patterns, no rule the data contradicts, decline rules kept.",
      ].join("\n\n");
      try {
        const { id } = await reppo.submit({ taskType: "action", input });
        review = await awaitReview(reppo, id, { timeoutMs: 240_000, pollMs: 5_000 });
      } catch (e) {
        review = { status: "failed", reason: String((e as Error).message) };
      }
      log(`v${candidate.version} review: ${review.route ?? review.status} ${review.score ?? ""}`);
      if (review.route === "block") {
        history.push({ version: candidate.version, hash: candidate.hash, text: candidate.text, rationale: amendment.rationale, review, train: null, holdout: null, accepted: false, why: "blocked by the independent review before testing" });
        continue;
      }
    }

    let candProgram: Compiled;
    try {
      const c = await compilePolicy(client, candidate);
      spent += c.costUsd;
      candProgram = c;
      await keep(candidate, c);
    } catch (e) {
      history.push({ version: candidate.version, hash: candidate.hash, text: candidate.text, rationale: amendment.rationale, review, train: null, holdout: null, accepted: false, why: `did not compile: ${String((e as Error).message)}` });
      log(`v${candidate.version} did not compile`);
      continue;
    }
    const candTrain = decideAll(candProgram, train);
    const verdict = accept(metricsOf(train, trainTerms), metricsOf(train, candTrain));
    const entry: Record<string, unknown> = {
      version: candidate.version,
      hash: candidate.hash,
      text: candidate.text,
      rationale: amendment.rationale,
      rules: candProgram.program.rules.length,
      warnings: candProgram.warnings,
      review,
      train: metricsOf(train, candTrain),
      holdout: null,
      accepted: verdict.accepted,
      why: verdict.why,
    };
    log(`v${candidate.version} train: ${verdict.why} (${verdict.accepted ? "kept" : "dropped"})`);
    // Reported for every measured version; it never decides whether one is kept.
    entry.holdout = metricsOf(holdout, decideAll(candProgram, holdout));
    if (verdict.accepted) {
      current = candidate;
      program = candProgram;
      trainTerms = candTrain;
    }
    history.push(entry);
  }

  const kept = history.filter((h) => h.accepted);
  const first = kept[0]!;
  const last = kept.at(-1)!;
  const j = (m: unknown) => informedness(m as ArmMetrics);
  await writeFile(
    join(RESULTS, "tuning.json"),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        goal: "caught minus false alarms on the training half; false alarms may not rise above max(10%, where they were)",
        split: { train: train.length, holdout: holdout.length },
        servUsd: Math.round(spent * 10_000) / 10_000,
        result: {
          from: first.version,
          to: last.version,
          holdout: { before: first.holdout, after: last.holdout, informednessBefore: j(first.holdout), informednessAfter: j(last.holdout) },
        },
        history,
      },
      null,
      2,
    )}\n`,
  );
  log(`wrote tuning.json: holdout v${first.version} → v${last.version}: ${JSON.stringify(last.holdout)}`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
