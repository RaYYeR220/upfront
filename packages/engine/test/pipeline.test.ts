import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Fact, Policy } from "@upfront/core";
import { FakeKite, type FakeRoute } from "@upfront/kite";
import type { ReppoClient, ReviewResult } from "@upfront/reppo";
import { describe, expect, it } from "vitest";
import { type CheckOutcome, type EngineDeps, type EngineEvent, runCheck, type ServPort } from "../src/pipeline.ts";

const fx = (n: string): unknown =>
  JSON.parse(readFileSync(join(import.meta.dirname, "../../sources/test/fixtures/sirenic", `${n}.json`), "utf8"));

const API = "https://api.sirenic.eu/v1";
const DANONE = "552032534";
const KD = "841936560";
const danoneProfile = fx("entreprise-siren");
const kdProfile = { ...(danoneProfile as object), siren: KD, denomination: "KD SOCCER CONSULTING", date_creation: "2018-07-01" };

function companyRoutes(siren: string, profile: unknown, alertes: unknown): Record<string, FakeRoute> {
  return {
    [`${API}/entreprise/${siren}`]: { status: 200, body: profile, priceUsd: 0.005 },
    [`${API}/entreprise/${siren}/alertes`]: { status: 200, body: alertes, priceUsd: 0.01 },
    [`${API}/entreprise/${siren}/documents`]: { status: 200, body: fx("entreprise-siren-documents"), priceUsd: 0.02 },
    [`${API}/entreprise/${siren}/finances`]: { status: 200, body: fx("entreprise-siren-finances"), priceUsd: 0.01 },
    [`${API}/entreprise/${siren}/contentieux`]: { status: 200, body: fx("entreprise-siren-contentieux"), priceUsd: 0.01 },
  };
}
const ROUTES: Record<string, FakeRoute> = {
  ...companyRoutes(DANONE, danoneProfile, { procedures_collectives: [] }),
  ...companyRoutes(KD, kdProfile, fx("entreprise-siren-alertes")),
};

const policy: Policy = { id: "freelancer", name: "Freelancer", version: 1, text: "Default: Net 30.", hash: "h1" };

type DecideImpl = (facts: Fact[]) => unknown;
function servStub(decideImpl: DecideImpl, pick: { siren: string | null; yesProb: number } = { siren: null, yesProb: 0 }) {
  const seen: { decideFacts?: Fact[] } = {};
  const port: ServPort = {
    async plan() {
      return {
        keys: ["fr.profile", "fr.gazette", "fr.filings", "fr.finances", "fr.court"],
        dropped: [],
        why: "standard",
        costUsd: 0.0001,
        model: "plan-model",
      };
    },
    async decide(a) {
      seen.decideFacts = a.facts;
      return { raw: decideImpl(a.facts), costUsd: 0.002, ms: 5, model: "decide-model" };
    },
    async pick() {
      return { ...pick, costUsd: 0.0001, model: "pick-model" };
    },
  };
  return { port, seen };
}

const netFromFirstFact: DecideImpl = (facts) => ({
  terms: { mode: "net", netDays: 30, creditLimitEur: 3200 },
  reasons: [{ factIds: [facts[0]!.id], text: "Long-established company." }],
  confidence: "high",
});

function reppoStub(result: ReviewResult): ReppoClient {
  return { submit: async () => ({ id: "ev_1" }), get: async () => result };
}

function deps(over: Partial<EngineDeps> & { serv: ServPort }): { d: EngineDeps; events: EngineEvent[] } {
  const events: EngineEvent[] = [];
  return {
    events,
    d: {
      kite: new FakeKite(ROUTES),
      payer: { payer: "house", home: "/tmp/house" },
      reppo: null,
      now: () => new Date("2026-11-12T10:00:00Z"),
      emit: (e) => events.push(e),
      ...over,
    },
  };
}

const done = (o: CheckOutcome) => {
  if (o.kind !== "done") throw new Error(`expected done, got ${o.kind}`);
  return o.result;
};

