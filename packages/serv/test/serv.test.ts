import type { Fact } from "@upfront/core";
import { menuFor } from "@upfront/sources";
import { describe, expect, it } from "vitest";
import { servClient } from "../src/client.ts";
import { decide, DECIDE_PREAMBLE, normalizeDecision } from "../src/decide.ts";
import { pickCandidate } from "../src/resolve.ts";
import { planLookups } from "../src/plan.ts";
import { loadPolicy } from "../src/policies.ts";

function mockServ(content: unknown) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response(
      JSON.stringify({
        id: "c1",
        object: "chat.completion",
        created: 0,
        model: "m",
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(content) } }],
        usage: { prompt_tokens: 1200, completion_tokens: 300, total_tokens: 1500 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  return { client: servClient("test-key", { fetch: fetch as typeof globalThis.fetch }), calls };
}

const facts: Fact[] = [
  { id: "f_1", kind: "identity.created_on", value: "2019-04-02", observedAt: "2019-04-02", source: "sirenic/entreprise", receiptId: "r1" },
  { id: "f_2", kind: "accounts.overdue_months", value: 7, observedAt: "2026-11-12", source: "derived", receiptId: "r2" },
];
const policy = loadPolicy("freelancer");

describe("decide", () => {
  it("sends the policy as the stable system prompt with SERV's guard and validator", async () => {
    const { client, calls } = mockServ({
      terms: { mode: "deposit", netDays: null, creditLimitEur: null, depositPct: 30 },
      reasons: [{ factIds: ["f_2"], text: "Accounts are 7 months overdue." }],
      confidence: "medium",
    });
    const out = await decide(client, { policy, facts, floor: { floor: null, because: [], notes: [] }, amountEur: 3200, today: "2026-11-12" });
    const req = calls[0]!;
    expect(req.url).toBe("https://inference-api.openserv.ai/v1/chat/completions");
    expect(req.body.model).toMatch(/-serv-kronos-multipath$/);
    const messages = req.body.messages as { role: string; content: string }[];
    expect(messages[0]).toEqual({ role: "system", content: `${DECIDE_PREAMBLE}\n\n## The credit policy\n\n${policy.text}` });
    expect(JSON.parse(messages[1]!.content)).toMatchObject({ amountEur: 3200, today: "2026-11-12", facts: [{ id: "f_1" }, { id: "f_2" }] });
    expect((req.body.response_format as { json_schema: { strict: boolean } }).json_schema.strict).toBe(true);
    expect(JSON.stringify(req.body.response_format)).not.toMatch(/minimum|maximum/);
    const tools = (req.body.tools as { function: { name: string; parameters?: { properties?: Record<string, { default?: unknown }> } } }[]);
    expect(tools.map((t) => t.function.name)).toEqual(["serv_prompt_guard", "serv_shadow_agent"]);
    expect(tools[1]!.function.parameters!.properties!.hint!.default).toMatch(/fact id/);
    expect(req.body.stream).toBeUndefined();
    expect(out.raw).toEqual({
      terms: { mode: "deposit", depositPct: 30 },
      reasons: [{ factIds: ["f_2"], text: "Accounts are 7 months overdue." }],
      confidence: "medium",
    });
    expect(out.usage).toEqual({ inputTokens: 1200, outputTokens: 300 });
    expect(out.costUsd).toBeGreaterThan(0);
  });

  it("returns the text as-is when the model did not answer in JSON", () => {
    expect(normalizeDecision("I cannot help with that")).toBe("I cannot help with that");
  });
});

describe("planLookups", () => {
  it("lets the model choose, then enforces essentials and the budget in code", async () => {
    const { client } = mockServ({ keys: ["fr.vendor_limit", "fr.filings", "fr.court"], why: "Large invoice." });
    const out = await planLookups(client, { menu: menuFor("FR"), amountEur: 800, budgetUsd: 0.05 });
    expect(out.keys).toEqual(["fr.profile", "fr.gazette", "fr.filings", "fr.court"]);
    expect(out.dropped).toEqual(["fr.vendor_limit"]);
    expect(out.why).toBe("Large invoice.");
  });
});

describe("pickCandidate", () => {
  const candidates = [
    { siren: "111111111", name: "ACME", active: true, confidence: 0.7, nameMatch: "partielle", city: "LYON", naf: "62.01Z", fullyPublic: true },
    { siren: "222222222", name: "ACME CONSEIL", active: true, confidence: 0.69, nameMatch: "partielle", city: "PARIS", naf: "70.22Z", fullyPublic: true },
  ];
  it("returns no pick when the model is unsure", async () => {
    const { client } = mockServ({ siren: "111111111", yesProb: 0.6 });
    expect(await pickCandidate(client, { query: "acme", candidates })).toMatchObject({ siren: null });
  });
  it("returns the pick when the model is confident and it is a real candidate", async () => {
    const { client } = mockServ({ siren: "222222222", yesProb: 0.93 });
    expect(await pickCandidate(client, { query: "acme conseil paris", candidates })).toMatchObject({ siren: "222222222" });
  });
  it("ignores a confident pick that is not among the candidates", async () => {
    const { client } = mockServ({ siren: "999999999", yesProb: 0.99 });
    expect(await pickCandidate(client, { query: "acme", candidates })).toMatchObject({ siren: null });
  });
});

describe("loadPolicy", () => {
  it("hashes the exact policy text", () => {
    expect(policy.id).toBe("freelancer");
    expect(policy.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(policy.text.length).toBeLessThan(1500);
  });
});
