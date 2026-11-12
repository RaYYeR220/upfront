import { describe, expect, it } from "vitest";
import { affordable, menuFor } from "../src/menu.ts";

describe("menuFor FR", () => {
  const menu = menuFor("FR");
  it("lists the French lookups with live prices", () => {
    expect(Object.fromEntries(menu.map((m) => [m.key, m.priceUsd]))).toEqual({
      "fr.profile": 0.005,
      "fr.gazette": 0.01,
      "fr.filings": 0.02,
      "fr.finances": 0.01,
      "fr.court": 0.01,
      "fr.vendor_limit": 0.12,
    });
    expect(menu.filter((m) => m.essential).map((m) => m.key)).toEqual(["fr.profile", "fr.gazette"]);
  });
  it("builds the paid URL for an entity", () => {
    const gazette = menu.find((m) => m.key === "fr.gazette")!;
    expect(gazette.url("841936560")).toBe("https://api.sirenic.eu/v1/entreprise/841936560/alertes");
    const limit = menu.find((m) => m.key === "fr.vendor_limit")!;
    expect(limit.url("552032534", { amountEur: 20000, netDays: 60 })).toBe(
      "https://api.sirenic.eu/v1/entreprise/552032534/encours?montant=20000&delai_jours=60",
    );
  });
});

describe("affordable", () => {
  const menu = menuFor("FR");
  const all = menu.map((m) => m.key);

  it("drops the most expensive optional lookups first until the budget fits", () => {
    expect(affordable(menu, all, 0.05)).toEqual({
      keys: ["fr.profile", "fr.gazette", "fr.finances", "fr.court"],
      dropped: ["fr.vendor_limit", "fr.filings"],
      totalUsd: 0.035,
    });
    expect(affordable(menu, all, 0.15).dropped).toEqual(["fr.vendor_limit"]);
    expect(affordable(menu, all, 0.3)).toMatchObject({ dropped: [], totalUsd: 0.175 });
  });

  it("always keeps essential lookups even when the planner left them out", () => {
    expect(affordable(menu, ["fr.court"], 0.05).keys).toEqual(["fr.profile", "fr.gazette", "fr.court"]);
  });

  it("ignores keys that are not on the menu", () => {
    expect(affordable(menu, ["fr.made_up"], 0.05).keys).toEqual(["fr.profile", "fr.gazette"]);
  });
});
