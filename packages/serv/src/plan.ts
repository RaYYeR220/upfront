import { affordable, type LookupSpec } from "@upfront/sources";
import type OpenAI from "openai";
import { costUsd, jsonContent, MODELS, type Usage, usageOf } from "./client.ts";

export const PLAN_SYSTEM = `You choose which public records are worth buying before a small business extends credit to a client company.
You get the invoice amount, a budget in USD and a menu of records with prices and what each one tells you.
Buy what changes the decision for this amount: for a small invoice, the essentials and one cheap signal; for a large one, the filings and finances too. Skip records whose answer would not change the terms.
Answer with the keys to buy and one sentence on why.`;

const planSchema = {
  type: "object",
  additionalProperties: false,
  required: ["keys", "why"],
  properties: { keys: { type: "array", items: { type: "string" } }, why: { type: "string" } },
} as const;

export interface PlanOutput {
  keys: string[];
  dropped: string[];
  totalUsd: number;
  why: string;
  usage: Usage;
  costUsd: number;
  model: string;
}

/** The model proposes; code keeps the essentials and enforces the budget. */
export async function planLookups(
  c: OpenAI,
  a: { menu: LookupSpec[]; amountEur: number; budgetUsd: number },
  model = MODELS.plan,
): Promise<PlanOutput> {
  const r = await c.chat.completions.create({
    model,
    messages: [
      { role: "system", content: PLAN_SYSTEM },
      {
        role: "user",
        content: JSON.stringify({
          amountEur: a.amountEur,
          budgetUsd: a.budgetUsd,
          menu: a.menu.map((m) => ({ key: m.key, priceUsd: m.priceUsd, purpose: m.purpose, essential: m.essential })),
        }),
      },
    ],
    response_format: { type: "json_schema", json_schema: { name: "plan", strict: true, schema: planSchema } },
  });
  const out = jsonContent(r) as { keys?: unknown; why?: unknown };
  const chosen = Array.isArray(out?.keys) ? out.keys.map(String) : [];
  const fit = affordable(a.menu, chosen, a.budgetUsd);
  const usage = usageOf(r);
  return { ...fit, why: typeof out?.why === "string" ? out.why : "", usage, costUsd: costUsd(model, usage), model };
}
