// Feedback → measured improvement. Mistakes on the training half (and independent
// review critiques, when present) drive a revised policy; a revision is kept only if
// it does better on the held-out half. Uses the evidence already bought by `run`.
//
//   SERV_API_KEY=... pnpm --filter @upfront/backtest tune -- --iterations 3
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { computeFloor, type Fact, type Policy, type Terms, validateDecision } from "@upfront/core";
import { settle } from "@upfront/engine";
import { decide, loadPolicy, makePolicy, proposeAmendment, servClient, type Mistake } from "@upfront/serv";
import { armMetrics, type EvalRow, flagged, STANDARD_INVOICE_EUR } from "./metrics.ts";
import { accept, splitPairs } from "./tune.ts";

const RESULTS = fileURLToPath(new URL("../results/", import.meta.url));
const { values } = parseArgs({ options: { iterations: { type: "string", default: "3" }, concurrency: { type: "string", default: "4" } } });

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

async function main() {
  const key = process.env.SERV_API_KEY;
  if (!key) throw new Error("SERV_API_KEY is required");
  const client = servClient(key);
  const cohort = JSON.parse(await readFile(join(RESULTS, "cohort.json"), "utf8")) as { controls: { siren: string; pairedWith: string }[] };
  const pair = new Map(cohort.controls.map((c) => [c.siren, c.pairedWith]));
  const rows: Row[] = [];
  for (const f of await readdir(join(RESULTS, "raw"))) {
    const s = JSON.parse(await readFile(join(RESULTS, "raw", f), "utf8")) as Saved;
    if (s.outcome === "done") rows.push({ ...s, pairedWith: pair.get(s.siren) });
  }
  const { train, holdout } = splitPairs(rows);
  log(`${rows.length} companies: ${train.length} train, ${holdout.length} holdout`);

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
          try {
            const d = await decide(client, { policy, facts: r.facts, floor, amountEur: STANDARD_INVOICE_EUR, today: r.T });
            const v = validateDecision(d.raw, r.facts, floor);
            out.set(id, settle(v.ok ? v.decision : null, floor).final);
          } catch {
            out.set(id, settle(null, floor).final);
          }
        }
      }),
    );
    return out;
  };
  const metricsOf = (set: Row[], terms: Map<string, Terms>) =>
    armMetrics(
      set.map((r): EvalRow => ({ siren: r.siren, group: r.group, T: r.T, arms: { upfront: terms.get(`${r.group}-${r.siren}`) ?? null } })),
      "upfront",
    );

  const critiques = existsSync(join(RESULTS, "reppo-sample.json"))
    ? ((JSON.parse(await readFile(join(RESULTS, "reppo-sample.json"), "utf8")) as { reviews: { route: string; reason?: string }[] }).reviews ?? [])
        .filter((r) => r.route !== "ship" && r.reason)
        .map((r) => r.reason!)
    : [];

  let current = loadPolicy("freelancer");
  let trainTerms = await decideAll(current, train, true);
  let holdTerms = await decideAll(current, holdout, true);
  const history = [
    { version: 1, hash: current.hash, text: current.text, rationale: "starting preset", train: metricsOf(train, trainTerms), holdout: metricsOf(holdout, holdTerms), accepted: true, why: "baseline" },
  ];
  log(`v1 holdout ${JSON.stringify(history[0]!.holdout)}`);

  for (let i = 0; i < Number(values.iterations); i++) {
    const mistakes: Mistake[] = train.flatMap((r) => {
      const t = trainTerms.get(`${r.group}-${r.siren}`);
      if (!t) return [];
      const missed = r.group === "failing" && !flagged(t);
      const alarm = r.group === "control" && flagged(t);
      if (!missed && !alarm) return [];
      return [{ kind: missed ? "missed" : "false alarm", terms: JSON.stringify(t), facts: r.facts.filter((f) => !f.kind.startsWith("identity.name")).map((f) => `${f.kind}: ${JSON.stringify(f.value)} (${f.observedAt})`) }];
    });
    if (!mistakes.length) break;
    const amendment = await proposeAmendment(client, { policy: current, mistakes, critiques });
    const candidate = makePolicy("freelancer", current.name, amendment.text, current.version + 1);
    const candTrain = await decideAll(candidate, train, false);
    const candHold = await decideAll(candidate, holdout, false);
    const verdict = accept(metricsOf(holdout, holdTerms), metricsOf(holdout, candHold));
    history.push({
      version: candidate.version,
      hash: candidate.hash,
      text: candidate.text,
      rationale: amendment.rationale,
      train: metricsOf(train, candTrain),
      holdout: metricsOf(holdout, candHold),
      accepted: verdict.accepted,
      why: verdict.why,
    });
    log(`v${candidate.version}: ${verdict.why}`);
    if (verdict.accepted) {
      current = candidate;
      trainTerms = candTrain;
      holdTerms = candHold;
    }
  }

  await writeFile(
    join(RESULTS, "tuning.json"),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), split: { train: train.length, holdout: holdout.length }, history }, null, 2)}\n`,
  );
  log("wrote tuning.json");
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
