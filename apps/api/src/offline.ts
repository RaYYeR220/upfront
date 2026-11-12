import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeFloor, floorDefault } from "@upfront/core";
import type { EngineDeps, ServPort } from "@upfront/engine";
import { FakeKite, type FakeRoute } from "@upfront/kite";

/**
 * Local development only: Kite answers from recorded Sirenic responses and the
 * decision is a fixed rule, so the web app can be built without keys or money.
 * Refuses to start in production.
 */
export function offlineEngine(): Omit<EngineDeps, "emit"> {
  if (process.env.NODE_ENV === "production") throw new Error("Offline mode is for local development only");
  const dir = join(import.meta.dirname, "../../../packages/sources/test/fixtures/sirenic");
  const fx = (n: string): unknown => JSON.parse(readFileSync(join(dir, `${n}.json`), "utf8"));
  const api = "https://api.sirenic.eu/v1";
  const company = (siren: string, profile: unknown, alertes: unknown): Record<string, FakeRoute> => ({
    [`${api}/entreprise/${siren}`]: { status: 200, body: profile, priceUsd: 0.005 },
    [`${api}/entreprise/${siren}/alertes`]: { status: 200, body: alertes, priceUsd: 0.01 },
    [`${api}/entreprise/${siren}/documents`]: { status: 200, body: fx("entreprise-siren-documents"), priceUsd: 0.02 },
    [`${api}/entreprise/${siren}/finances`]: { status: 200, body: fx("entreprise-siren-finances"), priceUsd: 0.01 },
    [`${api}/entreprise/${siren}/contentieux`]: { status: 200, body: fx("entreprise-siren-contentieux"), priceUsd: 0.01 },
    [`${api}/entreprise/${siren}/encours?montant=4000&delai_jours=30`]: { status: 200, body: fx("entreprise-siren-encours"), priceUsd: 0.12 },
  });
  const danone = fx("entreprise-siren");
  const kd = { ...(danone as object), siren: "841936560", denomination: "KD SOCCER CONSULTING", date_creation: "2018-07-01" };
  const kite = new FakeKite({
    ...company("552032534", danone, { procedures_collectives: [] }),
    ...company("841936560", kd, fx("entreprise-siren-alertes")),
  });
  const serv: ServPort = {
    plan: async ({ menu }) => ({
      keys: menu.filter((m) => m.key !== "fr.vendor_limit").map((m) => m.key),
      dropped: ["fr.vendor_limit"],
      why: "offline: fixed plan",
      costUsd: 0,
      model: "offline",
    }),
    decide: async ({ facts }) => {
      const floor = computeFloor(facts);
      const terms = floor.floor ? floorDefault(floor.floor) : { mode: "net" as const, netDays: 30 };
      const cite = floor.because[0]?.factId ?? facts[0]?.id ?? "f_1";
      return {
        raw: { terms, reasons: [{ factIds: [cite], text: floor.floor ? "An insolvency proceeding is open." : "Established company with accounts on file." }], confidence: "medium" },
        costUsd: 0,
        ms: 1,
        model: "offline",
      };
    },
    pick: async () => ({ siren: null, yesProb: 0, costUsd: 0, model: "offline" }),
  };
  return { kite, payer: { payer: "house", home: "offline" }, serv, reppo: null, now: () => new Date() };
}
