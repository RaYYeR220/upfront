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
  const leaky: Decision = {
    ...decision,
    reasons: [
      ...decision.reasons,
      { factIds: ["f_4"], text: "KD Soccer Consulting (SIREN 841 936 560, VAT FR 12 841936560) had a reorganisation." },
    ],
  };
  const withMoney: Fact = {
    id: "f_6",
    kind: "finance.year",
    value: { closingDate: "2024-12-31", revenue: 1_234_567, netIncome: -87_654, equityRatio: 12.345 },
    observedAt: "2024-12-31",
    source: "s",
    receiptId: "r",
  };
  const p = buildReviewPacket({
    policy: { ...policy, text: "Default: Net 30. Never trust KD SOCCER CONSULTING." },
    facts: [...facts, withMoney],
    decision: leaky,
    amountEur: 3200,
    identifiers: ["841936560"],
  });
  it("asks for an action review with the policy, facts and decision", () => {
    expect(p.taskType).toBe("action");
    expect(p.input).toContain("Company A");
    expect(p.input).toContain("Default: Net 30.");
    expect(p.input).toContain("[f_5] accounts.overdue_months: 7 (2026-11)");
    expect(p.input).toContain("deposit");
    expect(p.input).toContain("Accounts are 7 months overdue.");
  });
  it("never leaks the client's identity to the public feed, even inside free text", () => {
    expect(p.input.toLowerCase()).not.toContain("kd soccer");
    expect(p.input).not.toContain("FR12841936560");
    expect(p.input).not.toMatch(/8\D?4\D?1\D?9\D?3\D?6\D?5\D?6\D?0/);
    expect(p.input).not.toContain("A202601971788");
    expect(p.input).not.toContain("Meaux");
    expect(Buffer.byteLength(p.input)).toBeLessThan(50_000);
  });
  it("coarsens quasi-identifiers", () => {
    expect(p.input).toContain("[f_3] identity.created_on: 2018 (2018-07)");
    expect(p.input).toContain('"revenue":1200000');
    expect(p.input).toContain('"netIncome":-88000');
    expect(p.input).toContain('"equityRatio":12');
    expect(p.input).not.toContain("1234567");
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
