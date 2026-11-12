import type { Decision, Fact, Policy } from "@upfront/core";
import { describe, expect, it } from "vitest";
import { awaitReview, reppoClient } from "../src/client.ts";
import { buildReviewPacket } from "../src/packet.ts";

const policy: Policy = { id: "p", name: "p", version: 1, text: "Default: Net 30.", hash: "h" };
const facts: Fact[] = [
  { id: "f_1", kind: "identity.name", value: "KD SOCCER CONSULTING", observedAt: "2018-07-01", source: "s", receiptId: "r" },
  { id: "f_2", kind: "identity.vat", value: "FR12841936560", observedAt: "2018-07-01", source: "s", receiptId: "r" },
  { id: "f_3", kind: "identity.created_on", value: "2018-07-01", observedAt: "2018-07-01", source: "s", receiptId: "r" },
  {
    id: "f_4",
    kind: "bodacc.event",
    value: { family: "procedure", category: "ouverture_redressement", publishedOn: "2025-02-01", noticeId: "A202601971788", court: "Greffe du Tribunal de Commerce de Meaux", note: "SIREN 841936560" },
    observedAt: "2025-02-01",
    source: "s",
    receiptId: "r",
  },
  { id: "f_5", kind: "accounts.overdue_months", value: 7, observedAt: "2026-11-12", source: "derived", receiptId: null },
];
const decision: Decision = {
  terms: { mode: "deposit", depositPct: 30 },
  reasons: [{ factIds: ["f_5"], text: "Accounts are 7 months overdue." }],
  confidence: "medium",
};

describe("buildReviewPacket", () => {
  const p = buildReviewPacket({ policy, facts, decision, amountEur: 3200 });
  it("asks for an action review with the policy, facts and decision", () => {
    expect(p.taskType).toBe("action");
    expect(p.input).toContain("Company A");
    expect(p.input).toContain("Default: Net 30.");
    expect(p.input).toContain("[f_5] accounts.overdue_months: 7 (2026-11-12)");
    expect(p.input).toContain("deposit");
    expect(p.input).toContain("Accounts are 7 months overdue.");
  });
  it("never leaks the client's identity to the public feed", () => {
    expect(p.input).not.toContain("KD SOCCER");
    expect(p.input).not.toContain("FR12841936560");
    expect(p.input).not.toMatch(/\b\d{9}\b/);
    expect(p.input).not.toContain("A202601971788");
    expect(Buffer.byteLength(p.input)).toBeLessThan(50_000);
  });
});

function mockReppo(responses: Array<{ status: number; body: unknown }>) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  let i = 0;
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = responses[Math.min(i++, responses.length - 1)]!;
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  };
  return { client: reppoClient("key", { fetch: fetch as typeof globalThis.fetch }), calls };
}

describe("reppo client", () => {
  it("submits an eval and reads a completed verdict", async () => {
    const { client, calls } = mockReppo([
      { status: 201, body: { id: "ev_1", status: "QUEUED" } },
      { status: 200, body: { id: "ev_1", status: "PROCESSING" } },
      {
        status: 200,
        body: { id: "ev_1", status: "COMPLETED", score: 82, route: "ship", creditsCharged: 440, result: { reason: "Follows the policy.", decision: "accept" } },
      },
    ]);
    const { id } = await client.submit({ taskType: "action", input: "x" });
    expect(calls[0]).toMatchObject({ url: "https://eval.reppo.xyz/api/v1/agents/evals", method: "POST", body: { taskType: "action", input: "x" } });
    const r = await awaitReview(client, id, { timeoutMs: 5_000, pollMs: 1 });
    expect(r).toEqual({ status: "done", evalId: "ev_1", score: 82, route: "ship", reason: "Follows the policy.", creditsCharged: 440 });
  });

  it("reports a failed eval", async () => {
    const { client } = mockReppo([{ status: 200, body: { id: "ev_2", status: "FAILED" } }]);
    expect(await client.get("ev_2")).toMatchObject({ status: "failed", evalId: "ev_2" });
  });

  it("gives up after the timeout and says so", async () => {
    const { client } = mockReppo([{ status: 200, body: { id: "ev_3", status: "PROCESSING" } }]);
    expect(await awaitReview(client, "ev_3", { timeoutMs: 30, pollMs: 5 })).toMatchObject({ status: "failed", reason: "timeout" });
  });

  it("reports missing credits instead of throwing", async () => {
    const { client } = mockReppo([{ status: 402, body: { error: "insufficient credits" } }]);
    await expect(client.submit({ taskType: "action", input: "x" })).rejects.toThrow(/credits/);
  });
});
