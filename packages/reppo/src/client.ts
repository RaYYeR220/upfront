export const REPPO_BASE = "https://eval.reppo.xyz/api/v1";

export interface ReviewResult {
  status: "pending" | "done" | "failed";
  evalId?: string;
  score?: number;
  route?: "ship" | "review" | "block";
  reason?: string;
  creditsCharged?: number;
}

export interface ReppoClient {
  submit(p: { taskType: string; input: string }): Promise<{ id: string }>;
  get(id: string): Promise<ReviewResult>;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});

function toReview(body: unknown): ReviewResult {
  const b = obj(body);
  const status = String(b.status ?? "");
  const evalId = typeof b.id === "string" ? b.id : undefined;
  if (status === "COMPLETED") {
    const result = obj(b.result);
    const route = (b.route ?? result.route) as ReviewResult["route"];
    const score = typeof b.score === "number" ? b.score : typeof result.score === "number" ? result.score : undefined;
    const out: ReviewResult = { status: "done", evalId, score, route };
    if (typeof result.reason === "string") out.reason = result.reason;
    if (typeof b.creditsCharged === "number") out.creditsCharged = b.creditsCharged;
    return out;
  }
  if (status === "FAILED") return { status: "failed", evalId, reason: "evaluation failed" };
  return { status: "pending", evalId };
}

/** Reppo Evaluation API (eval.reppo.xyz/agents.md), API-key flow. */
export function reppoClient(apiKey: string, opts: { fetch?: typeof fetch; base?: string } = {}): ReppoClient {
  const f = opts.fetch ?? fetch;
  const base = opts.base ?? REPPO_BASE;
  const headers = { authorization: `Bearer ${apiKey}`, "content-type": "application/json" };
  return {
    async submit(p) {
      const r = await f(`${base}/agents/evals`, { method: "POST", headers, body: JSON.stringify(p) });
      const body = await r.json().catch(() => ({}));
      if (r.status === 402) throw new Error("Reppo: not enough credits for an evaluation");
      if (!r.ok) throw new Error(`Reppo: submit failed with HTTP ${r.status}`);
      const id = obj(body).id;
      if (typeof id !== "string") throw new Error("Reppo: no evaluation id in the response");
      return { id };
    },
    async get(id) {
      const r = await f(`${base}/agents/evals/${encodeURIComponent(id)}`, { headers });
      if (!r.ok) return { status: "failed", evalId: id, reason: `HTTP ${r.status}` };
      return toReview(await r.json());
    },
  };
}

/** Polls until the verdict lands. Evaluations usually take 30 to 90 seconds. */
export async function awaitReview(
  c: ReppoClient,
  id: string,
  o: { timeoutMs: number; pollMs: number },
): Promise<ReviewResult> {
  const deadline = Date.now() + o.timeoutMs;
  while (Date.now() < deadline) {
    const r = await c.get(id);
    if (r.status !== "pending") return r;
    await new Promise((res) => setTimeout(res, o.pollMs));
  }
  return { status: "failed", evalId: id, reason: "timeout" };
}
