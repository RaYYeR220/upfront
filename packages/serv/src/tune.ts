import type { Policy } from "@upfront/core";
import type OpenAI from "openai";
import { costUsd, jsonContent, MODELS, type Usage, usageOf } from "./client.ts";

export const TUNE_SYSTEM = `You maintain the credit policy of a small business. The policy is plain English and decides the payment terms offered to client companies.

You get the current policy, how it did on past clients whose outcome is now known, and its mistakes:
- "missed": a client that later stopped paying got credit (Net terms) when the policy should have asked for a deposit or prepayment,
- "false alarm": a client that kept paying was asked for a deposit or prepayment.
"record" says how many clients that stopped paying were caught and how many that kept paying were flagged. "patterns" counts, for each combination of warning signs, how many clients stopped paying and how many kept paying, and how often the current policy flagged them: a sign that is as common among clients that kept paying as among those that stopped is weak evidence. Each mistake lists the facts that were public at the time. You may also get critiques from an independent reviewer.

The goal is the largest gap between the share of failing clients caught and the share of healthy clients flagged. Propose ONE revised policy toward that goal. Keep it short (under 1,200 characters), in the same style, with concrete thresholds. Use only facts that appear in the mistakes. Keep the decline rules. Answer with the full revised text and one sentence on what changed.`;

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["text", "rationale"],
  properties: { text: { type: "string" }, rationale: { type: "string" } },
} as const;

export interface Mistake {
  kind: "missed" | "false alarm";
  terms: string;
  facts: string[];
}

export async function proposeAmendment(
  c: OpenAI,
  a: { policy: Policy; mistakes: Mistake[]; critiques: string[]; record?: string; patterns?: string[] },
  model = MODELS.tune,
): Promise<{ text: string; rationale: string; usage: Usage; costUsd: number }> {
  const r = await c.chat.completions.create({
    model,
    // Set explicitly: left unset, the server derives a ceiling from the account balance that can exceed the model limit.
    max_completion_tokens: 16_000,
    messages: [
      { role: "system", content: TUNE_SYSTEM },
      {
        role: "user",
        content: JSON.stringify({
          policy: a.policy.text,
          record: a.record ?? null,
          patterns: a.patterns ?? [],
          mistakes: a.mistakes.slice(0, 50),
          critiques: a.critiques.slice(0, 20),
        }),
      },
    ],
    response_format: { type: "json_schema", json_schema: { name: "amendment", strict: true, schema } },
  });
  const out = jsonContent(r) as { text?: unknown; rationale?: unknown };
  const usage = usageOf(r);
  if (typeof out?.text !== "string" || out.text.length < 40) throw new Error("amendment: no usable policy text");
  return { text: out.text.slice(0, 1500), rationale: String(out.rationale ?? ""), usage, costUsd: costUsd(model, usage) };
}
