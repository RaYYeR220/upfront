// Feedback → measured improvement. The policy's record on the training half (its mistakes and
// which warning signs actually separated failing from healthy companies) drives a revised policy.
// An independent Reppo review vets each revision before it is measured; a revision is kept only
// if caught-minus-false-alarms improves on the training half. The held-out half never decides
// anything: it is measured for every kept version and reported as is.
//
//   SERV_API_KEY=... REPPO_API_KEY=... pnpm --filter @upfront/backtest tune -- --iterations 3
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { computeFloor, type Fact, type Policy, type Terms, validateDecision } from "@upfront/core";
import { settle } from "@upfront/engine";
import { awaitReview, type ReviewResult, reppoClient } from "@upfront/reppo";
import { decide, loadPolicy, makePolicy, type Mistake, proposeAmendment, servClient } from "@upfront/serv";
import { monthsBetween } from "@upfront/sources";
import { type ArmMetrics, armMetrics, type EvalRow, flagged, STANDARD_INVOICE_EUR } from "./metrics.ts";
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
  const decideAll = async (policy: Policy, set: Row[], reuse: boolean): Promise<Map<string, Terms>> => {
    const out = new Map<string, Terms>();
    const queue = [...set];
    await Promise.all(
      Array.from({ length: Number(values.concurrency) }, async () => {
        while (queue.length) {
          const r = queue.shift()!;
          const id = `${r.group}-${r.siren}`;
          if (reuse && r.upfront) {
            out.set(id, r.upfront);
            continue;
          }
          const floor = computeFloor(r.facts);
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const d = await decide(client, { policy, facts: r.facts, floor, amountEur: STANDARD_INVOICE_EUR, today: r.T });
              spent += d.costUsd;
              const v = validateDecision(d.raw, r.facts, floor);
              out.set(id, settle(v.ok ? v.decision : null, floor).final);
              break;
            } catch (e) {
              if (attempt === 2) log(`  ${id}: ${String((e as Error).message).slice(0, 120)} (not scored)`);
              else await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
            }
          }
        }
      }),
    );
    return out;
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
    return [...t.entries()]
      .sort((a, b) => b[1].f + b[1].c - (a[1].f + a[1].c))
      .slice(0, 25)
      .map(([k, e]) => `${k}: ${e.f} stopped paying (${e.ff} flagged), ${e.c} kept paying (${e.cf} flagged)`);
  };

  let current = loadPolicy("freelancer");
  let trainTerms = await decideAll(current, train, true);
  const holdTerms1 = await decideAll(current, holdout, true);
  const history: Array<Record<string, unknown>> = [
    {
      version: 1,
      hash: current.hash,
      text: current.text,
      rationale: "starting preset",
      review: null,
      train: metricsOf(train, trainTerms),
      holdout: metricsOf(holdout, holdTerms1),
      accepted: true,
      why: "baseline",
    },
  ];
  log(`v1 train ${record(train, trainTerms)}`);

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
    const candidate = makePolicy("freelancer", current.name, amendment.text, current.version + 1);
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

    const candTrain = await decideAll(candidate, train, false);
    const verdict = accept(metricsOf(train, trainTerms), metricsOf(train, candTrain));
    const entry: Record<string, unknown> = {
      version: candidate.version,
      hash: candidate.hash,
      text: candidate.text,
      rationale: amendment.rationale,
      review,
      train: metricsOf(train, candTrain),
      holdout: null,
      accepted: verdict.accepted,
      why: verdict.why,
    };
    log(`v${candidate.version} train: ${verdict.why} (${verdict.accepted ? "kept" : "dropped"})`);
    if (verdict.accepted) {
      entry.holdout = metricsOf(holdout, await decideAll(candidate, holdout, false));
      current = candidate;
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
