import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Fact } from "@upfront/core";
import { describe, expect, it } from "vitest";
import { deriveFacts } from "../src/derive.ts";
import { filterAsOf } from "../src/pit.ts";
import { parseCandidates, parseSirenic, sirenicUrl } from "../src/sirenic.ts";

const fx = (name: string): unknown =>
  JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "sirenic", `${name}.json`), "utf8"));
const ctx = { receiptId: "r_1", fetchedAt: "2026-11-12" };

describe("sirenicUrl", () => {
  it("builds route URLs", () => {
    expect(sirenicUrl("recherche", { q: "kd soccer" })).toBe("https://api.sirenic.eu/v1/recherche?q=kd+soccer");
    expect(sirenicUrl("entreprise", { siren: "552032534" })).toBe("https://api.sirenic.eu/v1/entreprise/552032534");
    expect(sirenicUrl("alertes", { siren: "841936560" })).toBe(
      "https://api.sirenic.eu/v1/entreprise/841936560/alertes",
    );
    expect(sirenicUrl("changements", { siren: "841936560", depuis: "2026-09-27" })).toBe(
      "https://api.sirenic.eu/v1/entreprise/841936560/changements?depuis=2026-09-27",
    );
    expect(sirenicUrl("encours", { siren: "552032534", montant: 20000, delai_jours: 60 })).toBe(
      "https://api.sirenic.eu/v1/entreprise/552032534/encours?montant=20000&delai_jours=60",
    );
  });
  it("refuses a malformed SIREN before any call", () => {
    expect(() => sirenicUrl("entreprise", { siren: "12345" })).toThrow(/SIREN/);
  });
});

describe("parseCandidates", () => {
  it("reads search results", () => {
    expect(parseCandidates(fx("recherche"))).toEqual([
      {
        siren: "552032534",
        name: "DANONE",
        active: true,
        confidence: 1,
        nameMatch: "exacte",
        city: "PARIS",
        naf: "70.10Z",
        fullyPublic: true,
      },
    ]);
  });
});

describe("parseSirenic", () => {
  it("turns a company profile into identity and status facts", () => {
    const facts = parseSirenic("entreprise", fx("entreprise-siren"), ctx);
    const byKind = Object.fromEntries(facts.map((f) => [f.kind, f]));
    expect(byKind["identity.name"]?.value).toBe("DANONE");
    expect(byKind["identity.created_on"]).toMatchObject({ value: "1955-01-01", observedAt: "1955-01-01" });
    expect(byKind["identity.naf"]?.value).toBe("70.10Z");
    expect(byKind["identity.vat"]?.value).toBe("FR27552032534");
    expect(byKind["status.active"]).toMatchObject({ value: true, observedAt: "2026-11-12", receiptId: "r_1" });
    expect(facts.every((f) => f.source === "sirenic/entreprise")).toBe(true);
  });

  it("turns insolvency notices into dated gazette events", () => {
    const [ev] = parseSirenic("alertes", fx("entreprise-siren-alertes"), ctx);
    expect(ev).toMatchObject({
      kind: "bodacc.event",
      observedAt: "2026-10-14",
      value: {
        family: "procedure",
        category: "ouverture_liquidation",
        judgmentDate: "2026-09-28",
        publishedOn: "2026-10-14",
        cessationDate: "2025-03-28",
        court: "Greffe du Tribunal de Commerce de Meaux",
        noticeId: "A202601971788",
      },
    });
  });

  it("reads the same events from the changes feed", () => {
    const [ev] = parseSirenic("changements", fx("entreprise-siren-changements"), ctx);
    expect(ev?.value).toMatchObject({ category: "ouverture_liquidation", publishedOn: "2026-10-14" });
  });

  it("dates filed accounts by their filing date", () => {
    const filed = parseSirenic("documents", fx("entreprise-siren-documents"), ctx);
    expect(filed).toEqual([
      expect.objectContaining({
        kind: "accounts.filed",
        observedAt: "2026-05-27",
        value: { closingDate: "2025-12-31", filedOn: "2026-05-27" },
      }),
    ]);
  });

  it("reads one finance fact per fiscal year", () => {
    const years = parseSirenic("finances", fx("entreprise-siren-finances"), ctx);
    expect(years[0]).toMatchObject({
      kind: "finance.year",
      value: { closingDate: "2017-12-31", revenue: 609000000, netIncome: 176000000, equityRatio: 40.738 },
    });
  });

  it("yields nothing for an empty court record", () => {
    expect(parseSirenic("contentieux", fx("entreprise-siren-contentieux"), ctx)).toEqual([]);
  });

  it("reads the vendor's indicative credit limit", () => {
    const [f] = parseSirenic("encours", fx("entreprise-siren-encours"), ctx);
    expect(f).toMatchObject({
      kind: "vendor.credit_limit",
      value: { amountEur: 300000, terms: "45_jours", riskClass: "sain" },
    });
  });
});

const ev = (id: string, category: string, publishedOn: string): Fact => ({
  id,
  kind: "bodacc.event",
  value: { family: "procedure", category, publishedOn, judgmentDate: publishedOn },
  observedAt: publishedOn,
  source: "sirenic/alertes",
  receiptId: "r_2",
});

