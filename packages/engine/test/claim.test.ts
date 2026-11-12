import { describe, expect, it } from "vitest";
import { claimDeadline, claimDraft, liquidatorFromNotice } from "../src/claim.ts";

describe("claimDeadline", () => {
  it("is two calendar months after the gazette notice", () => {
    expect(claimDeadline("2026-10-14")).toBe("2026-12-14");
    expect(claimDeadline("2026-12-31")).toBe("2027-02-28");
  });
});

describe("liquidatorFromNotice", () => {
  it("reads the court-appointed representative from the notice text", () => {
    const text =
      "Jugement prononçant la liquidation judiciaire, date de cessation des paiements le 3 mars 2026, désignant liquidateur SAS Alliance Mission Conduite Par Me Gurvan Ollu 29 Boulevard DU SUD EST 92000 Nanterre.Les déclarations des créances sont à adresser au liquidateur ou sur le portail électronique prévu par les articles L.814-2 et L.814-13 du code de commerce dans les deux mois à compter de la publication au Bodacc.";
    expect(liquidatorFromNotice(text)).toEqual({
      role: "liquidateur",
      name: "SAS Alliance Mission Conduite Par Me Gurvan Ollu 29 Boulevard DU SUD EST 92000 Nanterre",
    });
  });
  it("reads a mandataire in a reorganisation", () => {
    const text = "Jugement d'ouverture d'une procédure de redressement judiciaire, désignant mandataire judiciaire Selarl Ajire 10 rue X 75001 Paris, administrateur Me Y. Les déclarations des créances…";
    expect(liquidatorFromNotice(text)).toMatchObject({ role: "mandataire judiciaire", name: "Selarl Ajire 10 rue X 75001 Paris" });
  });
  it("returns null when no representative is named", () => {
    expect(liquidatorFromNotice("Jugement de clôture pour insuffisance d'actif.")).toBeNull();
  });
});

describe("claimDraft", () => {
  it("fills in a French claim declaration", () => {
    const d = claimDraft({
      creditor: { name: "Studio Lumen", address: "4 rue des Arts, 69001 Lyon" },
      debtor: { name: "KD SOCCER CONSULTING", siren: "841936560" },
      amountEur: 6800,
      invoiceRefs: ["F-2026-031", "F-2026-044"],
      representative: { role: "liquidateur", name: "SAS Alliance, Me Gurvan Ollu, 92000 Nanterre" },
      court: "Tribunal de Commerce de Meaux",
      judgmentDate: "2026-09-28",
      publishedOn: "2026-10-14",
    });
    expect(d).toContain("Déclaration de créance");
    expect(d).toContain("KD SOCCER CONSULTING");
    expect(d).toContain("841 936 560");
    expect(d).toContain("6 800,00 €");
    expect(d).toContain("F-2026-031");
    expect(d).toContain("Tribunal de Commerce de Meaux");
    expect(d).toContain("14/12/2026");
    expect(d).toContain("SAS Alliance");
    expect(d).toMatch(/chirographaire/);
  });
});
