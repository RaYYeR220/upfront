import type { Fact, FactKind } from "@upfront/core";
import { categoryFromNature } from "@upfront/sources";
import { type BodaccRecord, parseCessationDate } from "./bodacc.ts";
import { getJson } from "./http.ts";

/**
 * Evidence for the backtest from free public sources only: the official gazette
 * (BODACC, every notice about the company, each with its publication date) and
 * the national company register (recherche-entreprises). It produces the same
 * kinds of facts the paid lookups do, so the same floors, policy and decision
 * step run on it. Anyone can re-run it without paying for a single record.
 */

const BODACC = "https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records";
const REGISTER = "https://recherche-entreprises.api.gouv.fr/search";

type Raw = BodaccRecord & { depot?: string | null; familleavis?: string | null; dateparution: string };

export interface RegisterEntry {
  siren: string;
  nom_complet?: string | null;
  nature_juridique?: string | null;
  activite_principale?: string | null;
  date_creation?: string | null;
  finances?: Record<string, { ca?: number | null; resultat_net?: number | null }> | null;
}

function parseJson<T>(s: unknown): T | null {
  if (!s) return null;
  if (typeof s === "object") return s as T;
  try {
    return JSON.parse(String(s)) as T;
  } catch {
    return null;
  }
}

/** Turns a company's gazette notices and register entry into facts (before any point-in-time filtering). */
export function factsFromPublicRecords(siren: string, notices: Raw[], register: RegisterEntry | null): Fact[] {
  const out: Fact[] = [];
  let i = 0;
  const add = (kind: FactKind, value: unknown, observedAt: string, source: string) =>
    out.push({ id: `pub#${i++}`, kind, value, observedAt, source, receiptId: null });

  if (register) {
    const created = register.date_creation ?? null;
    if (register.nom_complet) add("identity.name", register.nom_complet, created ?? "1900-01-01", "register");
    if (register.nature_juridique) add("identity.legal_form", register.nature_juridique, created ?? "1900-01-01", "register");
    if (created) add("identity.created_on", created, created, "register");
    if (register.activite_principale) add("identity.naf", register.activite_principale, created ?? "1900-01-01", "register");
  }

  const closings = new Map<string, string>(); // year -> closing date from a filing notice
  for (const n of [...notices].sort((a, b) => a.dateparution.localeCompare(b.dateparution))) {
    const published = n.dateparution;
    switch (n.familleavis) {
      case "dpc": {
        const d = parseJson<{ dateCloture?: string; typeDepot?: string }>(n.depot);
        if (d?.dateCloture) {
          add("accounts.filed", { closingDate: d.dateCloture, filedOn: published }, published, "gazette");
          closings.set(d.dateCloture.slice(0, 4), d.dateCloture);
        }
        break;
      }
      case "collective": {
        const j = parseJson<{ nature?: string; date?: string; complementJugement?: string; famille?: string }>(n.jugement);
        if (!j) break;
        add(
          "bodacc.event",
          {
            family: "procedure",
            category: categoryFromNature(j.nature ?? j.famille ?? ""),
            nature: j.nature ?? null,
            judgmentDate: j.date ?? null,
            publishedOn: published,
            cessationDate: j.complementJugement ? parseCessationDate(j.complementJugement) : null,
            court: n.tribunal ?? null,
          },
          published,
          "gazette",
        );
        break;
      }
      case "radiation":
        // Read by deriveFacts: a closure only if nothing follows it.
        add("bodacc.event", { family: "radiation", publishedOn: published }, published, "gazette");
        break;
      case "vente":
        add("bodacc.event", { family: "sale", publishedOn: published }, published, "gazette");
        break;
      case "modification":
        add("bodacc.event", { family: "change", publishedOn: published }, published, "gazette");
        break;
      case "conciliation":
        add("bodacc.event", { family: "conciliation", publishedOn: published }, published, "gazette");
        break;
      default:
        break;
    }
  }

  // Filed figures: a year's numbers become public with that year's filing notice (point-in-time filtering checks this).
  for (const [year, f] of Object.entries(register?.finances ?? {})) {
    const closingDate = closings.get(year) ?? `${year}-12-31`;
    add("finance.year", { closingDate, revenue: f.ca ?? null, netIncome: f.resultat_net ?? null }, closingDate, "register");
  }
  return out;
}

export async function fetchNotices(siren: string): Promise<Raw[]> {
  const all: Raw[] = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const url = `${BODACC}?${new URLSearchParams({ where: `registre like '${siren}'`, order_by: "dateparution", limit: "100", offset: String(offset) })}`;
    const page = await getJson<{ total_count: number; results: Raw[] }>(url, "bodacc-history");
    all.push(...page.results);
    if (all.length >= page.total_count || page.results.length < 100) break;
  }
  return all;
}

export async function fetchRegister(siren: string): Promise<RegisterEntry | null> {
  const url = `${REGISTER}?${new URLSearchParams({ q: siren, per_page: "5" })}`;
  const res = await getJson<{ results: RegisterEntry[] }>(url, "register-full");
  return res.results.find((r) => r.siren === siren) ?? null;
}

export async function publicFacts(siren: string): Promise<Fact[]> {
  const [notices, register] = await Promise.all([fetchNotices(siren), fetchRegister(siren)]);
  return factsFromPublicRecords(siren, notices, register);
}
