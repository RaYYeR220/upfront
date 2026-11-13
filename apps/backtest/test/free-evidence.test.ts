import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeFloor } from "@upfront/core";
import { deriveFacts, filterAsOf } from "@upfront/sources";
import { describe, expect, it } from "vitest";
import { factsFromPublicRecords } from "../src/free-evidence.ts";

const history = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "bodacc-history-841936560.json"), "utf8")).results;
const register = {
  siren: "841936560",
  nom_complet: "KD SOCCER CONSULTING",
  nature_juridique: "5710",
  activite_principale: "70.22Z",
  date_creation: "2018-08-01",
  finances: { "2019": { ca: 0, resultat_net: -226 } },
};

describe("factsFromPublicRecords (KD SOCCER CONSULTING, real gazette history)", () => {
  const facts = factsFromPublicRecords("841936560", history, register);

  it("reads the accounts filing with its real filing date and the liquidation notice", () => {
    expect(facts.find((f) => f.kind === "accounts.filed")).toMatchObject({
      value: { closingDate: "2019-12-31", filedOn: "2021-01-06" },
      observedAt: "2021-01-06",
    });
    expect(facts.find((f) => f.kind === "bodacc.event")?.value).toMatchObject({
      category: "ouverture_liquidation",
      publishedOn: "2026-10-14",
      cessationDate: "2025-03-28",
    });
    expect(facts.find((f) => f.kind === "finance.year")?.value).toMatchObject({ closingDate: "2019-12-31", revenue: 0, netIncome: -226 });
  });

  it("on the day it stopped paying, sees four years of missing accounts and no open proceeding", () => {
    const T = "2025-03-28";
    const pit = filterAsOf(facts, T);
    const all = [...pit, ...deriveFacts(pit, T, { documentsFetched: true })];
    expect(all.some((f) => f.observedAt > T)).toBe(false);
    expect(computeFloor(all).floor).toBeNull();
    // FY2019 closed 2019-12-31, due by 2021-07-31; on 2025-03-28 that is 43 months late.
    expect(all.find((f) => f.kind === "accounts.overdue_months")?.value).toBe(43);
    expect(all.some((f) => f.kind === "finance.year")).toBe(true);
  });

  it("after the gazette notice, the liquidation sets the floor", () => {
    const T = "2026-11-12";
    const pit = filterAsOf(facts, T);
    expect(computeFloor([...pit, ...deriveFacts(pit, T)]).floor).toBe("decline");
  });
});
