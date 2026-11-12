import OpenAI from "openai";

export const SERV_BASE_URL = "https://inference-api.openserv.ai/v1";

export function servClient(apiKey: string, opts: { fetch?: typeof fetch; timeoutMs?: number } = {}): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: SERV_BASE_URL,
    fetch: opts.fetch,
    timeout: opts.timeoutMs ?? 120_000,
    maxRetries: 1,
  });
}

/**
 * Models per job. The decision runs on a small model through SERV's reasoning
 * graph with Kronos (audits the compiled graph) and Multipath (branching rule
 * sets); cheap models handle planning and disambiguation.
 */
export const MODELS = {
  decide: process.env.UPFRONT_MODEL_DECIDE ?? "gpt-5.4-mini-serv-kronos-multipath",
  plan: process.env.UPFRONT_MODEL_PLAN ?? "gpt-6-luna",
  resolve: process.env.UPFRONT_MODEL_RESOLVE ?? "gpt-6-luna",
  tune: process.env.UPFRONT_MODEL_TUNE ?? "gpt-6.1-sol",
};

/** USD per 1M tokens, SERV included (docs.openserv.ai models page, Nov 2026). */
const PRICES: Record<string, [number, number]> = {
  "gpt-6-luna": [0.13, 0.65],
  "gpt-5.4-nano": [0.25, 1.6],
  "gpt-5.6-luna": [0.25, 1.5],
  "gpt-5.4-mini": [1, 6],
  "gpt-6.1-sol": [2.4, 12],
};

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export function baseModel(model: string): string {
  return model.replace(/-serv-(kronos-multipath|multipath-kronos|kronos|multipath)$/, "");
}

/** Upstream inference cost. Graph generation and audits on a cache miss are billed on top. */
export function costUsd(model: string, u: Usage): number {
  const p = PRICES[baseModel(model)];
  if (!p) return 0;
  return (u.inputTokens * p[0] + u.outputTokens * p[1]) / 1_000_000;
}

export function usageOf(r: { usage?: { prompt_tokens?: number; completion_tokens?: number } | null }): Usage {
  return { inputTokens: r.usage?.prompt_tokens ?? 0, outputTokens: r.usage?.completion_tokens ?? 0 };
}

export function jsonContent(r: { choices: { message: { content: string | null } }[] }): unknown {
  const text = r.choices[0]?.message.content ?? "";
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
