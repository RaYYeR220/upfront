import { addMonths } from "@upfront/sources";

/**
 * French insolvency law (code de commerce L.622-24, R.622-24): creditors declare
 * their claim to the court-appointed representative within two months of the
 * opening judgment's publication in the BODACC.
 */
export function claimDeadline(publishedOn: string): string {
  return addMonths(publishedOn, 2);
}

export interface Representative {
  role: string;
  name: string;
}

const ROLES = ["liquidateur", "mandataire judiciaire", "administrateur judiciaire", "commissaire à l'exécution du plan"];

/** Pulls the representative creditors must write to out of the gazette notice text. */
export function liquidatorFromNotice(text: string): Representative | null {
  for (const role of ROLES) {
    const re = new RegExp(`d[ée]signant\\s+${role.replace(/ /g, "\\s+")}\\s+(.+?)(?:\\.\\s*|,\\s*(?:administrateur|mandataire|liquidateur)|\\.Les|\\.\\s*Les|$)`, "i");
    const m = re.exec(text);
    if (m?.[1]) return { role, name: m[1].replace(/\s+/g, " ").trim().replace(/[.,;]$/, "") };
  }
  return null;
}

const frDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const frEur = (n: number) =>
  `${new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n).replace(/ | /g, " ")} €`;
const frSiren = (s: string) => s.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3");

/** A pre-filled "déclaration de créance" for an unsecured trade creditor. */
export function claimDraft(a: {
  creditor: { name: string; address: string };
  debtor: { name: string; siren: string };
  amountEur: number;
  invoiceRefs: string[];
  representative: Representative | null;
  court: string;
  judgmentDate: string | null;
  publishedOn: string;
}): string {
  const deadline = claimDeadline(a.publishedOn);
  const to = a.representative ? `${a.representative.name} (${a.representative.role})` : "[le mandataire désigné, voir l'annonce BODACC]";
  return [
    `Déclaration de créance`,
    ``,
    `À l'attention de : ${to}`,
    `Procédure : ${a.court}${a.judgmentDate ? `, jugement du ${frDate(a.judgmentDate)}` : ""}, publié au BODACC le ${frDate(a.publishedOn)}.`,
    `Débiteur : ${a.debtor.name}, SIREN ${frSiren(a.debtor.siren)}.`,
    `Créancier : ${a.creditor.name}, ${a.creditor.address}.`,
    ``,
    `Je déclare au passif de la procédure la créance suivante :`,
    `- Montant échu : ${frEur(a.amountEur)} TTC, au titre des factures ${a.invoiceRefs.join(", ")} (copies jointes).`,
    `- Montant à échoir : néant.`,
    `- Nature : créance chirographaire, sans sûreté ni privilège.`,
    ``,
    `Je certifie sincère et véritable la présente déclaration de créance.`,
    ``,
    `Fait à ____________, le ____________`,
    `Signature :`,
    ``,
    `À envoyer avant le ${frDate(deadline)} (deux mois après la publication au BODACC), par lettre recommandée avec accusé de réception ou sur le portail électronique des déclarations de créances.`,
  ].join("\n");
}
