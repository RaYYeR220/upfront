import { countCollectiveNotices } from "./bodacc.ts";
import type { CohortRow } from "./cohort.ts";
import {
  type CompanyProfile,
  isLegalPerson,
  type SearchFilters,
  searchActiveCompanies,
} from "./companies.ts";
import { addMonths } from "./dates.ts";
import { seededRng, shuffle } from "./random.ts";

export type MatchTier = "sameFormAndDepartment" | "sameForm" | "sectionOnly";

export type ControlRow = Omit<CohortRow, "publishedOn" | "judgmentDate" | "nature"> & {
  publishedOn: null;
  judgmentDate: null;
  nature: null;
  /** SIREN of the failing company this control is matched to. */
  pairedWith: string;
  matchTier: MatchTier;
};

export type ControlDeps = {
  search: (
    filters: SearchFilters,
    page: number,
  ) => Promise<{ totalPages: number; results: CompanyProfile[] }>;
  collectiveNoticeCount: (siren: string) => Promise<number>;
};

export type ControlOptions = {
  seed: string;
  /** Creation year must be within this many years of the paired company's. */
  yearWindow?: number;
  /** Same age floor as the cohort: the control must have existed this long at T. */
  minAgeMonths?: number;
  /** Random result pages to try per tier before relaxing the match. */
  pagesPerTier?: number;
};

export type ControlFunnel = {
  cohort: number;
  matched: number;
  unmatched: number;
  byTier: Record<MatchTier, number>;
  pagesFetched: number;
  candidatesSeen: number;
  rejectedAlreadyUsed: number;
  rejectedAttributes: number;
  bodaccChecks: number;
  rejectedHasProceedings: number;
};

const defaultDeps: ControlDeps = {
  search: searchActiveCompanies,
  collectiveNoticeCount: countCollectiveNotices,
};

const year = (iso: string) => Number(iso.slice(0, 4));

/**
 * One healthy control per failing company: active today, a legal person, same NAF section,
 * created within ±yearWindow years, old enough at T, and never named in a BODACC
 * collective-proceedings notice. The control inherits its pair's T.
 *
 * Candidates are drawn from random result pages of the company search. Matching starts strict
 * (same legal form and department) and relaxes to the NAF section alone when nothing fits.
 * Rows are processed in order so a company is never used twice, which keeps the draw
 * reproducible for a given seed and API cache.
 */
export async function buildControls(
  cohort: readonly CohortRow[],
  opts: ControlOptions,
  deps: ControlDeps = defaultDeps,
): Promise<{ rows: ControlRow[]; funnel: ControlFunnel }> {
  const yearWindow = opts.yearWindow ?? 3;
  const minAgeMonths = opts.minAgeMonths ?? 18;
  const pagesPerTier = opts.pagesPerTier ?? 3;

  const funnel: ControlFunnel = {
    cohort: cohort.length,
    matched: 0,
    unmatched: 0,
    byTier: { sameFormAndDepartment: 0, sameForm: 0, sectionOnly: 0 },
    pagesFetched: 0,
    candidatesSeen: 0,
    rejectedAlreadyUsed: 0,
    rejectedAttributes: 0,
    bodaccChecks: 0,
    rejectedHasProceedings: 0,
  };
  const used = new Set(cohort.map((r) => r.siren));
  const rows: ControlRow[] = [];

  for (const row of cohort) {
    const section = row.nafSection;
    if (!section) {
      funnel.unmatched++;
      continue;
    }
    const rng = seededRng(`${opts.seed}:control:${row.siren}`);
    const latestCreation = addMonths(row.T, -minAgeMonths);
    const fits = (c: CompanyProfile) =>
      c.state === "A" &&
      isLegalPerson(c) &&
      c.nafSection === section &&
      !!c.createdOn &&
      Math.abs(year(c.createdOn) - year(row.createdOn)) <= yearWindow &&
      c.createdOn <= latestCreation;

    const tiers: Array<[MatchTier, SearchFilters]> = [];
    if (row.department) {
      tiers.push([
        "sameFormAndDepartment",
        { section, natureJuridique: row.natureJuridique, department: row.department },
      ]);
    }
    tiers.push(["sameForm", { section, natureJuridique: row.natureJuridique }]);
    tiers.push(["sectionOnly", { section }]);

    let match: { company: CompanyProfile; tier: MatchTier; filters: SearchFilters } | null = null;
    for (const [tier, filters] of tiers) {
      const first = await deps.search(filters, 1);
      funnel.pagesFetched++;
      const allPages = Array.from({ length: first.totalPages }, (_, i) => i + 1);
      for (const page of shuffle(allPages, rng).slice(0, pagesPerTier)) {
        const res = page === 1 ? first : await deps.search(filters, page);
        if (page !== 1) funnel.pagesFetched++;
        for (const candidate of shuffle(res.results, rng)) {
          funnel.candidatesSeen++;
          if (used.has(candidate.siren)) {
            funnel.rejectedAlreadyUsed++;
            continue;
          }
          if (!fits(candidate)) {
            funnel.rejectedAttributes++;
            continue;
          }
          funnel.bodaccChecks++;
          if ((await deps.collectiveNoticeCount(candidate.siren)) > 0) {
            funnel.rejectedHasProceedings++;
            used.add(candidate.siren);
            continue;
          }
          match = { company: candidate, tier, filters };
          break;
        }
        if (match) break;
      }
      if (match) break;
    }

    if (!match) {
      funnel.unmatched++;
      continue;
    }
    const { company, tier, filters } = match;
    used.add(company.siren);
    funnel.matched++;
    funnel.byTier[tier]++;
    rows.push({
      siren: company.siren,
      T: row.T,
      publishedOn: null,
      judgmentDate: null,
      nature: null,
      naf: company.naf,
      nafSection: company.nafSection,
      createdOn: company.createdOn as string,
      natureJuridique: company.natureJuridique as string,
      department: filters.department ?? null,
      pairedWith: row.siren,
      matchTier: tier,
    });
  }
  return { rows, funnel };
}
