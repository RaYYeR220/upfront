import type { Terms, TermsMode } from "./types.ts";

const MODE_RANK: Record<TermsMode, number> = { net: 1, deposit: 2, prepay: 3, decline: 4 };

/**
 * A single number that orders terms from loosest to strictest.
 * Modes dominate; inside "net", fewer days and a lower credit limit are stricter;
 * inside "deposit", a larger deposit is stricter.
 */
export function strictness(t: Terms): number {
  const base = MODE_RANK[t.mode] * 1000;
  if (t.mode === "net") {
    const days = Math.min(120, Math.max(0, t.netDays ?? 30));
    const limitPenalty =
      t.creditLimitEur === undefined ? 0 : 400 - Math.min(400, Math.log10(Math.max(1, t.creditLimitEur)) * 50);
    return base + (120 - days) + limitPenalty;
  }
  if (t.mode === "deposit") return base + Math.min(100, Math.max(0, t.depositPct ?? 50));
  return base;
}

export function stricterOf(a: Terms, b: Terms): Terms {
  return strictness(b) > strictness(a) ? b : a;
}

export function floorDefault(mode: TermsMode): Terms {
  switch (mode) {
    case "net":
      return { mode: "net", netDays: 30 };
    case "deposit":
      return { mode: "deposit", depositPct: 50 };
    case "prepay":
      return { mode: "prepay" };
    case "decline":
      return { mode: "decline" };
  }
}

/** Terms looser than the floor are replaced by the floor's default terms. */
export function clampToFloor(t: Terms, floor: TermsMode | null): Terms {
  if (floor === null) return t;
  return MODE_RANK[t.mode] < MODE_RANK[floor] ? floorDefault(floor) : t;
}

/** One step stricter. Used when the independent reviewer blocks a decision. */
export function tightenOneNotch(t: Terms): Terms {
  switch (t.mode) {
    case "net":
      return floorDefault("deposit");
    case "deposit":
      return floorDefault("prepay");
    default:
      return t;
  }
}
