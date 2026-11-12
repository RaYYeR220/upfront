import type { Fact, FloorResult, Policy } from "@upfront/core";
import type OpenAI from "openai";
import { costUsd, jsonContent, MODELS, type Usage, usageOf } from "./client.ts";

/**
 * Fixed preamble placed before the user's policy. It never changes, so the
 * system prompt (and with it SERV's compiled reasoning graph) is stable per
 * policy version.
 */
export const DECIDE_PREAMBLE = `You decide the payment terms a small business should offer one client company, following the credit policy below.

You receive dated facts about the client, each with an id, the invoice amount, the requested net days, today's date and a floor.
- Use only the facts given. Do not assume anything that is not in them.
- Every reason must cite the ids of the facts it relies on.
- Never offer terms looser than the floor. Order from loosest to strictest: net, deposit, prepay, decline.
- When facts conflict, follow the policy's rule for conflicting signals.
- When the evidence is thin for the amount at stake, prefer a deposit over credit.
Terms: "net" = pay within netDays, optionally up to creditLimitEur; "deposit" = depositPct paid up front, the rest on delivery; "prepay" = full payment before work starts; "decline" = do not take the work. Set unused fields to null.`;

export const SHADOW_HINT =
  "Every reason must cite at least one fact id that appears in the input facts. Terms must never be looser than the floor given in the input.";

const decisionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["terms", "reasons", "confidence"],
  properties: {
    terms: {
      type: "object",
      additionalProperties: false,
      required: ["mode", "netDays", "creditLimitEur", "depositPct"],
      properties: {
        mode: { type: "string", enum: ["net", "deposit", "prepay", "decline"] },
        netDays: { type: ["integer", "null"] },
        creditLimitEur: { type: ["integer", "null"] },
        depositPct: { type: ["integer", "null"] },
      },
    },
    reasons: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["factIds", "text"],
        properties: { factIds: { type: "array", items: { type: "string" } }, text: { type: "string" } },
      },
    },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
  },
} as const;

export const servTools = (hint: string, maxIterations = 3) => [
  { type: "function" as const, function: { name: "serv_prompt_guard" } },
  {
    type: "function" as const,
    function: {
      name: "serv_shadow_agent",
      parameters: {
        type: "object",
        properties: {
          hint: { type: "string", default: hint },
          max_iterations: { type: "integer", default: maxIterations },
        },
      },
    },
  },
];

export function systemPrompt(policy: Policy): string {
  return `${DECIDE_PREAMBLE}\n\n## The credit policy\n\n${policy.text}`;
}

/** Null fields become absent so the result matches the core Decision shape. */
export function normalizeDecision(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const d = raw as { terms?: Record<string, unknown> };
  if (!d.terms || typeof d.terms !== "object") return raw;
  const terms = Object.fromEntries(Object.entries(d.terms).filter(([, v]) => v !== null));
  return { ...d, terms };
}

export interface DecideArgs {
  policy: Policy;
  facts: Fact[];
  floor: FloorResult;
  amountEur: number;
  netDaysRequested?: number;
  today: string;
}

export interface DecideOutput {
  raw: unknown;
  usage: Usage;
  costUsd: number;
  ms: number;
  model: string;
}

export async function decide(c: OpenAI, a: DecideArgs, model = MODELS.decide): Promise<DecideOutput> {
  const t0 = Date.now();
  const payload = {
    amountEur: a.amountEur,
    netDaysRequested: a.netDaysRequested ?? 30,
    today: a.today,
    floor: { mode: a.floor.floor, because: a.floor.because },
    facts: a.facts.map((f) => ({ id: f.id, kind: f.kind, value: f.value, date: f.observedAt })),
  };
  const r = await c.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt(a.policy) },
      { role: "user", content: JSON.stringify(payload) },
    ],
    response_format: { type: "json_schema", json_schema: { name: "decision", strict: true, schema: decisionSchema } },
    tools: servTools(SHADOW_HINT),
  });
  const usage = usageOf(r);
  return { raw: normalizeDecision(jsonContent(r)), usage, costUsd: costUsd(model, usage), ms: Date.now() - t0, model };
}
