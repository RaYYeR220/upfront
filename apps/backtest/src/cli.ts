import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { fetchOpeningNotices, type Judgment, type NoticeStats, parseNotices } from "./bodacc.ts";
import { buildCohort } from "./cohort.ts";
import { buildControls } from "./controls.ts";
import { daysBetween } from "./dates.ts";
import { percentile, silentGap } from "./gap.ts";
import { cacheStats } from "./http.ts";

const RESULTS_DIR = fileURLToPath(new URL("../results/", import.meta.url));

const { values } = parseArgs({
  options: {
    from: { type: "string", default: "2026-01-01" },
    to: { type: "string", default: "2026-10-31" },
    n: { type: "string", default: "150" },
    seed: { type: "string", default: "upfront-backtest-2026" },
  },
});
const from = values.from;
const to = values.to;
const n = Number(values.n);
const seed = values.seed;

const log = (msg: string) => process.stderr.write(`${new Date().toISOString().slice(11, 19)} ${msg}\n`);

function dataQuality(judgments: readonly Judgment[], notices: NoticeStats) {
  const share = (part: number, whole: number) =>
    whole ? Math.round((part / whole) * 10_000) / 10_000 : null;
  const personType = { pm: 0, pp: 0, unknown: 0 };
  for (const j of judgments) personType[j.personType ?? "unknown"]++;
  // Safeguard openings never carry a cessation date, so coverage is measured on the other two.
  const insolvent = judgments.filter((j) => j.nature !== "sauvegarde");
  const withDate = insolvent.filter((j) => j.cessationDate).length;
  const mentionedButUnparsed = insolvent.filter((j) => !j.cessationDate && /cessation/i.test(j.raw)).length;
  const withLiquidator = judgments.filter((j) => j.liquidator).length;
  const publicationLags = judgments
    .flatMap((j) => (j.judgmentDate ? [daysBetween(j.judgmentDate, j.publishedOn)] : []))
    .sort((a, b) => a - b);
  return {
    notices,
    personType,
    soleTraderShare: share(personType.pp, judgments.length),
    cessationDate: {
      liquidationOrRedressement: insolvent.length,
      parsed: withDate,
      parsedShare: share(withDate, insolvent.length),
      // The notice talks about a cessation of payments but no date could be read (blank or malformed).
      mentionedButUnparsed,
      // Mostly liquidations pronounced during an existing receivership: the date was set earlier.
      notStated: insolvent.length - withDate - mentionedButUnparsed,
    },
    liquidatorParsedShare: share(withLiquidator, judgments.length),
    // Judgment to BODACC publication. Small next to the silent gap: the delay is before the court.
    medianPublicationLagDays: publicationLags.length ? percentile(publicationLags, 0.5) : null,
  };
}

async function writeJson(name: string, data: unknown) {
  await mkdir(RESULTS_DIR, { recursive: true });
  const file = join(RESULTS_DIR, name);
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
  log(`wrote ${file}`);
}

async function main() {
  log(`fetching BODACC opening notices ${from}..${to}`);
  const notices = await fetchOpeningNotices(from, to);
  const { judgments, stats } = parseNotices(notices);
  log(`${stats.notices} notices -> ${stats.judgments} opening judgments (one per SIREN)`);

  const gap = silentGap(judgments);
  log(
    `silent gap: n=${gap.nMeasured} median=${gap.medianDays}d p25=${gap.p25Days}d p75=${gap.p75Days}d ` +
      `>90d=${gap.shareOver90Days} >180d=${gap.shareOver180Days}`,
  );
  await writeJson("silent-gap.json", {
    generatedAt: new Date().toISOString(),
    window: { from, to },
    source:
      "BODACC annonces-commerciales, familleavis=collective, opening judgments (initial notices, one per SIREN)",
    definition: "days = BODACC publication date - court-fixed date of cessation of payments",
    ...gap,
    quality: dataQuality(judgments, stats),
  });

  log(`sampling ${n} failing companies (seed ${seed})`);
  const cohort = await buildCohort(judgments, { n, seed });
  log(`cohort: ${cohort.rows.length} rows, ${JSON.stringify(cohort.funnel.selectedByNature)}`);

  log("drawing matched controls");
  const controls = await buildControls(cohort.rows, { seed });
  log(`controls: ${controls.funnel.matched} matched, ${controls.funnel.unmatched} unmatched`);

  await writeJson("cohort.json", {
    generatedAt: new Date().toISOString(),
    seed,
    window: { from, to },
    failing: cohort.rows,
    controls: controls.rows,
    counts: {
      failing: cohort.rows.length,
      controls: controls.rows.length,
      failingByNature: cohort.funnel.selectedByNature,
      controlsByTier: controls.funnel.byTier,
      cohortFunnel: cohort.funnel,
      controlFunnel: controls.funnel,
    },
  });
  log(`http cache: ${cacheStats.hits} hits, ${cacheStats.misses} fetched`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