describe("runCheck", () => {
  it("runs all eight steps for a healthy company and prices every lookup", async () => {
    const { port } = servStub(netFromFirstFact);
    const { d, events } = deps({ serv: port });
    const r = done(await runCheck({ query: DANONE, amountEur: 3200, policy, review: "skip" }, d));
    expect(r.nodes.map((n) => n.name)).toEqual(["resolve", "plan", "buy", "extract", "floors", "decide", "review", "issue"]);
    expect(r.nodes.find((n) => n.name === "review")?.status).toBe("skipped");
    expect(r.final).toEqual({ mode: "net", netDays: 30, creditLimitEur: 3200 });
    expect(r.entity).toEqual({ jurisdiction: "FR", id: DANONE, name: "DANONE" });
    expect(r.receipts.filter((x) => x.status === "settled")).toHaveLength(5);
    expect(r.costs.evidenceUsd).toBeCloseTo(0.055, 6);
    expect(r.facts.every((f) => /^f_\d+$/.test(f.id))).toBe(true);
    expect(events.filter((e) => e.type === "receipt")).toHaveLength(5);
    expect(r.issue.summary).toMatch(/30 days/);
  });

  it("lets the hard-fact floor override a model that offers credit to a company in liquidation", async () => {
    const { port } = servStub(netFromFirstFact);
    const { d } = deps({ serv: port });
    const r = done(await runCheck({ query: KD, amountEur: 6800, policy, review: "skip" }, d));
    expect(r.floor.floor).toBe("decline");
    // The policy's own rules gave credit; the hard rule lifts the decision to the floor and cites the fact.
    expect(r.proposed?.terms).toEqual({ mode: "decline" });
    expect(r.final).toEqual({ mode: "decline" });
    expect(r.finalReasons[0]!.text).toMatch(/Hard rule: a liquidation is open/);
    expect(r.finalReasons[0]!.factIds).toEqual(r.floor.because.map((b) => b.factId));
    expect(r.nodes.find((n) => n.name === "decide")?.status).toBe("ok");
    expect(r.notes.join(" ")).toMatch(/claim/i);
  });

  it("asks the user to choose when the name matches several companies", async () => {
    const { port } = servStub(netFromFirstFact, { siren: null, yesProb: 0.55 });
    const kite = new FakeKite({
      ...ROUTES,
      [`${API}/recherche?q=acme`]: {
        status: 200,
        priceUsd: 0.002,
        body: {
          resultats: [
            { siren: "111111111", denomination: "ACME", etat_administratif: "actif", score_confiance: 0.7, correspondance_nom: "partielle", commune_siege: "LYON", statut_diffusion: "totale" },
            { siren: "222222222", denomination: "ACME CONSEIL", etat_administratif: "actif", score_confiance: 0.69, correspondance_nom: "partielle", commune_siege: "PARIS", statut_diffusion: "totale" },
          ],
        },
      },
    });
    const { d } = deps({ serv: port, kite });
    const o = await runCheck({ query: "acme", amountEur: 1000, policy, review: "skip" }, d);
    expect(o.kind).toBe("needs_choice");
    if (o.kind === "needs_choice") expect(o.candidates.map((c) => c.siren)).toEqual(["111111111", "222222222"]);
  });

  it("finishes on partial evidence when the spending limit runs out, and says so", async () => {
    const { port } = servStub(netFromFirstFact);
    const { d } = deps({ serv: port, kite: new FakeKite(ROUTES, { totalCapUsd: 0.02 }) });
    const r = done(await runCheck({ query: DANONE, amountEur: 50000, policy, review: "skip" }, d));
    const refused = r.receipts.filter((x) => x.status === "refused");
    expect(refused.length).toBeGreaterThan(0);
    expect(refused[0]!.refusalCode).toBe("session_total_exceeded");
    expect(r.decisionConfidence).toBe("medium");
    expect(r.notes.join(" ")).toMatch(/spending limit/);
  });

  it("falls back to a deposit when the model's decision fails validation", async () => {
    const { port } = servStub(() => ({
      terms: { mode: "net", netDays: 60 },
      reasons: [{ factIds: ["f_999"], text: "Made up." }],
      confidence: "high",
    }));
    const { d } = deps({ serv: port });
    const r = done(await runCheck({ query: DANONE, amountEur: 3200, policy, review: "skip" }, d));
    expect(r.proposed).toBeNull();
    expect(r.final).toEqual({ mode: "deposit", depositPct: 50 });
    expect(r.finalReasons[0]!.text).toMatch(/failed validation/);
  });

  it("falls back to a deposit when the reasoning call itself fails", async () => {
    const { port } = servStub(() => {
      throw new Error("502 shadow agent aborted");
    });
    const { d } = deps({ serv: port });
    const r = done(await runCheck({ query: DANONE, amountEur: 3200, policy, review: "skip" }, d));
    expect(r.final).toEqual({ mode: "deposit", depositPct: 50 });
  });

  it("tightens the terms one notch when the independent reviewer blocks them", async () => {
    const { port } = servStub(netFromFirstFact);
    const { d } = deps({
      serv: port,
      reppo: reppoStub({ status: "done", evalId: "ev_1", score: 31, route: "block", reason: "Overdue accounts ignored." }),
    });
    const r = done(await runCheck({ query: DANONE, amountEur: 3200, policy, review: "await", reviewTimeoutMs: 1000 }, d));
    expect(r.review).toMatchObject({ status: "done", route: "block" });
    expect(r.final).toEqual({ mode: "deposit", depositPct: 50 });
    expect(r.finalReasons.at(-1)!.text).toMatch(/Overdue accounts ignored/);
  });

  it("keeps a timed-out review visibly unreviewed", async () => {
    const { port } = servStub(netFromFirstFact);
    const { d } = deps({ serv: port, reppo: reppoStub({ status: "pending", evalId: "ev_1" }) });
    const r = done(
      await runCheck({ query: DANONE, amountEur: 3200, policy, review: "await", reviewTimeoutMs: 30, reviewPollMs: 5 }, d),
    );
    expect(r.review).toMatchObject({ status: "failed", reason: "timeout" });
    expect(r.final).toEqual({ mode: "net", netDays: 30, creditLimitEur: 3200 });
    expect(r.reviewed).toBe(false);
  });

  it("only shows the model what was public on the as-of date", async () => {
    const { port, seen } = servStub(netFromFirstFact);
    const { d } = deps({ serv: port });
    const r = done(await runCheck({ query: KD, amountEur: 6800, policy, review: "skip", asOf: "2026-01-01" }, d));
    expect(r.floor.floor).toBeNull();
    expect(seen.decideFacts!.some((f) => f.observedAt > "2026-01-01")).toBe(false);
    expect(seen.decideFacts!.some((f) => f.kind === "status.active")).toBe(false);
  });

  it("refuses to check an individual and spends nothing", async () => {
    const { port } = servStub(netFromFirstFact);
    const kite = new FakeKite({
      [`${API}/entreprise/123456789`]: { status: 404, body: { erreur: "non_diffusible", regle: "R1" }, priceUsd: 0.005 },
    });
    const { d } = deps({ serv: port, kite });
    const o = await runCheck({ query: "123456789", amountEur: 500, policy, review: "skip" }, d);
    expect(o.kind).toBe("cannot_check_individual");
    expect(kite.calls).toHaveLength(1);
  });

  it("buys nothing else when the registry profile cannot be bought", async () => {
    const { port } = servStub(netFromFirstFact);
    const kite = new FakeKite({ ...ROUTES, [`${API}/entreprise/${DANONE}`]: { refuse: "wallet_empty" } });
    const { d } = deps({ serv: port, kite });
    const o = await runCheck({ query: DANONE, amountEur: 500, policy, review: "skip" }, d);
    expect(o).toMatchObject({ kind: "unavailable", reason: "wallet_empty" });
    expect(kite.calls).toHaveLength(1);
  });

  it("stops at a sole trader's profile even when it is served", async () => {
    const { port } = servStub(netFromFirstFact);
    const kite = new FakeKite({
      ...ROUTES,
      [`${API}/entreprise/${DANONE}`]: { status: 200, body: { ...(danoneProfile as object), nature_juridique: "1000" }, priceUsd: 0.005 },
    });
    const { d } = deps({ serv: port, kite });
    expect((await runCheck({ query: DANONE, amountEur: 500, policy, review: "skip" }, d)).kind).toBe("cannot_check_individual");
    expect(kite.calls).toHaveLength(1);
  });

  it("stops on a registry server error without buying more", async () => {
    const { port } = servStub(netFromFirstFact);
    const kite = new FakeKite({ ...ROUTES, [`${API}/entreprise/${DANONE}`]: { status: 503, body: { erreur: "amont" }, priceUsd: 0.005 } });
    const { d } = deps({ serv: port, kite });
    expect((await runCheck({ query: DANONE, amountEur: 500, policy, review: "skip" }, d)).kind).toBe("unavailable");
    expect(kite.calls).toHaveLength(1);
  });

  it("accepts a VAT number or a SIRET as the client", async () => {
    const { port } = servStub(netFromFirstFact);
    const { d } = deps({ serv: port });
    expect(done(await runCheck({ query: "FR27 552 032 534", amountEur: 900, policy, review: "skip" }, d)).entity.id).toBe(DANONE);
    expect(done(await runCheck({ query: "552 032 534 00703", amountEur: 900, policy, review: "skip" }, d)).entity.id).toBe(DANONE);
  });
});
