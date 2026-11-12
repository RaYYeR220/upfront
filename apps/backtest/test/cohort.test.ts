import { describe, expect, it } from "vitest";
import type { Judgment, Nature } from "../src/bodacc.ts";
import { allocateQuotas, buildCohort, type CohortRow } from "../src/cohort.ts";
import type { CompanyProfile } from "../src/companies.ts";
import { buildControls, type ControlDeps } from "../src/controls.ts";
import { hashSeed, mulberry32, seededRng, shuffle } from "../src/random.ts";

describe("seeded random", () => {
  it("is reproducible for a given seed and differs across seeds", () => {
    const a = seededRng("upfront");
    const b = seededRng("upfront");
    const c = seededRng("another seed");
    const seqA = Array.from({ length: 5 }, () => a());
    const seqB = Array.from({ length: 5 }, () => b());
    const seqC = Array.from({ length: 5 }, () => c());
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
    for (const x of seqA) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it("matches the reference mulberry32 output", () => {
    const rng = mulberry32(42);
    expect(Math.floor(rng() * 2 ** 32)).toBe(2581720956);
    expect(hashSeed("abc")).toBe(hashSeed("abc"));
    expect(hashSeed("abc")).not.toBe(hashSeed("abd"));
  });

  it("shuffles without losing items and does not mutate its input", () => {
    const input = Array.from({ length: 20 }, (_, i) => i);
    const out = shuffle(input, seededRng("s"));
    expect(out).not.toEqual(input);
    expect([...out].sort((x, y) => x - y)).toEqual(input);
    expect(shuffle(input, seededRng("s"))).toEqual(out);
  });
});

describe("allocateQuotas", () => {
  it("splits n proportionally with largest remainders", () => {
    expect(allocateQuotas({ liquidation: 700, redressement: 290, sauvegarde: 10 }, 150)).toEqual({
      liquidation: 105,
      redressement: 44,
      sauvegarde: 1,
    });
    expect(allocateQuotas({ liquidation: 200, redressement: 100, sauvegarde: 0 }, 10)).toEqual({
      liquidation: 7,
      redressement: 3,
      sauvegarde: 0,
    });
  });

  it("never asks a stratum for more than it holds", () => {
    expect(allocateQuotas({ liquidation: 2, redressement: 1, sauvegarde: 0 }, 10)).toEqual({
      liquidation: 2,
      redressement: 1,
      sauvegarde: 0,
    });
    expect(allocateQuotas({ liquidation: 0, redressement: 0, sauvegarde: 0 }, 10)).toEqual({
      liquidation: 0,
      redressement: 0,
      sauvegarde: 0,
    });
  });
});

// A synthetic population: SIRENs ending in 7 are sole traders, those ending in 3 were created too
// recently, everything else is an eligible SAS created in 2015.
function population(size: number, nature: Nature, offset: number): Judgment[] {
  return Array.from({ length: size }, (_, i) => {
    const siren = String(300000000 + offset + i);
    return {
      noticeId: `N${offset + i}`,
      siren,
      publishedOn: "2026-06-15",
      judgmentDate: "2026-06-01",
      nature,
      court: "Greffe du Tribunal de Commerce de Lyon",
      cessationDate: i % 11 === 5 ? "2026-06-01" : "2026-02-01", // every 11th one has a 14-day gap
      liquidator: null,
      personType: "pm" as const,
      department: "69",
      raw: "",
    };
  });
}

function fakeProfile(siren: string): CompanyProfile {
  const last = siren.at(-1);
  return {
    siren,
    natureJuridique: last === "7" ? "1000" : "5710",
    naf: "62.01Z",
    nafSection: "J",
    createdOn: last === "3" ? "2025-06-01" : "2015-04-20",
    state: "C",
  };
}

const judgments = [
  ...population(300, "liquidation", 0),
  ...population(120, "redressement", 10_000),
  ...population(5, "sauvegarde", 20_000).map((j) => ({ ...j, cessationDate: null })),
];

describe("buildCohort", () => {
  const deps = { lookup: async (siren: string) => fakeProfile(siren) };

  it("is deterministic for a seed and stratified by nature", async () => {
    const first = await buildCohort(judgments, { n: 40, seed: "s1" }, deps);
    const again = await buildCohort([...judgments].reverse(), { n: 40, seed: "s1" }, deps);
    const other = await buildCohort(judgments, { n: 40, seed: "s2" }, deps);

    expect(first.rows).toHaveLength(40);
    expect(again.rows).toEqual(first.rows);
    expect(other.rows.map((r) => r.siren)).not.toEqual(first.rows.map((r) => r.siren));

    const byNature = Object.groupBy(first.rows, (r) => r.nature);
    expect(byNature.liquidation?.length).toBe(29);
    expect(byNature.redressement?.length).toBe(11);
    expect(byNature.sauvegarde).toBeUndefined();
  });

  it("applies the eligibility rules", async () => {
    const { rows, funnel } = await buildCohort(judgments, { n: 60, seed: "rules" }, deps);
    for (const row of rows) {
      expect(row.siren.endsWith("7")).toBe(false);
      expect(row.siren.endsWith("3")).toBe(false);
      expect(row.T).toBe("2026-02-01");
      expect(row).toMatchObject({
        naf: "62.01Z",
        nafSection: "J",
        natureJuridique: "5710",
        department: "69",
      });
    }
    expect(funnel.rejectedSoleTrader).toBeGreaterThan(0);
    expect(funnel.rejectedTooYoung).toBeGreaterThan(0);
    expect(funnel.gapUnder30Days).toBeGreaterThan(0);
    expect(funnel.noCessationDate).toBe(5);
  });
});

describe("buildControls", () => {
  const cohortRow = (siren: string, createdOn: string): CohortRow => ({
    siren,
    T: "2026-02-01",
    publishedOn: "2026-06-15",
    judgmentDate: "2026-06-01",
    nature: "liquidation",
    naf: "62.01Z",
    nafSection: "J",
    createdOn,
    natureJuridique: "5710",
    department: "69",
  });

  // 10 pages of 25 active companies; creation years spread from 1990 to 2024.
  const universe: CompanyProfile[] = Array.from({ length: 250 }, (_, i) => ({
    siren: String(800000000 + i),
    natureJuridique: "5710",
    naf: "62.02A",
    nafSection: "J",
    createdOn: `${1990 + (i % 35)}-05-01`,
    state: "A",
  }));
  const withProceedings = new Set(universe.filter((_, i) => i % 4 === 0).map((c) => c.siren));

  const deps: ControlDeps = {
    search: async (_filters, page) => ({
      totalPages: 10,
      results: universe.slice((page - 1) * 25, page * 25),
    }),
    collectiveNoticeCount: async (siren) => (withProceedings.has(siren) ? 2 : 0),
  };

  it("pairs each cohort row with an active, clean company of similar age", async () => {
    const cohort = [cohortRow("300000001", "2012-01-01"), cohortRow("300000002", "2001-03-01")];
    const { rows, funnel } = await buildControls(cohort, { seed: "c1" }, deps);
    expect(rows).toHaveLength(2);
    expect(funnel.unmatched).toBe(0);
    const [a, b] = rows;
    expect(a?.pairedWith).toBe("300000001");
    expect(b?.pairedWith).toBe("300000002");
    expect(Math.abs(Number(a?.createdOn.slice(0, 4)) - 2012)).toBeLessThanOrEqual(3);
    expect(Math.abs(Number(b?.createdOn.slice(0, 4)) - 2001)).toBeLessThanOrEqual(3);
    for (const row of rows) {
      expect(withProceedings.has(row.siren)).toBe(false);
      expect(row).toMatchObject({ T: "2026-02-01", nafSection: "J", nature: null, publishedOn: null });
    }
    expect(a?.siren).not.toBe(b?.siren);
  });

  it("is deterministic for a seed", async () => {
    const cohort = [cohortRow("300000001", "2012-01-01"), cohortRow("300000002", "2001-03-01")];
    const one = await buildControls(cohort, { seed: "c1" }, deps);
    const two = await buildControls(cohort, { seed: "c1" }, deps);
    expect(two.rows).toEqual(one.rows);
  });

  it("never reuses a company as a control twice", async () => {
    const cohort = Array.from({ length: 12 }, (_, i) => cohortRow(String(300000100 + i), "2012-01-01"));
    const { rows } = await buildControls(cohort, { seed: "c3" }, deps);
    expect(new Set(rows.map((r) => r.siren)).size).toBe(rows.length);
  });
});
