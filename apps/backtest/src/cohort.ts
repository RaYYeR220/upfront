import { type Judgment, NATURES, type Nature } from "./bodacc.ts";
import { type CompanyProfile, isLegalPerson, lookupCompany } from "./companies.ts";
import { addMonths } from "./dates.ts";
import { gapDays } from "./gap.ts";
import { mapLimit } from "./http.ts";
import { seededRng, shuffle } from "./random.ts";

export type CohortRow = {
  siren: string;
  /** Reference date for the backtest: the cessation of payments. Anything a check sees must predate it. */
  T: string;
  publishedOn: string;
  judgmentDate: string | null;
  nature: Nature;
  naf: string | null;
  nafSection: string | null;
  createdOn: string;
  natureJuridique: string;
  department: string | null;
};

export type CohortFunnel = {
  judgments: number;
  noCessationDate: number;
  /** Cessation date after publication or more than 36 months before it. */
  implausibleGap: number;
  gapUnder30Days: number;
  soleTraderByNotice: number;
  eligibleByNature: Record<Nature, number>;
  quotas: Record<Nature, number>;
  evaluated: number;
  notFound: number;
  rejectedSoleTrader: number;
  rejectedNoCreationDate: number;
  rejectedTooYoung: number;
  selected: number;
  selectedByNature: Record<Nature, number>;
};

export type CohortDeps = { lookup: (siren: string) => Promise<CompanyProfile | null> };

export type CohortOptions = {
  n?: number;
  seed: string;
  /** Minimum days between cessation of payments and the notice. */
  minGapDays?: number;
  /** The company must have existed this long at T. */
  minAgeMonths?: number;
};

const zeroByNature = (): Record<Nature, number> => ({ liquidation: 0, redressement: 0, sauvegarde: 0 });

/** Split n across strata proportionally to their sizes (largest remainder), capped at each size. */
export function allocateQuotas(sizes: Record<Nature, number>, n: number): Record<Nature, number> {
  const total = NATURES.reduce((sum, k) => sum + sizes[k], 0);
  const quotas = zeroByNature();
  if (total === 0) return quotas;
  const target = Math.min(n, total);
  const exact = NATURES.map((k) => ({ k, x: (sizes[k] / total) * target }));
  for (const { k, x } of exact) quotas[k] = Math.floor(x);
  let left = target - NATURES.reduce((sum, k) => sum + quotas[k], 0);
  // Stable sort keeps NATURES order on ties.
  const byRemainder = [...exact].sort((a, b) => b.x - Math.floor(b.x) - (a.x - Math.floor(a.x)));
  for (const { k } of byRemainder) {
    if (left === 0) break;
    if (quotas[k] < sizes[k]) {
      quotas[k]++;
      left--;
    }
  }
  return quotas;
}

const LOOKUP_BATCH = 8;

/**
 * Sample the failing cohort: companies whose opening judgment came at least `minGapDays` after
 * they stopped paying, that are legal persons and that were at least `minAgeMonths` old at T.
 * The sample is stratified by proceeding type and fully determined by `seed`.
 */
export async function buildCohort(
  judgments: readonly Judgment[],
  opts: CohortOptions,
  deps: CohortDeps = { lookup: lookupCompany },
): Promise<{ rows: CohortRow[]; funnel: CohortFunnel }> {
  const n = opts.n ?? 150;
  const minGapDays = opts.minGapDays ?? 30;
  const minAgeMonths = opts.minAgeMonths ?? 18;

  const funnel: CohortFunnel = {
    judgments: judgments.length,
    noCessationDate: 0,
    implausibleGap: 0,
    gapUnder30Days: 0,
    soleTraderByNotice: 0,
    eligibleByNature: zeroByNature(),
    quotas: zeroByNature(),
    evaluated: 0,
    notFound: 0,
    rejectedSoleTrader: 0,
    rejectedNoCreationDate: 0,
    rejectedTooYoung: 0,
    selected: 0,
    selectedByNature: zeroByNature(),
  };

  const pools: Record<Nature, Judgment[]> = { liquidation: [], redressement: [], sauvegarde: [] };
  const seen = new Set<string>();
  for (const j of judgments) {
    if (seen.has(j.siren)) continue;
    seen.add(j.siren);
    const gap = gapDays(j);
    if (gap === null) funnel.noCessationDate++;
    else if (typeof gap === "string") funnel.implausibleGap++;
    else if (gap < minGapDays) funnel.gapUnder30Days++;
    // The notice already says it is a natural person: skip the registry call.
    else if (j.personType === "pp") funnel.soleTraderByNotice++;
    else pools[j.nature].push(j);
  }
  for (const nature of NATURES) funnel.eligibleByNature[nature] = pools[nature].length;
  funnel.quotas = allocateQuotas(funnel.eligibleByNature, n);

  const rows: CohortRow[] = [];
  for (const nature of NATURES) {
    const quota = funnel.quotas[nature];
    // Sort first so the draw does not depend on the order the API returned notices in.
    const ordered = [...pools[nature]].sort((a, b) => a.noticeId.localeCompare(b.noticeId));
    const pool = shuffle(ordered, seededRng(`${opts.seed}:cohort:${nature}`));
    let picked = 0;
    for (let i = 0; i < pool.length && picked < quota; i += LOOKUP_BATCH) {
      const batch = pool.slice(i, i + LOOKUP_BATCH);
      const profiles = await mapLimit(batch, 4, (j) => deps.lookup(j.siren));
      for (const [k, j] of batch.entries()) {
        if (picked >= quota) break;
        funnel.evaluated++;
        const profile = profiles[k];
        const T = j.cessationDate as string;
        if (!profile?.natureJuridique) {
          funnel.notFound++;
        } else if (!isLegalPerson(profile)) {
          funnel.rejectedSoleTrader++;
        } else if (!profile.createdOn) {
          funnel.rejectedNoCreationDate++;
        } else if (profile.createdOn > addMonths(T, -minAgeMonths)) {
          funnel.rejectedTooYoung++;
        } else {
          picked++;
          rows.push({
            siren: j.siren,
            T,
            publishedOn: j.publishedOn,
            judgmentDate: j.judgmentDate,
            nature,
            naf: profile.naf,
            nafSection: profile.nafSection,
            createdOn: profile.createdOn,
            natureJuridique: profile.natureJuridique,
            department: j.department,
          });
        }
      }
    }
    funnel.selectedByNature[nature] = picked;
    funnel.selected += picked;
  }
  return { rows, funnel };
}
