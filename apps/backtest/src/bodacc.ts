import { isoDate } from "./dates.ts";
import { getJson } from "./http.ts";

export type Nature = "liquidation" | "redressement" | "sauvegarde";
export const NATURES: readonly Nature[] = ["liquidation", "redressement", "sauvegarde"];

export type Judgment = {
  noticeId: string;
  siren: string;
  /** BODACC publication date: the first day a creditor could have read about it. */
  publishedOn: string;
  judgmentDate: string | null;
  nature: Nature;
  court: string | null;
  /** Date the court set for the cessation of payments, i.e. when the company actually stopped paying. */
  cessationDate: string | null;
  /** First practitioner named in the notice (liquidateur, mandataire judiciaire or administrateur). */
  liquidator: string | null;
  /** "pm" = legal person, "pp" = natural person (sole trader), from the notice itself. */
  personType: "pm" | "pp" | null;
  department: string | null;
  /** The free-text `complementJugement` the dates were read from. */
  raw: string;
};

/** Lowercase and strip diacritics so "Décembre", "decembre" and "DÉCEMBRE" look the same. */
function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const MONTHS: Record<string, number> = {
  janvier: 1,
  fevrier: 2,
  mars: 3,
  avril: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  aout: 8,
  septembre: 9,
  octobre: 10,
  novembre: 11,
  decembre: 12,
};

// Applied to folded text. Six groups: day/month-name/year, then day/month/year for numeric dates.
const TEXT_DATE = String.raw`(\d{1,2})\s*(?:er|°)?\s+(${Object.keys(MONTHS).join("|")})\s+(\d{4})`;
const NUM_DATE = String.raw`(\d{1,2})\s*[/.-]+\s*(\d{1,2})\s*[/.-]+\s*(\d{4}|\d{2})(?!\d)`;
const DATE = `(?:${TEXT_DATE}|${NUM_DATE})`;
const CESSATION = String.raw`cessation\s+des?\s+paiements?`;

const CESSATION_PATTERNS = [
  // "Et a fixé au 25/07/2026 la date de cessation des paiements"
  new RegExp(String.raw`fix\w*\s+(?:provisoirement\s+)?au\s+${DATE}\s+la\s+date\s+de\s+${CESSATION}`),
  // "constaté la cessation des paiements ... ; en a fixé provisoirement la date au 31 juillet 2025"
  new RegExp(String.raw`${CESSATION}[^0-9]{0,120}?fix\w*\s+(?:provisoirement\s+)?la\s+date\s+au\s+${DATE}`),
  // The common case: "date de cessation des paiements le 3 mars 2026", ": 12 Mai 2024",
  // "au 01/01/2026", "à la date du 16 septembre 2025", "fixée provisoirement : 10 octobre 2025".
  // No digits are allowed between the phrase and the date, so a blank date never borrows a
  // number from the practitioner's address further on.
  new RegExp(`${CESSATION}[^0-9]{0,60}?${DATE}`),
];

/**
 * Read the cessation-of-payments date out of a BODACC `complementJugement`.
 * Returns an ISO date, or null when the notice has none (safeguard openings never do) or it
 * is blank or not a real calendar date.
 */
export function parseCessationDate(complement: string): string | null {
  const text = fold(complement);
  for (const pattern of CESSATION_PATTERNS) {
    const m = pattern.exec(text);
    if (!m) continue;
    if (m[1] !== undefined) {
      return isoDate(Number(m[3]), MONTHS[m[2] as string] as number, Number(m[1]));
    }
    const yearText = m[6] as string;
    const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText);
    return isoDate(year, Number(m[5]), Number(m[4]));
  }
  return null;
}

const ROLE = String.raw`(?:liquidateur(?:\s+judiciaire)?|mandataire(?:\(s\))?\s+judiciaire(?:\(s\))?|mandataire\s+liquidateur|administrateur(?:\(s\))?(?:\s+judiciaire(?:\(s\))?)?|repr[ée]sentant\s+des\s+cr[ée]anciers)`;
// A name runs until the street number of the address, a semicolon or the end of the sentence.
const NAME_END = String.raw`(?=\s*,?\s*(?:\d|;|\.(?:\s|$)|$))`;
const NAME = `([^0-9;]{3,200}?)${NAME_END}`;

