import type { Fact } from "@upfront/core";
import { menuFor } from "@upfront/sources";
import { describe, expect, it } from "vitest";
import { servClient } from "../src/client.ts";
import { COMPILE_SYSTEM, compilePolicy } from "../src/compile.ts";
import { decide, programCache } from "../src/decide.ts";
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

const program = {
  default: { mode: "net", netDays: 30, depositPct: null, creditLimitEur: null },
  creditLimitIsInvoice: true,
  maxNetDays: 45,
  rules: [
    {
      id: "late_accounts",
      when: { all: [{ signal: "accounts_overdue_months", op: ">=", value: 6 }], any: [], atLeast: null },
      then: { mode: "deposit", netDays: null, depositPct: 30, creditLimitEur: null },
      why: "Ask a 30% deposit when accounts are 6+ months overdue",
    },
  ],
  untranslated: [],
  expected: [],
};

describe("compilePolicy", () => {
  it("sends the policy to SERV with a fixed system prompt, a strict schema and Prompt Guard", async () => {
    const { client, calls } = mockServ(program);
    const out = await compilePolicy(client, policy);
    const req = calls[0]!;
    expect(req.url).toBe("https://inference-api.openserv.ai/v1/chat/completions");
    const messages = req.body.messages as { role: string; content: string }[];
    expect(messages[0]).toEqual({ role: "system", content: COMPILE_SYSTEM });
    expect(messages[1]!.content).toContain(policy.text);
    expect((req.body.response_format as { json_schema: { strict: boolean } }).json_schema.strict).toBe(true);
    expect((req.body.tools as { function: { name: string } }[]).map((t) => t.function.name)).toEqual(["serv_prompt_guard"]);
    expect(req.body.max_completion_tokens).toBeGreaterThan(0);
    expect(out.program.rules.map((r) => r.id)).toEqual(["late_accounts"]);
    expect(calls).toHaveLength(1);
  });

  it("sends a program that asks a healthy client for a deposit back with the reason", async () => {
    const bad = { ...program, rules: [{ ...program.rules[0]!, id: "always", when: { all: [{ signal: "invoice_eur", op: ">", value: 0 }], any: [], atLeast: null } }] };
    const { client, calls } = mockServ(bad);
    await expect(compilePolicy(client, policy)).rejects.toThrow(/no valid program/);
    expect(calls).toHaveLength(3);
    const retry = (calls[1]!.body.messages as { content: string }[])[1]!.content;
    expect(retry).toMatch(/always fires for every client/);
  });
});

describe("decide", () => {
  it("applies the compiled program to the facts and reports which rules fired", async () => {
    const { client, calls } = mockServ(program);
    const programs = programCache(client);
    const a = { policy: { ...policy, hash: "h-test" }, facts, floor: { floor: null, because: [], notes: [] }, amountEur: 3200, today: "2026-11-12" };
    const first = await decide(programs, a);
    const second = await decide(programs, a);
    expect(calls).toHaveLength(1);
    expect(first.raw).toMatchObject({ terms: { mode: "deposit", depositPct: 30 }, reasons: [{ factIds: ["f_2"] }], program: { fired: ["late_accounts"], cached: false } });
    expect(second.costUsd).toBe(first.costUsd);
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
