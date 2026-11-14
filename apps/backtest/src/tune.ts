import { createHash } from "node:crypto";
import type { ArmMetrics } from "./metrics.ts";

/** A revised policy must not raise false alarms above this on held-out companies. */
export const FALSE_ALARM_CAP = 0.1;

/** Caught minus false alarms (Youden's J): 0 for Net 30 to everyone, 1 for a perfect policy. */
export const informedness = (m: ArmMetrics): number => Math.round((m.caughtFailing - m.falseAlarmControls) * 10_000) / 10_000;

/**
 * A new policy version is kept only if, on the training companies, caught minus
 * false alarms goes up and false alarms stay under the cap (or under where they
 * already were, if that was higher). Held-out companies never decide anything.
 */
export function accept(old: ArmMetrics, next: ArmMetrics): { accepted: boolean; why: string } {
  const ceiling = Math.max(FALSE_ALARM_CAP, old.falseAlarmControls);
  if (next.falseAlarmControls > ceiling) {
    return { accepted: false, why: `false alarms ${pct(next.falseAlarmControls)} above ${pct(ceiling)}` };
  }
  const [a, b] = [informedness(old), informedness(next)];
  const line = `caught ${pct(old.caughtFailing)} → ${pct(next.caughtFailing)}, false alarms ${pct(old.falseAlarmControls)} → ${pct(next.falseAlarmControls)}`;
  if (b <= a) return { accepted: false, why: `${line}: no net gain` };
  return { accepted: true, why: line };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Deterministic split by pair: a failing company and its matched control always land on the same side. */
export function splitPairs<T extends { siren: string; pairedWith?: string; group: "failing" | "control" }>(
  rows: T[],
  holdoutShare = 0.4,
): { train: T[]; holdout: T[] } {
  const key = (r: T) => (r.group === "failing" ? r.siren : (r.pairedWith ?? r.siren));
  const unit = (s: string) => Number.parseInt(createHash("sha1").update(`split:${s}`).digest("hex").slice(0, 8), 16) / 2 ** 32;
  const holdout = rows.filter((r) => unit(key(r)) < holdoutShare);
  const set = new Set(holdout);
  return { train: rows.filter((r) => !set.has(r)), holdout };
}
