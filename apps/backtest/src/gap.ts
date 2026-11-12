import { type Judgment, NATURES, type Nature } from "./bodacc.ts";
import { addMonths, daysBetween } from "./dates.ts";

/** Gaps beyond this are parse errors or decades-old reopened files, not a silent period. */
const MAX_GAP_MONTHS = 36;

export type GapStats = {
  /** Judgments considered. */
  n: number;
  /** Of those, how many carry a parsed cessation-of-payments date. */
  nWithCessation: number;
  /** Dated judgments left out of the statistics, by reason. */
  excluded: { negative: number; overThreeYears: number; total: number };
  /** Gaps that went into the statistics: nWithCessation - excluded.total. */
  nMeasured: number;
  medianDays: number | null;
  p25Days: number | null;
  p75Days: number | null;
  shareOver90Days: number | null;
  shareOver180Days: number | null;
  longest: { siren: string; days: number } | null;
};

export type SilentGap = GapStats & { byNature: Record<Nature, GapStats> };

/**
 * Percentile of an ascending array, linear interpolation between closest ranks
 * (the "type 7" definition used by numpy and R by default).
 */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) throw new Error("percentile of an empty list");
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  const a = sorted[lo] as number;
  const b = sorted[hi] as number;
  return a + (h - lo) * (b - a);
}

const round = (x: number, digits: number) => Math.round(x * 10 ** digits) / 10 ** digits;

/** Gap in days between the cessation of payments and the BODACC notice, if it can be measured. */
export function gapDays(j: Judgment): number | "negative" | "overThreeYears" | null {
  if (!j.cessationDate) return null;
  const days = daysBetween(j.cessationDate, j.publishedOn);
  if (days < 0) return "negative";
  if (addMonths(j.cessationDate, MAX_GAP_MONTHS) < j.publishedOn) return "overThreeYears";
  return days;
}

function stats(judgments: readonly Judgment[]): GapStats {
  const excluded = { negative: 0, overThreeYears: 0, total: 0 };
  const gaps: Array<{ siren: string; days: number }> = [];
  let nWithCessation = 0;
  for (const j of judgments) {
    const gap = gapDays(j);
    if (gap === null) continue;
    nWithCessation++;
    if (typeof gap === "string") {
      excluded[gap]++;
      excluded.total++;
      continue;
    }
    gaps.push({ siren: j.siren, days: gap });
  }
  const sorted = gaps.map((g) => g.days).sort((a, b) => a - b);
  const share = (threshold: number) =>
    sorted.length ? round(sorted.filter((d) => d > threshold).length / sorted.length, 4) : null;
  const pct = (p: number) => (sorted.length ? round(percentile(sorted, p), 2) : null);
  const longest = gaps.reduce<{ siren: string; days: number } | null>(
    (best, g) => (!best || g.days > best.days ? g : best),
    null,
  );
  return {
    n: judgments.length,
    nWithCessation,
    excluded,
    nMeasured: sorted.length,
    medianDays: pct(0.5),
    p25Days: pct(0.25),
    p75Days: pct(0.75),
    shareOver90Days: share(90),
    shareOver180Days: share(180),
    longest,
  };
}

/**
 * How long a company had already stopped paying its debts before the public notice appeared:
 * days from the court-fixed cessation-of-payments date to the BODACC publication.
 */
export function silentGap(judgments: readonly Judgment[]): SilentGap {
  const byNature = Object.fromEntries(
    NATURES.map((nature) => [nature, stats(judgments.filter((j) => j.nature === nature))]),
  ) as Record<Nature, GapStats>;
  return { ...stats(judgments), byNature };
}
