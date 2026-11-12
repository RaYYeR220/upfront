import { describe, expect, it } from "vitest";
import type { Judgment, Nature } from "../src/bodacc.ts";
import { addMonths, daysBetween } from "../src/dates.ts";
import { percentile, silentGap } from "../src/gap.ts";

let seq = 0;
function judgment(
  publishedOn: string,
  cessationDate: string | null,
  nature: Nature = "liquidation",
  siren = String(100000000 + ++seq),
): Judgment {
  return {
    noticeId: `T${seq}`,
    siren,
    publishedOn,
    judgmentDate: publishedOn,
    nature,
    court: null,
    cessationDate,
    liquidator: null,
    personType: "pm",
    department: null,
    raw: "",
  };
}

describe("dates", () => {
  it("counts whole days between ISO dates", () => {
    expect(daysBetween("2026-03-01", "2026-03-31")).toBe(30);
    expect(daysBetween("2025-12-31", "2026-01-01")).toBe(1);
    expect(daysBetween("2026-03-31", "2026-03-01")).toBe(-30);
  });

  it("adds calendar months and clamps to the end of the month", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-03-15", -18)).toBe("2024-09-15");
    expect(addMonths("2024-02-29", 12)).toBe("2025-02-28");
  });
});

describe("percentile", () => {
  it("interpolates linearly between closest ranks", () => {
    const sorted = [10, 20, 30, 40, 100];
    expect(percentile(sorted, 0)).toBe(10);
    expect(percentile(sorted, 0.25)).toBe(20);
    expect(percentile(sorted, 0.5)).toBe(30);
    expect(percentile(sorted, 0.75)).toBe(40);
    expect(percentile(sorted, 1)).toBe(100);
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25);
    expect(percentile([10, 20, 30, 40], 0.25)).toBe(17.5);
  });
});

describe("silentGap", () => {
  it("summarises the delay between cessation of payments and publication", () => {
    const list: Judgment[] = [
      // gaps in days: 10, 30, 60, 91, 120, 181, 200, 400
      judgment("2026-03-11", "2026-03-01"),
      judgment("2026-03-31", "2026-03-01"),
      judgment("2026-04-30", "2026-03-01"),
      judgment("2026-05-31", "2026-03-01", "redressement"),
      judgment("2026-06-29", "2026-03-01", "redressement"),
      judgment("2026-08-29", "2026-03-01"),
      judgment("2026-09-17", "2026-03-01"),
      judgment("2026-04-05", "2025-03-01", "liquidation", "999999999"),
      // no cessation date at all
      judgment("2026-03-01", null, "sauvegarde"),
      judgment("2026-03-01", null),
      // negative gap: cessation after publication
      judgment("2026-03-01", "2026-04-01"),
      // over 36 months: a bad parse, not a real gap
      judgment("2026-03-01", "1994-11-03"),
    ];

    const gap = silentGap(list);

    expect(gap.n).toBe(12);
    expect(gap.nWithCessation).toBe(10);
    expect(gap.excluded).toEqual({ negative: 1, overThreeYears: 1, total: 2 });
    expect(gap.nMeasured).toBe(8);
    // sorted: 10 30 60 91 120 181 200 400
    expect(gap.p25Days).toBe(52.5); // h = 1.75 -> 30 + 0.75 * 30
    expect(gap.medianDays).toBe(105.5); // h = 3.5 -> (91 + 120) / 2
    expect(gap.p75Days).toBe(185.75); // h = 5.25 -> 181 + 0.25 * 19
    expect(gap.shareOver90Days).toBe(0.625); // 5 of 8
    expect(gap.shareOver180Days).toBe(0.375); // 3 of 8
    expect(gap.longest).toEqual({ siren: "999999999", days: 400 });

    expect(gap.byNature.redressement).toMatchObject({
      n: 2,
      nWithCessation: 2,
      nMeasured: 2,
      medianDays: 105.5,
      p25Days: 98.25,
      p75Days: 112.75,
      shareOver90Days: 1,
      shareOver180Days: 0,
    });
    expect(gap.byNature.liquidation).toMatchObject({ n: 9, nWithCessation: 8, nMeasured: 6 });
    expect(gap.byNature.sauvegarde).toMatchObject({
      n: 1,
      nWithCessation: 0,
      nMeasured: 0,
      medianDays: null,
      longest: null,
    });
  });

  it("counts cessation dates pinned at the 18-month backdating limit", () => {
    const capped = { ...judgment("2026-06-11", "2024-12-01"), judgmentDate: "2026-06-01" };
    const nearCap = { ...judgment("2026-06-11", "2024-12-03"), judgmentDate: "2026-06-01" };
    const notCapped = { ...judgment("2026-06-11", "2025-09-01"), judgmentDate: "2026-06-01" };
    const noJudgmentDate = { ...judgment("2026-06-11", "2024-12-01"), judgmentDate: null };
    const gap = silentGap([capped, nearCap, notCapped, noJudgmentDate]);
    expect(gap.atLegalCap).toBe(2);
    expect(gap.shareAtLegalCap).toBe(0.5);
    expect(gap.byNature.liquidation.atLegalCap).toBe(2);
  });

  it("handles an empty list", () => {
    const gap = silentGap([]);
    expect(gap.n).toBe(0);
    expect(gap.medianDays).toBeNull();
    expect(gap.shareOver90Days).toBeNull();
  });
});
