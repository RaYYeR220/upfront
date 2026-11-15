import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { EngineDeps, ServPort } from "@upfront/engine";
import { FakeKite, type FakeRoute } from "@upfront/kite";
import { decide, type ProgramCache, programCache } from "@upfront/serv";

/**
 * Local development only: Kite answers from recorded Sirenic responses and the
 * decision uses the committed compiled presets, so the web app can be built without keys or money.
 * Refuses to start in production.
 */
export function offlineEngine(): Omit<EngineDeps, "emit"> & { programs: ProgramCache } {
  if (process.env.NODE_ENV === "production") throw new Error("Offline mode is for local development only");
  const dir = join(import.meta.dirname, "../../../packages/sources/test/fixtures/sirenic");
  const fx = (n: string): unknown => JSON.parse(readFileSync(join(dir, `${n}.json`), "utf8"));
  const api = "https://api.sirenic.eu/v1";
  const programs = programCache(null);
  const danone: Record<string, FakeRoute> = {
    [`${api}/entreprise/552032534`]: { status: 200, body: fx("entreprise-siren"), priceUsd: 0.005 },
    [`${api}/entreprise/552032534/alertes`]: { status: 200, body: { procedures_collectives: [] }, priceUsd: 0.01 },
    [`${api}/entreprise/552032534/documents`]: { status: 200, body: fx("entreprise-siren-documents"), priceUsd: 0.02 },
    [`${api}/entreprise/552032534/finances`]: { status: 200, body: fx("entreprise-siren-finances"), priceUsd: 0.01 },
    [`${api}/entreprise/552032534/contentieux`]: { status: 200, body: fx("entreprise-siren-contentieux"), priceUsd: 0.01 },
  };
  // KD SOCCER CONSULTING: registry fields from the public register (recherche-entreprises), the
  // gazette notice from Sirenic's published sample. Filing dates are not recorded offline.
  const kd: Record<string, FakeRoute> = {
    [`${api}/entreprise/841936560`]: {
      status: 200,
      priceUsd: 0.005,
      body: {
        siren: "841936560",
        denomination: "KD SOCCER CONSULTING",
        nature_juridique: "5710",
        activite_principale: "70.22Z",
        date_creation: "2018-08-01",
        etat_administratif: "actif",
        siege: { commune: "BUSSY-SAINT-GEORGES", code_postal: "77600" },
      },
    },
    [`${api}/entreprise/841936560/alertes`]: { status: 200, body: fx("entreprise-siren-alertes"), priceUsd: 0.01 },
    [`${api}/entreprise/841936560/finances`]: {
      status: 200,
      priceUsd: 0.01,
      body: { siren: "841936560", exercices: [{ date_cloture: "2019-12-31", chiffre_affaires: 0, resultat_net: -226 }] },
    },
    [`${api}/entreprise/841936560/contentieux`]: { status: 200, body: { decisions: [] }, priceUsd: 0.01 },
  };
  const kite = new FakeKite({ ...danone, ...kd });
  const serv: ServPort = {
    plan: async ({ menu }) => ({
      keys: menu.filter((m) => m.key !== "fr.vendor_limit").map((m) => m.key),
      dropped: ["fr.vendor_limit"],
      why: "offline: fixed plan",
      costUsd: 0,
      model: "offline",
    }),
    decide: (a) => decide(programs, a),
    pick: async () => ({ siren: null, yesProb: 0, costUsd: 0, model: "offline" }),
  };
  return { programs, kite, payer: { payer: "house", home: "offline" }, serv, reppo: null, now: () => new Date() };
}
