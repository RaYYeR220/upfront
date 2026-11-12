// An independent panel (Reppo) reviews a sample of backtest decisions. Packets are
// redacted ("Company A"): the panel judges the reasoning, not the company.
//
//   REPPO_API_KEY=... pnpm --filter @upfront/backtest review -- --n 40
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { Decision, Fact, Terms } from "@upfront/core";
import { awaitReview, buildReviewPacket, reppoClient } from "@upfront/reppo";
import { loadPolicy } from "@upfront/serv";
import { STANDARD_INVOICE_EUR } from "./metrics.ts";

const RESULTS = fileURLToPath(new URL("../results/", import.meta.url));
const { values } = parseArgs({ options: { n: { type: "string", default: "40" }, concurrency: { type: "string", default: "4" } } });

interface Saved {
  siren: string;
  group: "failing" | "control";
  T: string;
  outcome: string;
  facts: Fact[];
  upfront: Terms | null;
  proposed: Decision | null;
}

async function main() {
  const key = process.env.REPPO_API_KEY;
  if (!key) throw new Error("REPPO_API_KEY is required");
  const reppo = reppoClient(key);
  const policy = loadPolicy("freelancer");
  const all: Saved[] = [];
  for (const f of (await readdir(join(RESULTS, "raw"))).sort()) {
    const s = JSON.parse(await readFile(join(RESULTS, "raw", f), "utf8")) as Saved;
    if (s.outcome === "done" && s.proposed) all.push(s);
  }
  // Half failing, half controls, in a fixed order.
  const half = Math.floor(Number(values.n) / 2);
  const sample = [...all.filter((s) => s.group === "failing").slice(0, half), ...all.filter((s) => s.group === "control").slice(0, half)];

  const reviews: { group: string; T: string; terms: Terms | null; route?: string; score?: number; reason?: string; status: string; seconds: number }[] = [];
  const queue = [...sample];
  await Promise.all(
    Array.from({ length: Number(values.concurrency) }, async () => {
      while (queue.length) {
        const s = queue.shift()!;
        const t0 = Date.now();
        try {
          const packet = buildReviewPacket({ policy, facts: s.facts, decision: s.proposed!, amountEur: STANDARD_INVOICE_EUR, identifiers: [s.siren] });
          const { id } = await reppo.submit(packet);
          const r = await awaitReview(reppo, id, { timeoutMs: 240_000, pollMs: 5000 });
          reviews.push({ group: s.group, T: s.T, terms: s.upfront, route: r.route, score: r.score, reason: r.reason, status: r.status, seconds: Math.round((Date.now() - t0) / 1000) });
        } catch (e) {
          reviews.push({ group: s.group, T: s.T, terms: s.upfront, status: "failed", reason: String(e), seconds: Math.round((Date.now() - t0) / 1000) });
        }
        process.stderr.write(`${reviews.length}/${sample.length}\n`);
      }
    }),
  );

  const done = reviews.filter((r) => r.status === "done");
  const share = (k: string) => (done.length ? Math.round((done.filter((r) => r.route === k).length / done.length) * 1000) / 1000 : 0);
  const secs = done.map((r) => r.seconds).sort((a, b) => a - b);
  await writeFile(
    join(RESULTS, "reppo-sample.json"),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        n: sample.length,
        completed: done.length,
        routes: { ship: share("ship"), review: share("review"), block: share("block") },
        medianSeconds: secs.length ? secs[Math.floor(secs.length / 2)] : null,
        reviews,
      },
      null,
      2,
    )}\n`,
  );
  process.stderr.write("wrote reppo-sample.json\n");
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
