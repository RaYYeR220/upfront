import type { Fact, FactKind } from "@upfront/core";

export const SIRENIC = "https://api.sirenic.eu";

export type SirenicRoute =
  | "recherche"
  | "entreprise"
  | "alertes"
  | "finances"
  | "contentieux"
  | "documents"
  | "changements"
  | "encours";

export interface SirenicParams {
  siren?: string;
  q?: string;
  depuis?: string;
  montant?: number;
  delai_jours?: number;
}

const SIREN_RE = /^\d{9}$/;

export function sirenicUrl(route: SirenicRoute, p: SirenicParams): string {
  if (route === "recherche") {
    const u = new URL("/v1/recherche", SIRENIC);
    u.searchParams.set("q", p.q ?? "");
    return u.toString();
  }
  if (!p.siren || !SIREN_RE.test(p.siren)) throw new Error(`Invalid SIREN: ${p.siren ?? "(missing)"}`);
  const path = route === "entreprise" ? `/v1/entreprise/${p.siren}` : `/v1/entreprise/${p.siren}/${route}`;
  const u = new URL(path, SIRENIC);
  if (route === "changements" && p.depuis) u.searchParams.set("depuis", p.depuis);
  if (route === "encours" && p.montant !== undefined && p.delai_jours !== undefined) {
    u.searchParams.set("montant", String(p.montant));
    u.searchParams.set("delai_jours", String(p.delai_jours));
  }
  return u.toString();
}