const LIQUIDATOR_PATTERNS = [
  // "désignant liquidateur X", "désignant : mandataire judiciaire X", "désignant en qualité de liquidateur X"
  new RegExp(
    String.raw`d[ée]signant\s*:?\s*(?:avec les pouvoirs\s*:?\s*,?\s*)?(?:en\s+qualit\S*\s+d[e'’]\s*)?${ROLE}\s*:?\s*${NAME}`,
    "i",
  ),
  new RegExp(String.raw`nommant\s+(?:en\s+qualit\S*\s+d[e'’]\s*)?${ROLE}\s*:?\s*${NAME}`, "i"),
  // "Liquidateur : X", "Mandataire judiciaire à la liquidation des entreprises : X"
  new RegExp(String.raw`${ROLE}[^:.]{0,70}:\s*${NAME}`, "i"),
  // "..., mandataire judiciaire SELARL X ..."
  new RegExp(
    String.raw`${ROLE}\s+((?:SELARLU?|SELAS|SELAFA|SCP|SAS|SARL|EURL|Ma[iî]tre|Me)\b[^0-9;]{0,200}?)${NAME_END}`,
    "i",
  ),
];

/** The first insolvency practitioner a notice names, or null. */
export function parseLiquidator(complement: string): string | null {
  for (const pattern of LIQUIDATOR_PATTERNS) {
    const m = pattern.exec(complement);
    if (!m?.[1]) continue;
    const name = m[1]
      .replace(/\s+/g, " ")
      .replace(/^(?:la|le|les|l['’])\s*/i, "")
      .replace(/[\s,:-]+$/, "")
      .replace(/\s+(?:CS|BP|TSA)$/i, "")
      .trim();
    if (name.length >= 3) return name.slice(0, 160);
  }
  return null;
}

/**
 * Map BODACC's `nature` to the three proceedings we track. Extensions (an existing proceeding
 * widened to another person), practitioner appointments and "other" openings are not a fresh
 * insolvency of the company named in the notice, so they map to null.
 */
export function parseNature(nature: string): Nature | null {
  const n = fold(nature);
  if (n.includes("extension")) return null;
  if (n.includes("liquidation judiciaire")) return "liquidation";
  if (n.includes("redressement judiciaire")) return "redressement";
  if (n.includes("sauvegarde")) return "sauvegarde";
  return null;
}

type RawJugement = {
  famille?: string;
  nature?: string;
  date?: string;
  complementJugement?: string;
};

export type SkipReason = "notInitial" | "notOpening" | "otherNature" | "noSiren" | "badJson";

function readPersonType(listepersonnes: string | null | undefined): "pm" | "pp" | null {
  if (!listepersonnes) return null;
  try {
    const parsed = JSON.parse(listepersonnes) as { personne?: unknown };
    const first = (Array.isArray(parsed.personne) ? parsed.personne[0] : parsed.personne) as
      | { typePersonne?: string }
      | undefined;
    const type = first?.typePersonne;
    return type === "pm" || type === "pp" ? type : null;
  } catch {
    return null;
  }
}

function classify(record: BodaccRecord): Judgment | SkipReason {
  // Corrections and annulments repeat or void an earlier notice; counting them would double up.
  if (record.typeavis && record.typeavis !== "annonce") return "notInitial";
  let jugement: RawJugement;
  try {
    jugement = JSON.parse(record.jugement ?? "") as RawJugement;
  } catch {
    return "badJson";
  }
  if (fold(jugement.famille ?? "").replace(/’/g, "'") !== "jugement d'ouverture") return "notOpening";
  const nature = parseNature(jugement.nature ?? "");
  if (!nature) return "otherNature";
  const siren = record.registre?.[0]?.replace(/\s/g, "");
  if (!siren || !/^\d{9}$/.test(siren)) return "noSiren";
  const raw = jugement.complementJugement ?? "";
  return {
    noticeId: record.id,
    siren,
    publishedOn: record.dateparution,
    judgmentDate: /^\d{4}-\d{2}-\d{2}$/.test(jugement.date ?? "") ? (jugement.date as string) : null,
    nature,
    court: record.tribunal ?? null,
    cessationDate: parseCessationDate(raw),
    liquidator: parseLiquidator(raw),
    personType: readPersonType(record.listepersonnes),
    department: record.numerodepartement ?? null,
    raw,
  };
}

/** An opening judgment (liquidation, receivership or safeguard) from one BODACC notice, or null. */
export function parseJudgment(record: BodaccRecord): Judgment | null {
  const out = classify(record);
  return typeof out === "string" ? null : out;
}

/**
 * One judgment per company: the earliest published one. A receivership later converted to a
 * liquidation would otherwise count the same company twice. Output is sorted by publication.
 */
export function dedupeBySiren(judgments: readonly Judgment[]): Judgment[] {
  const sorted = [...judgments].sort(
    (a, b) => a.publishedOn.localeCompare(b.publishedOn) || a.noticeId.localeCompare(b.noticeId),
  );
  const seen = new Set<string>();
  return sorted.filter((j) => {
    if (seen.has(j.siren)) return false;
    seen.add(j.siren);
    return true;
  });
}

export type NoticeStats = {
  notices: number;
  skipped: Record<SkipReason, number>;
  parsed: number;
  duplicates: number;
  judgments: number;
};

export function parseNotices(records: readonly BodaccRecord[]): {
  judgments: Judgment[];
  stats: NoticeStats;
} {
  const skipped: Record<SkipReason, number> = {
    notInitial: 0,
    notOpening: 0,
    otherNature: 0,
    noSiren: 0,
    badJson: 0,
  };
  const parsed: Judgment[] = [];
  for (const record of records) {
    const out = classify(record);
    if (typeof out === "string") skipped[out]++;
    else parsed.push(out);
  }
  const judgments = dedupeBySiren(parsed);
  return {
    judgments,
    stats: {
      notices: records.length,
      skipped,
      parsed: parsed.length,
      duplicates: parsed.length - judgments.length,
      judgments: judgments.length,
    },
  };
}

const DATASET_URL =
  "https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales";

/** The subset of BODACC fields we read. `jugement` and `listepersonnes` are JSON strings. */
export type BodaccRecord = {
  id: string;
  dateparution: string;
  typeavis?: string | null;
  registre?: string[] | null;
  tribunal?: string | null;
  jugement?: string | null;
  familleavis_lib?: string | null;
  commercant?: string | null;
  ville?: string | null;
  cp?: string | null;
  numerodepartement?: string | null;
  listepersonnes?: string | null;
};

const SELECT = [
  "id",
  "dateparution",
  "typeavis",
  "registre",
  "tribunal",
  "jugement",
  "familleavis_lib",
  "commercant",
  "ville",
  "cp",
  "numerodepartement",
  "listepersonnes",
].join(",");

/** Calendar months covering [from, to] (inclusive), as [start, endExclusive] ISO dates. */
export function monthWindows(from: string, to: string): Array<[string, string]> {
  const windows: Array<[string, string]> = [];
  const end = addDaysIso(to, 1);
  let cursor = from;
  while (cursor < end) {
    const [y, m] = cursor.split("-").map(Number) as [number, number];
    const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
    // biome-ignore lint/complexity/useMathMinMax: ISO date strings, which compare chronologically
    windows.push([cursor, nextMonth < end ? nextMonth : end]);
    cursor = nextMonth;
  }
  return windows;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Every collective-proceedings notice whose judgment block mentions an opening, published in
 * [from, to]. One export call per month keeps each response around 10 MB and well under the
 * 10k offset cap of the records endpoint.
 */
export async function fetchOpeningNotices(from: string, to: string): Promise<BodaccRecord[]> {
  const out: BodaccRecord[] = [];
  for (const [start, endExclusive] of monthWindows(from, to)) {
    const where = [
      "familleavis='collective'",
      `dateparution>='${start}'`,
      `dateparution<'${endExclusive}'`,
      "jugement like '*ouverture*'",
    ].join(" and ");
    const url = `${DATASET_URL}/exports/json?${new URLSearchParams({ select: SELECT, where, order_by: "id" })}`;
    const records = await getJson<BodaccRecord[]>(url, "bodacc-exports");
    out.push(...records);
  }
  return out;
}

/** Opening judgments published in [from, to] (inclusive), one per company. */
export async function fetchJudgments(from: string, to: string): Promise<Judgment[]> {
  return parseNotices(await fetchOpeningNotices(from, to)).judgments;
}

/** Number of collective-proceedings notices ever published in BODACC for a SIREN. */
export async function countCollectiveNotices(siren: string): Promise<number> {
  const where = `registre='${siren}' and familleavis='collective'`;
  const url = `${DATASET_URL}/records?${new URLSearchParams({ where, limit: "0" })}`;
  const res = await getJson<{ total_count: number }>(url, "bodacc-siren");
  return res.total_count;
}
