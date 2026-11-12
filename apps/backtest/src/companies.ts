import { getJson, HttpError } from "./http.ts";

const API = "https://recherche-entreprises.api.gouv.fr/search";
/** The API refuses page * per_page > 10 000. */
export const MAX_PAGES = 400;
const PER_PAGE = 25;

export type CompanyProfile = {
  siren: string;
  /** INSEE "catégorie juridique", e.g. 5710 = SAS, 5499 = SARL, 1000 = sole trader. */
  natureJuridique: string | null;
  /** NAF/APE code, e.g. "62.01Z". */
  naf: string | null;
  /** NAF section letter, e.g. "J". */
  nafSection: string | null;
  createdOn: string | null;
  /** "A" active, "C" ceased, as of today. */
  state: "A" | "C" | null;
};

type RawCompany = {
  siren: string;
  nature_juridique?: string | null;
  activite_principale?: string | null;
  section_activite_principale?: string | null;
  date_creation?: string | null;
  etat_administratif?: string | null;
};

type SearchResponse = {
  results: RawCompany[];
  total_results: number;
  total_pages: number;
};

export function toProfile(raw: RawCompany): CompanyProfile {
  const state = raw.etat_administratif;
  return {
    siren: raw.siren,
    natureJuridique: raw.nature_juridique ?? null,
    naf: raw.activite_principale ?? null,
    nafSection: raw.section_activite_principale ?? null,
    createdOn: raw.date_creation ?? null,
    state: state === "A" || state === "C" ? state : null,
  };
}

/** Sole traders (entrepreneurs individuels) are the whole 1xxx block of the INSEE legal categories. */
export function isLegalPerson(profile: Pick<CompanyProfile, "natureJuridique">): boolean {
  return !!profile.natureJuridique && !profile.natureJuridique.startsWith("1");
}

/** Look a company up by SIREN. Returns null when the registry does not know it. */
export async function lookupCompany(siren: string): Promise<CompanyProfile | null> {
  const url = `${API}?${new URLSearchParams({ q: siren, minimal: "true", per_page: "5" })}`;
  const res = await getJson<SearchResponse>(url, "recherche-entreprises");
  const hit = res.results.find((r) => r.siren === siren);
  return hit ? toProfile(hit) : null;
}

export type SearchFilters = {
  /** NAF section letter. */
  section: string;
  natureJuridique?: string;
  department?: string;
};

/** One page of active companies matching the filters. */
export async function searchActiveCompanies(
  filters: SearchFilters,
  page: number,
): Promise<{ totalPages: number; results: CompanyProfile[] }> {
  const params = new URLSearchParams({
    section_activite_principale: filters.section,
    etat_administratif: "A",
    minimal: "true",
    per_page: String(PER_PAGE),
    page: String(page),
  });
  if (filters.natureJuridique) params.set("nature_juridique", filters.natureJuridique);
  if (filters.department) params.set("departement", filters.department);
  try {
    const res = await getJson<SearchResponse>(`${API}?${params}`, "recherche-entreprises");
    return { totalPages: Math.min(res.total_pages, MAX_PAGES), results: res.results.map(toProfile) };
  } catch (error) {
    // A filter value the API does not accept (some overseas department codes) means no match
    // at this tier, not a failed run.
    if (error instanceof HttpError && error.status === 400) return { totalPages: 0, results: [] };
    throw error;
  }
}
