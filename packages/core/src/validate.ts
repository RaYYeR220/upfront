import { z } from "zod";
import type { FloorResult } from "./floors.ts";
import { MODE_ORDER } from "./terms.ts";
import type { Decision, Fact } from "./types.ts";

export const TermsSchema = z.object({
  mode: z.enum(["net", "deposit", "prepay", "decline"]),
  netDays: z.number().int().min(0).max(120).optional(),
  creditLimitEur: z.number().int().min(0).optional(),
  depositPct: z.number().int().min(1).max(100).optional(),
});

export const DecisionSchema = z.object({
  terms: TermsSchema,
  reasons: z
    .array(z.object({ factIds: z.array(z.string()).min(1), text: z.string().min(1).max(400) }))
    .min(1)
    .max(8),
  confidence: z.enum(["low", "medium", "high"]),
});

export type ValidationResult = { ok: true; decision: Decision } | { ok: false; errors: string[] };

/**
 * Checks a model's decision before anything acts on it: shape, that every
 * cited fact exists, and that the terms are not looser than the floor.
 */
export function validateDecision(raw: unknown, facts: Fact[], floor: FloorResult): ValidationResult {
  const parsed = DecisionSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "decision"}: ${i.message}`) };
  }
  const decision = parsed.data as Decision;
  const errors: string[] = [];
  const known = new Set(facts.map((f) => f.id));
  for (const r of decision.reasons) {
    for (const id of r.factIds) if (!known.has(id)) errors.push(`reason cites unknown fact ${id}`);
  }
  if (floor.floor && MODE_ORDER[decision.terms.mode] < MODE_ORDER[floor.floor]) {
    errors.push(`terms "${decision.terms.mode}" are looser than the floor "${floor.floor}"`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, decision };
}
