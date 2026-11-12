import type { Policy } from "@upfront/core";
import type OpenAI from "openai";
import { costUsd, jsonContent, MODELS, type Usage, usageOf } from "./client.ts";

export const TUNE_SYSTEM = `You maintain the credit policy of a small business. The policy is plain English and decides the payment terms offered to client companies.

You get the current policy and its mistakes on past clients whose outcome is now known:
- "missed": a client that later stopped paying got credit (Net terms) when the policy should have asked for a deposit or prepayment,
- "false alarm": a client that kept paying was asked for a deposit or prepayment.
Each mistake lists the dated facts that were public at the time. You may also get critiques from an independent reviewer.

Propose ONE revised policy that fixes the most mistakes without creating new false alarms. Keep it short (under 1,200 characters), in the same style, with concrete thresholds. Never add rules that depend on facts not shown. Answer with the full revised text and one sentence on what changed.`;

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
  a: { policy: Policy; mistakes: Mistake[]; critiques: string[] },
  model = MODELS.tune,
): Promise<{ text: string; rationale: string; usage: Usage; costUsd: number }> {
  const r = await c.chat.completions.create({
    model,
    messages: [
      { role: "system", content: TUNE_SYSTEM },
      {
        role: "user",
        content: JSON.stringify({ policy: a.policy.text, mistakes: a.mistakes.slice(0, 40), critiques: a.critiques.slice(0, 20) }),
      },
    ],
    response_format: { type: "json_schema", json_schema: { name: "amendment", strict: true, schema } },
  });
  const out = jsonContent(r) as { text?: unknown; rationale?: unknown };
  const usage = usageOf(r);
  if (typeof out?.text !== "string" || out.text.length < 40) throw new Error("amendment: no usable policy text");
  return { text: out.text.slice(0, 1500), rationale: String(out.rationale ?? ""), usage, costUsd: costUsd(model, usage) };
}
