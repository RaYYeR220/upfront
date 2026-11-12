import type { Candidate } from "@upfront/sources";
import type OpenAI from "openai";
import { costUsd, jsonContent, MODELS, type Usage, usageOf } from "./client.ts";

export const RESOLVE_SYSTEM = `You match what a user typed to one company in a list of register search results.
Pick a company only when the name, city or activity in the query clearly points to it. If two companies fit about equally, or none fits, answer siren null.
yesProb is your probability, from 0 to 1, that the pick is the company the user means.`;

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["siren", "yesProb"],
  properties: { siren: { type: ["string", "null"] }, yesProb: { type: "number" } },
} as const;

/** Below this, the user chooses. A wrong company is worse than one more click. */
export const PICK_THRESHOLD = 0.8;

export async function pickCandidate(
  c: OpenAI,
  a: { query: string; candidates: Candidate[] },
  model = MODELS.resolve,
): Promise<{ siren: string | null; yesProb: number; usage: Usage; costUsd: number; model: string }> {
  const r = await c.chat.completions.create({
    model,
    messages: [
      { role: "system", content: RESOLVE_SYSTEM },
      {
        role: "user",
        content: JSON.stringify({
          query: a.query,
          candidates: a.candidates.map(({ siren, name, city, naf, active }) => ({ siren, name, city, naf, active })),
        }),
      },
    ],
    response_format: { type: "json_schema", json_schema: { name: "pick", strict: true, schema } },
  });
  const out = jsonContent(r) as { siren?: unknown; yesProb?: unknown };
  const usage = usageOf(r);
  const yesProb = typeof out?.yesProb === "number" ? out.yesProb : 0;
  const siren = typeof out?.siren === "string" ? out.siren : null;
  const known = siren !== null && a.candidates.some((x) => x.siren === siren);
  return {
    siren: known && yesProb >= PICK_THRESHOLD ? siren : null,
    yesProb,
    usage,
    costUsd: costUsd(model, usage),
    model,
  };
}
