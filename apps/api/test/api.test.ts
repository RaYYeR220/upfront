import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ServPort } from "@upfront/engine";
import { FakeKite, type FakeRoute } from "@upfront/kite";
import type { ReppoClient } from "@upfront/reppo";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
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
  [`${API}/entreprise/${S}/documents`]: { status: 200, body: fx("entreprise-siren-documents"), priceUsd: 0.02 },
};

const serv: ServPort = {
  plan: async () => ({ keys: ["fr.profile", "fr.gazette", "fr.filings"], dropped: [], why: "", costUsd: 0, model: "m" }),
  decide: async (a) => ({
    raw: { terms: { mode: "net", netDays: 30 }, reasons: [{ factIds: [a.facts[0]!.id], text: "Old company." }], confidence: "high" },
    costUsd: 0.001,
    ms: 1,
    model: "m",
  }),
  pick: async () => ({ siren: null, yesProb: 0, costUsd: 0, model: "m" }),
};

async function setup(opts: { reppo?: ReppoClient | null; capUsd?: number; perIp?: number } = {}) {
  const db = await openDb(":memory:");
  const hub = new Hub();
  const checks = new CheckService({
    db,
    hub,
    engine: { kite: new FakeKite(ROUTES), payer: { payer: "house", home: "/tmp" }, serv, reppo: opts.reppo ?? null, now: () => new Date() },
    limits: { checksPerIpPerDay: opts.perIp ?? 3, houseDailyCapUsd: opts.capUsd ?? 5 },
    salt: "s",
    review: { mode: "async", timeoutMs: 2000, pollMs: 5 },
  });
  const app = createApp({ db, hub, checks, corsOrigins: [], trustProxy: true });
  const post = (body: unknown, ip = "1.2.3.4") =>
    app.request("/api/checks", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "x-forwarded-for": ip } });
  return { app, checks, post, db };
}

const sseEvents = (text: string) => [...text.matchAll(/^event: (\w+)$/gm)].map((m) => m[1]);

describe("checks API", () => {
  it("starts a check, streams every step and stores the result", async () => {
    const { app, checks, post } = await setup();
    const r = await post({ query: S, amountEur: 2400 });
    expect(r.status).toBe(202);
    const { checkId } = (await r.json()) as { checkId: string };
    const stream = app.request(`/api/checks/${checkId}/stream`);
    await checks.wait(checkId);
    const events = sseEvents(await (await stream).text());
    expect(events.filter((e) => e === "node")).toHaveLength(8);
    expect(events.filter((e) => e === "receipt")).toHaveLength(3);
    expect(events).toContain("outcome");
    expect(events.at(-1)).toBe("end");
    const row = (await (await app.request(`/api/checks/${checkId}`)).json()) as { status: string; result: { final: unknown } };
    expect(row.status).toBe("done");
    expect(row.result.final).toEqual({ mode: "net", netDays: 30 });
    const meta = (await (await app.request("/api/meta")).json()) as { checks: number; lookups: number; evidenceUsd: number };
    expect(meta).toMatchObject({ checks: 1, lookups: 3 });
    expect(meta.evidenceUsd).toBeCloseTo(0.035, 6);
  });

  it("rejects bad input before spending anything", async () => {
    const { post } = await setup();
    expect((await post({ query: "x", amountEur: 100 })).status).toBe(400);
    expect((await post({ query: S, amountEur: -5 })).status).toBe(400);
    expect((await post({ query: S, amountEur: 100, policyId: "nope" })).status).toBe(404);
  });

  it("limits free checks per visitor per day", async () => {
    const { post, checks } = await setup({ perIp: 3 });
    for (let i = 0; i < 3; i++) {
      const r = await post({ query: S, amountEur: 500 });
      expect(r.status).toBe(202);
      await checks.wait(((await r.json()) as { checkId: string }).checkId);
    }
    const fourth = await post({ query: S, amountEur: 500 });
    expect(fourth.status).toBe(429);
    expect(await fourth.json()).toEqual({ error: "demo_quota" });
    expect((await post({ query: S, amountEur: 500 }, "5.6.7.8")).status).toBe(202);
    // A spoofed left-hand hop doesn't buy more free checks: the proxy's own hop counts.
    expect((await post({ query: S, amountEur: 500 }, "9.9.9.9, 1.2.3.4")).status).toBe(429);
  });

  it("stops paying for demo checks once the daily house budget is spent", async () => {
    const { post, checks } = await setup({ capUsd: 0.09, perIp: 100 });
    const first = await post({ query: S, amountEur: 500 });
    await checks.wait(((await first.json()) as { checkId: string }).checkId);
    const second = await post({ query: S, amountEur: 500 });
    expect(second.status).toBe(503);
    expect(await second.json()).toEqual({ error: "house_budget" });
  });

  it("applies an independent review that lands after the check", async () => {
    let polls = 0;
    const reppo: ReppoClient = {
      submit: async () => ({ id: "ev_9" }),
      get: async () =>
        ++polls < 3
          ? { status: "pending", evalId: "ev_9" }
          : { status: "done", evalId: "ev_9", score: 28, route: "block", reason: "Too generous.", creditsCharged: 440 },
    };
    const { app, checks, post } = await setup({ reppo });
    const { checkId } = (await (await post({ query: S, amountEur: 2400 })).json()) as { checkId: string };
    const stream = app.request(`/api/checks/${checkId}/stream`);
    await checks.wait(checkId);
    const text = await (await stream).text();
    expect(sseEvents(text)).toContain("review");
    const row = (await (await app.request(`/api/checks/${checkId}`)).json()) as {
      result: { final: unknown; reviewed: boolean; review: { route: string }; costs: { reviewUsd: number } };
    };
    expect(row.result.review.route).toBe("block");
    expect(row.result.reviewed).toBe(true);
    expect(row.result.final).toEqual({ mode: "deposit", depositPct: 50 });
    expect(row.result.costs.reviewUsd).toBeCloseTo(0.22, 6);
  });

  it("versions a custom policy", async () => {
    const { app } = await setup();
    const text = "Default: Net 15 for everyone. Deposit 40% when accounts are late.";
    const created = (await (
      await app.request("/api/policies", { method: "POST", body: JSON.stringify({ name: "Mine", text }), headers: { "content-type": "application/json" } })
    ).json()) as { id: string; version: number; hash: string; editToken: string };
    expect(created.version).toBe(1);
    const body = JSON.stringify({ name: "Mine", text: `${text} Prepay above 20,000 EUR.` });
    const denied = await app.request(`/api/policies/${created.id}/versions`, {
      method: "POST",
      body,
      headers: { "content-type": "application/json", "x-policy-token": "wrong" },
    });
    expect(denied.status).toBe(403);
    const v2 = (await (
      await app.request(`/api/policies/${created.id}/versions`, {
        method: "POST",
        body,
        headers: { "content-type": "application/json", "x-policy-token": created.editToken },
      })
    ).json()) as { version: number; hash: string };
    expect(v2.version).toBe(2);
    expect(v2.hash).not.toBe(created.hash);
  });
});
