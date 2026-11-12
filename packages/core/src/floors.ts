import { stricterOf, floorDefault } from "./terms.ts";
import type { Fact, TermsMode } from "./types.ts";

export type FloorRule = "liquidation_open" | "reorganisation_open" | "ceased" | "sanctioned";

export interface FloorResult {
  floor: TermsMode | null;
  because: { factId: string; rule: FloorRule }[];
  notes: string[];
}

const RULE_FLOOR: Record<FloorRule, TermsMode> = {
  liquidation_open: "decline",
  reorganisation_open: "prepay",
  ceased: "decline",
  sanctioned: "decline",
};

function ruleFor(f: Fact): FloorRule | null {
  switch (f.kind) {
    case "proceeding.open": {
      const category = String((f.value as { category?: string } | null)?.category ?? "");
      if (category.includes("liquidation")) return "liquidation_open";
      if (category.includes("redressement") || category.includes("sauvegarde")) return "reorganisation_open";
      // An open proceeding we cannot classify is still an open proceeding.
      return "reorganisation_open";
    }
    case "status.ceased_on":
      return "ceased";
    case "sanctions.hit":
      return "sanctioned";
    default:
      return null;
  }
}

/**
 * Hard facts set a floor that the model can never go below. The floor can only
 * make terms stricter; it never loosens anything.
 */
export function computeFloor(facts: Fact[]): FloorResult {
  const because: FloorResult["because"] = [];
  const notes: string[] = [];
  let floorTerms = null as ReturnType<typeof floorDefault> | null;

  for (const f of facts) {
    const rule = ruleFor(f);
    if (!rule) continue;
    because.push({ factId: f.id, rule });
    const t = floorDefault(RULE_FLOOR[rule]);
    floorTerms = floorTerms ? stricterOf(floorTerms, t) : t;
    if (rule === "liquidation_open" || rule === "reorganisation_open") {
      notes.push(
        "An insolvency proceeding is open: creditors must declare their claim to the court-appointed representative within two months of the gazette notice.",
      );
    }
  }

  return { floor: floorTerms?.mode ?? null, because, notes: [...new Set(notes)] };
}