describe("deriveFacts", () => {
  it("marks a proceeding open when its latest notice is an opening", () => {
    const out = deriveFacts([ev("a", "ouverture_redressement", "2026-03-01")], "2026-11-12");
    expect(out.find((f) => f.kind === "proceeding.open")?.value).toMatchObject({
      category: "ouverture_redressement",
    });
  });

  it("marks it past once a later notice closes it or adopts a plan", () => {
    const closed = deriveFacts(
      [ev("a", "ouverture_redressement", "2024-03-01"), ev("b", "plan_redressement", "2025-02-01")],
      "2026-11-12",
    );
    expect(closed.some((f) => f.kind === "proceeding.open")).toBe(false);
    expect(closed.some((f) => f.kind === "proceeding.past")).toBe(true);
  });

  it("counts months of overdue accounts from the latest filed closing", () => {
    const filed: Fact = {
      id: "d",
      kind: "accounts.filed",
      value: { closingDate: "2023-12-31", filedOn: "2024-06-30" },
      observedAt: "2024-06-30",
      source: "sirenic/documents",
      receiptId: "r_3",
    };
    // 2023-12-31 + 19 months = 2025-07-31; to 2026-11-12 is 15 months late.
    const overdue = deriveFacts([filed], "2026-11-12").find((f) => f.kind === "accounts.overdue_months");
    expect(overdue?.value).toBe(15);
    expect(deriveFacts([filed], "2025-05-01").find((f) => f.kind === "accounts.overdue_months")?.value).toBe(0);
  });

  it("tells accounts that were never filed apart from accounts that stopped", () => {
    const created: Fact = { id: "c", kind: "identity.created_on", value: "2020-01-01", observedAt: "2020-01-01", source: "s", receiptId: null };
    const out = deriveFacts([created], "2026-01-01", { documentsFetched: true });
    // First accounts due 31 months after creation (2022-08-01); 41 months before 2026-01-01.
    expect(out.find((f) => f.kind === "accounts.never_filed")?.value).toBe(41);
    expect(out.some((f) => f.kind === "accounts.overdue_months")).toBe(false);
  });

  it("says nothing about filing for a company whose first accounts are not due yet", () => {
    const created: Fact = { id: "c", kind: "identity.created_on", value: "2025-06-01", observedAt: "2025-06-01", source: "s", receiptId: null };
    const out = deriveFacts([created], "2026-11-12", { documentsFetched: true });
    expect(out.some((f) => f.kind === "accounts.never_filed" || f.kind === "accounts.overdue_months")).toBe(false);
  });

  it("reads a strike-off as a closure only while nothing follows it", () => {
    const strike: Fact = { id: "r", kind: "bodacc.event", value: { family: "radiation", publishedOn: "2010-03-09" }, observedAt: "2010-03-09", source: "gazette", receiptId: null };
    const later: Fact = { id: "a", kind: "accounts.filed", value: { closingDate: "2024-12-31", filedOn: "2025-05-20" }, observedAt: "2025-05-20", source: "gazette", receiptId: null };
    expect(deriveFacts([strike], "2011-01-01").find((f) => f.kind === "status.ceased_on")?.value).toBe("2010-03-09");
    // Filings after a strike-off: the company moved to another registry, it did not close.
    expect(deriveFacts([strike, later], "2025-12-15").some((f) => f.kind === "status.ceased_on")).toBe(false);
  });

  it("measures how late the most recent filing was", () => {
    const late: Fact = {
      id: "d2",
      kind: "accounts.filed",
      value: { closingDate: "2023-12-31", filedOn: "2025-04-06" },
      observedAt: "2025-04-06",
      source: "sirenic/documents",
      receiptId: null,
    };
    // Deadline 2024-07-31; filed 2025-04-06: 8 whole months late.
    expect(deriveFacts([late], "2025-12-17").find((f) => f.kind === "accounts.late_filing_months")?.value).toBe(8);
  });
});

describe("filterAsOf", () => {
  const base: Fact[] = [
    { id: "n", kind: "identity.name", value: "X", observedAt: "2026-11-12", source: "s", receiptId: null },
    { id: "s", kind: "status.active", value: true, observedAt: "2026-11-12", source: "s", receiptId: null },
    { id: "v", kind: "vendor.credit_limit", value: {}, observedAt: "2026-11-12", source: "s", receiptId: null },
    ev("early", "ouverture_sauvegarde", "2025-01-10"),
    ev("canary", "ouverture_liquidation", "2026-03-04"),
    {
      id: "acc",
      kind: "accounts.filed",
      value: { closingDate: "2024-12-31", filedOn: "2025-07-15" },
      observedAt: "2025-07-15",
      source: "s",
      receiptId: null,
    },
    {
      id: "fin24",
      kind: "finance.year",
      value: { closingDate: "2024-12-31" },
      observedAt: "2024-12-31",
      source: "s",
      receiptId: null,
    },
    {
      id: "fin25",
      kind: "finance.year",
      value: { closingDate: "2025-12-31" },
      observedAt: "2025-12-31",
      source: "s",
      receiptId: null,
    },
  ];

  it("drops anything published after the as-of date, including the canary", () => {
    const ids = filterAsOf(base, "2026-03-03").map((f) => f.id);
    expect(ids).toContain("early");
    expect(ids).not.toContain("canary");
  });

  it("drops current-state facts that would leak the present", () => {
    const ids = filterAsOf(base, "2026-03-03").map((f) => f.id);
    expect(ids).toContain("n");
    expect(ids).not.toContain("s");
    expect(ids).not.toContain("v");
  });

  it("keeps a fiscal year only if its accounts were filed by the as-of date", () => {
    const ids = filterAsOf(base, "2026-03-03").map((f) => f.id);
    expect(ids).toContain("fin24");
    expect(ids).not.toContain("fin25");
  });
});
