import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ServPort } from "@upfront/engine";
import { FakeKite, type FakeRoute } from "@upfront/kite";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { registerAgentRoutes } from "../src/agents.ts";
import { openDb } from "../src/db.ts";
import { Hub } from "../src/hub.ts";
import { CheckService } from "../src/service.ts";

const fx = (n: string): unknown =>
  JSON.parse(readFileSync(join(import.meta.dirname, "../../../packages/sources/test/fixtures/sirenic", `${n}.json`), "utf8"));
const API = "https://api.sirenic.eu/v1";
const S = "552032534";
const ROUTES: Record<string, FakeRoute> = {
  [`${API}/entreprise/${S}`]: { status: 200, body: fx("entreprise-siren"), priceUsd: 0.005 },
  [`${API}/entreprise/${S}/alertes`]: { status: 200, body: { procedures_collectives: [] }, priceUsd: 0.01 },
};
const serv: ServPort = {
  plan: async () => ({ keys: ["fr.profile", "fr.gazette"], dropped: [], why: "", costUsd: 0, model: "m" }),
  decide: async (a) => ({
    raw: { terms: { mode: "net", netDays: 30 }, reasons: [{ factIds: [a.facts[0]!.id], text: "Old company." }], confidence: "high" },
    costUsd: 0,
    ms: 1,
    model: "m",
  }),
  pick: async () => ({ siren: null, yesProb: 0, costUsd: 0, model: "m" }),
};

async function setup() {
  const db = await openDb(":memory:");
  const checks = new CheckService({
    db,
    hub: new Hub(),
    engine: { kite: new FakeKite(ROUTES), payer: { payer: "house", home: "/tmp" }, serv, reppo: null, now: () => new Date() },
    limits: { checksPerIpPerDay: 3, houseDailyCapUsd: 5 },
    salt: "s",
    review: { mode: "skip", timeoutMs: 1000, pollMs: 5 },
  });
  const app = new Hono();
  registerAgentRoutes(app, {
    db,
    checks,
    payTo: "0x1111111111111111111111111111111111111111",
    webUrl: "https://upfront.example",
    facilitator: {
      getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:8453" }], extensions: [], signers: {} }),
      verify: async () => ({ isValid: false, invalidReason: "test" }),
      settle: async () => ({ success: false, transaction: "", network: "eip155:8453", errorReason: "test" }),
    },
  });
  return app;
}

describe("x402 endpoint", () => {
  it("quotes 0.50 USDC on Base before running a check", async () => {
    const app = await setup();
    const r = await app.request(`/v1/check?siren=${S}&amount=2400`);
    expect(r.status).toBe(402);
    const header = r.headers.get("payment-required");
    expect(header).toBeTruthy();
    const req = JSON.parse(Buffer.from(header!, "base64").toString("utf8")) as {
      accepts: { network: string; amount: string; payTo: string; asset: string }[];
    };
    expect(req.accepts[0]).toMatchObject({
      network: "eip155:8453",
      amount: "500000",
      payTo: "0x1111111111111111111111111111111111111111",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    });
  });

  it("rejects a malformed request without quoting a price", async () => {
    const app = await setup();
    const r = await app.request("/v1/check?siren=12&amount=2400");
    expect(r.status).toBe(400);
    expect(r.headers.get("payment-required")).toBeNull();
    // Above the paid cap the evidence budget would exceed the price: refused before quoting.
    expect((await app.request(`/v1/check?siren=${S}&amount=50000`)).status).toBe(400);
  });
});

describe("MCP server", () => {
  const rpc = (app: Hono, body: unknown) =>
    app.request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify(body),
    });
  const parse = async (r: Response) => {
    const text = await r.text();
    const data = text.startsWith("{") ? text : (/^data: (.*)$/m.exec(text)?.[1] ?? "{}");
    return JSON.parse(data) as { result?: { tools?: { name: string }[]; content?: { text: string }[] } };
  };

  it("lists the tools and runs a check", async () => {
    const app = await setup();
    await rpc(app, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    const list = await parse(await rpc(app, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }));
    expect(list.result?.tools?.map((t) => t.name).sort()).toEqual(["check_client", "get_check"]);
    const call = await parse(
      await rpc(app, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "check_client", arguments: { query: S, amount_eur: 2400 } } }),
    );
    const out = JSON.parse(call.result!.content![0]!.text) as { terms: unknown; company: { name: string }; reasons: { evidence: { paidUsd: number }[] }[] };
    expect(out.terms).toEqual({ mode: "net", netDays: 30 });
    expect(out.company.name).toBe("DANONE");
    expect(out.reasons[0]!.evidence[0]!.paidUsd).toBe(0.005);
  });
});