export interface Candidate {
  siren: string;
  name: string;
  active: boolean;
  confidence: number;
  nameMatch: string;
  city: string;
  naf: string;
  fullyPublic: boolean;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export function parseCandidates(body: unknown): Candidate[] {
  return arr(obj(body).resultats).map((r) => {
    const o = obj(r);
    return {
      siren: String(o.siren ?? ""),
      name: String(o.denomination ?? ""),
      active: o.etat_administratif === "actif",
      confidence: num(o.score_confiance) ?? 0,
      nameMatch: String(o.correspondance_nom ?? ""),
      city: String(o.commune_siege ?? ""),
      naf: String(o.activite_principale ?? ""),
      fullyPublic: o.statut_diffusion === "totale",
    };
  });
}

export interface ParseCtx {
  receiptId: string | null;
  fetchedAt: string;
}

function make(route: SirenicRoute, ctx: ParseCtx) {
  let i = 0;
  return (kind: FactKind, value: unknown, observedAt: string): Fact => ({
    id: `${route}#${i++}`,
    kind,
    value,
    observedAt,
    source: `sirenic/${route}`,
    receiptId: ctx.receiptId,
  });
}

/** A BODACC notice as returned by /alertes and /changements. */
function noticeValue(n: Json) {
  const j = obj(n.jugement);
  return {
    family: "procedure",
    category: str(j.categorie) ?? categoryFromNature(str(j.nature) ?? ""),
    nature: str(j.nature) ?? null,
    judgmentDate: str(j.date) ?? null,
    publishedOn: str(n.date_parution) ?? null,
    cessationDate: str(j.date_cessation_paiements) ?? null,
    court: str(n.tribunal) ?? null,
    noticeId: str(n.id) ?? null,
    representatives: arr(j.mandataires).map((m) => str(obj(m).role)).filter(Boolean),
  };
}

export function categoryFromNature(nature: string): string {
  const n = nature.toLowerCase();
  if (/cl[ôo]ture/.test(n)) return "cloture";
  if (/plan/.test(n)) return n.includes("sauvegarde") ? "plan_sauvegarde" : "plan_redressement";
  if (/conversion/.test(n) && /liquidation/.test(n)) return "conversion_liquidation";
  if (/ouverture/.test(n) && /liquidation/.test(n)) return "ouverture_liquidation";
  if (/ouverture/.test(n) && /redressement/.test(n)) return "ouverture_redressement";
  if (/ouverture/.test(n) && /sauvegarde/.test(n)) return "ouverture_sauvegarde";
  return "autre";
}

export function parseSirenic(route: SirenicRoute, body: unknown, ctx: ParseCtx): Fact[] {
  const b = obj(body);
  const f = make(route, ctx);
  switch (route) {
    case "recherche":
      return [];
    case "entreprise": {
      const out: Fact[] = [];
      const created = str(b.date_creation);
      if (str(b.denomination)) out.push(f("identity.name", b.denomination, created ?? ctx.fetchedAt));
      if (str(b.nature_juridique)) out.push(f("identity.legal_form", b.nature_juridique, created ?? ctx.fetchedAt));
      if (created) out.push(f("identity.created_on", created, created));
      if (str(b.activite_principale)) out.push(f("identity.naf", b.activite_principale, created ?? ctx.fetchedAt));
      if (str(b.tranche_effectif_salarie)) out.push(f("identity.workforce_band", b.tranche_effectif_salarie, ctx.fetchedAt));
      if (str(b.tva_intracommunautaire)) out.push(f("identity.vat", b.tva_intracommunautaire, created ?? ctx.fetchedAt));
      if (b.etat_administratif === "actif") out.push(f("status.active", true, ctx.fetchedAt));
      else if (str(b.etat_administratif)) {
        const ceased = str(b.date_cessation) ?? str(b.date_fermeture);
        out.push(f("status.ceased_on", ceased ?? "unknown", ceased ?? ctx.fetchedAt));
      }
      return out;
    }
    case "alertes":
      return arr(b.procedures_collectives).map((n) => {
        const v = noticeValue(obj(n));
        return f("bodacc.event", v, v.publishedOn ?? ctx.fetchedAt);
      });
    case "changements": {
      const feed = obj(b.nouveaux_evenements_bodacc);
      return arr(feed.annonces).map((n) => {
        const o = obj(n);
        if (o.jugement) {
          const v = noticeValue(o);
          return f("bodacc.event", v, v.publishedOn ?? ctx.fetchedAt);
        }
        const publishedOn = str(o.date_parution) ?? ctx.fetchedAt;
        return f("bodacc.event", { family: str(o.famille) ?? "autre", publishedOn, noticeId: str(o.id) ?? null }, publishedOn);
      });
    }
    case "documents":
      return arr(b.bilans)
        .map(obj)
        .filter((d) => str(d.date_depot) && str(d.date_cloture))
        .map((d) =>
          f("accounts.filed", { closingDate: d.date_cloture, filedOn: d.date_depot }, String(d.date_depot)),
        );
    case "finances":
      return arr(b.exercices)
        .map(obj)
        .filter((e) => str(e.date_cloture))
        .map((e) => {
          const ratios = obj(e.ratios);
          return f(
            "finance.year",
            {
              closingDate: e.date_cloture,
              revenue: num(e.chiffre_affaires) ?? null,
              ebitda: num(e.ebe) ?? null,
              netIncome: num(e.resultat_net) ?? null,
              debtRatio: num(ratios.taux_endettement) ?? null,
              equityRatio: num(ratios.autonomie_financiere) ?? null,
              reliability: str(obj(e.qualite).fiabilite) ?? null,
            },
            String(e.date_cloture),
          );
        });
    case "contentieux":
      return arr(b.decisions)
        .map(obj)
        .map((d) => {
          const date = str(d.date) ?? str(d.date_decision) ?? ctx.fetchedAt;
          return f(
            "court.decision",
            { nature: str(d.nature) ?? null, date, role: str(d.role) ?? null, court: str(d.juridiction) ?? null, link: str(d.lien) ?? str(d.url) ?? null },
            date,
          );
        });
    case "encours":
      return [
        f(
          "vendor.credit_limit",
          {
            amountEur: num(b.encours_indicatif) ?? null,
            terms: str(b.conditions) ?? null,
            riskClass: str(b.classe) ?? null,
            verdict: str(b.verdict) ?? null,
            riskScore: num(obj(b.entrees).score_risque) ?? null,
          },
          ctx.fetchedAt,
        ),
      ];
  }
}
