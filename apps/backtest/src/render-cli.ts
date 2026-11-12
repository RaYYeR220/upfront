// Rewrites every marked number in the docs from results/*.json.
//   pnpm --filter @upfront/backtest render
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fmt, markersIn, renderNumbers } from "./render.ts";

const RESULTS = fileURLToPath(new URL("../results/", import.meta.url));
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DOCS = ["README.md", "JUDGES.md", "CLAIMS.md", "PROOF.md"];

const read = (f: string) => JSON.parse(readFileSync(join(RESULTS, f), "utf8"));
const values: Record<string, string> = {};

if (existsSync(join(RESULTS, "silent-gap.json"))) {
  const g = read("silent-gap.json");
  const c = g.byPersonType.company;
  Object.assign(values, {
    "gap.company.median": fmt.int(c.medianDays),
    "gap.company.n": fmt.int(c.nMeasured),
    "gap.company.over90": fmt.pct(c.shareOver90Days),
    "gap.company.over180": fmt.pct(c.shareOver180Days),
    "gap.company.atCap": fmt.pct(c.shareAtLegalCap),
    "gap.all.median": fmt.int(g.medianDays),
    "gap.all.n": fmt.int(g.nMeasured),
    "gap.window.from": g.window.from,
    "gap.window.to": g.window.to,
    "gap.lag.median": fmt.int(g.quality.medianPublicationLagDays),
  });
}

if (existsSync(join(RESULTS, "backtest.json"))) {
  const b = read("backtest.json");
  values["bt.companies"] = fmt.int(b.counts.companies);
  values["bt.unavailable"] = fmt.int(b.counts.unavailable);
  values["bt.evidenceUsd"] = `$${b.costs.evidenceUsd.toFixed(2)}`;
  for (const [arm, m] of Object.entries(b.metrics) as [string, { nFailing: number; caughtFailing: number; falseAlarmControls: number; avgLossPerInvoiceEur: number }][]) {
    if (!m.nFailing) continue;
    values[`bt.${arm}.caught`] = fmt.pct(m.caughtFailing);
    values[`bt.${arm}.falseAlarm`] = fmt.pct(m.falseAlarmControls);
    values[`bt.${arm}.loss`] = fmt.eur(m.avgLossPerInvoiceEur);
    values[`bt.${arm}.n`] = fmt.int(m.nFailing);
  }
}

let changed = 0;
for (const doc of DOCS) {
  const file = join(ROOT, doc);
  if (!existsSync(file)) continue;
  const text = readFileSync(file, "utf8");
  if (!markersIn(text).length) continue;
  const next = renderNumbers(text, values);
  if (next !== text) {
    writeFileSync(file, next);
    changed++;
  }
  console.log(`${doc}: ${markersIn(text).length} numbers`);
}
console.log(`${changed} file(s) updated`);
