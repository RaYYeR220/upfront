import { computeFloor, type Fact, floorDefault, type Terms } from "@upfront/core";
import { monthsBetween } from "@upfront/sources";

export type Arm = "upfront" | "rule" | "net30";
export const ARMS: readonly Arm[] = ["upfront", "rule", "net30"];

/** The status quo: everyone gets Net 30. */
export function net30Arm(): Terms {
  return floorDefault("net");
}

/**
 * A credit controller's rule of thumb, no model: the hard-fact floor, then a
 * deposit when accounts are 18+ months late, a past insolvency proceeding was
 * published within 3 years, or a court ordered the company to pay within 12 months.
 */
export function ruleArm(facts: Fact[], refDate: string): { terms: Terms; why: string } {
  const floor = computeFloor(facts);
  if (floor.floor) return { terms: floorDefault(floor.floor), why: `floor: ${floor.because.map((b) => b.rule).join(", ")}` };
  const overdue = facts.find((f) => f.kind === "accounts.overdue_months" || f.kind === "accounts.never_filed")?.value;
  if (typeof overdue === "number" && overdue >= 18) return { terms: floorDefault("deposit"), why: `accounts ${overdue} months overdue` };
  const pastProceeding = facts.find(
    (f) => f.kind === "proceeding.past" && monthsBetween(f.observedAt, refDate) < 36,
  );
  if (pastProceeding) return { terms: floorDefault("deposit"), why: "insolvency proceeding in the last 3 years" };
  const orderToPay = facts.find((f) => {
    if (f.kind !== "court.decision") return false;
    const nature = String((f.value as { nature?: string })?.nature ?? "");
    return /injonction|order/i.test(nature) && monthsBetween(f.observedAt, refDate) < 12;
  });
  if (orderToPay) return { terms: floorDefault("deposit"), why: "court order to pay in the last 12 months" };
  return { terms: floorDefault("net"), why: "no warning signs" };
}
