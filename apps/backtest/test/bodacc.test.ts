import { describe, expect, it } from "vitest";
import {
  type BodaccRecord,
  dedupeBySiren,
  type Judgment,
  monthWindows,
  parseCessationDate,
  parseJudgment,
  parseLiquidator,
  parseNature,
} from "../src/bodacc.ts";
import liquidation from "./fixtures/bodacc-liquidation.json" with { type: "json" };
import redressement from "./fixtures/bodacc-redressement.json" with { type: "json" };
import sauvegarde from "./fixtures/bodacc-sauvegarde.json" with { type: "json" };

describe("parseCessationDate", () => {
  // Every input below is copied from a 2026 BODACC opening notice.
  it.each([
    [
      "Jugement prononçant la liquidation judiciaire simplifiée, date de cessation des paiements le 1er décembre 2025, désignant liquidateur sas Saulnier-Ponroy et associes prise la personne de Me Axel P",
      "2025-12-01",
    ],
    [
      "prononçant l'ouverture d'une procédure de redressement judiciaire , date de cessation des paiements le 31 Octobre 2025 , désignant mandataire judiciaire Selarl Victor Castagna 1, rue des Mathurins - 14100 Lisieux .",
      "2025-10-31",
    ],
    [
      "Jugement prononçant la liquidation judiciaire, date de cessation des paiements le 23/04/2025, désignant liquidateur SELARL FUNEL ET ASSOCIES prise en la personne de Me Jean-Patrick FUNEL 54 Rue Gioffrédo 06000 Nice .",
      "2025-04-23",
    ],
    [
      "Date de cessation des paiements : 12 Mai 2024 - Mandataire judiciaire au redressement et à la liquidation des entreprises : SELARL MJ AIR, représentée par Me CHARLIER Pierr",
      "2024-05-12",
    ],
    [
      "ire de l’EARL DU PETIT MOULIN au patimoine de Mr Fabrice PRIOLLAUD. Date de cessation des paiements : 1 er septembre 2024. Les déclarations de créances sont à déposer dans les deux mois",
      "2024-09-01",
    ],
    [
      "dation judiciaire sur le patrimoine professionnel et sur le patrimoine personnel. Date de cessation de paiement : 20 mai 2024. Mandataire liquidateur : SELAFA MJA prise en la personne de Me Florian LACOUR, mandataire judiciaire, 41, rue de ",
      "2024-05-20",
    ],
    [
      "cessation des paiements de l’Association Solidarités Professionnelles Transistions ; en a fixé provisoirement la date au 31 juillet 2025 ; désigné en qualité de mandataire judiciaire Maître Aymeric MANDIN",
      "2025-07-31",
    ],
    [
      "Constatant l’état de cessation des paiements du patrimoine professionnel à la date du 16 septembre 2025 et ordonnant l’ouverture de redressement judiciaire unique portant sur les patrimoines personnel et professionnel.",
      "2025-09-16",
    ],
    [
      "actes nécessaires à la préparation de la cession ou le cas échéant à sa réalisation. Et a fixé au 25/07/2026 la date de cessation des paiements. Les créances sont à adresser, dans les deux mois de la présente publication",
      "2026-07-25",
    ],
    [
      "'ouverture d'une procédure de redressement judiciaire, date de cessation des paiements le 01//06/2026 désignant administrateur SCP EZAVIN THOMAS Administrateurs Judiciaires prise en la personne de Me Nathalie THOMAS 1 Rue Alexandre Mari 063",
      "2026-06-01",
    ],
    [
      "Date de cessation des paiements fixée provisoirement : 10 octobre 2025. Mandataire judiciaire : Me ZANNI, 34 rue d’Auron, 18000 Bourges.",
      "2025-10-10",
    ],
    [
      " boulevard Amiral Courbet BP 10001 30006 Nîmes CEDEX 4 et fixant la Date de cessation des paiements au 01/01/2026. Les déclarations des créances sont à adresser au mandataire judiciaire",
      "2026-01-01",
    ],
    [
      "Jugement d’ouverture de la liquidation judiciaire. Cessation des paiements le 10 novembre 2025.Liquidateur judiciaire : Alain SOUCHON, 6 bis boulevard Jean-Baptiste Oudry, 94000 Créteil.",
      "2025-11-10",
    ],
  ])("parses %#", (input, expected) => {
    expect(parseCessationDate(input)).toBe(expected);
  });

  it("copes with month names typed without accents", () => {
    expect(parseCessationDate("date de cessation des paiements le 3 fevrier 2026, désignant")).toBe(
      "2026-02-03",
    );
    expect(parseCessationDate("date de cessation des paiements le 14 aout 2025, désignant")).toBe(
      "2025-08-14",
    );
    expect(parseCessationDate("date de cessation des paiements le 1er DECEMBRE 2025")).toBe("2025-12-01");
  });

  it.each([
    // blank date left in the notice
    "Jugement prononçant la liquidation judiciaire simplifiée, date de cessation des paiements le , désignant liquidateur Selarl Arpej mission conduite par Maître Sophie Guillouët 55 Rue Aristide Briand 77100 Meaux.",
    // year missing
    "Jugement d'ouverture de liquidation judiciaire. Date de cessation des paiements : 01 Janvier. Mandataire judiciare à la liquidation des entreprises: Selarl MJ EST",
    // safeguard openings never state one
    "Jugement prononçant l'ouverture d'une procédure de sauvegarde et désignant mandataire judiciaire Selarl Aegis prise en la personne de Me Orlane Gachet 5 Rue Saint-Gilles 31500 toulouse",
    "",
  ])("returns null when there is no usable date (%#)", (input) => {
    expect(parseCessationDate(input)).toBeNull();
  });

  it("rejects impossible calendar dates", () => {
    expect(parseCessationDate("date de cessation des paiements le 31 février 2026,")).toBeNull();
    expect(parseCessationDate("date de cessation des paiements le 12/13/2025,")).toBeNull();
  });
});

describe("parseLiquidator", () => {
  it.each([
    [
      "date de cessation des paiements le 1er décembre 2025, désignant liquidateur Selarl Ekip', prise en la personne de Maître Romain Rabusseau 6-7 boulevard Aristide Briand 33500 Libourne.",
      "Selarl Ekip', prise en la personne de Maître Romain Rabusseau",
    ],
    [
      "date de cessation des paiements le 16 juin 2024, désignant : mandataire judiciaire SCP Maître Olivier zanni prise en la personne de Me Olivier zanni 14 Rue André Lescaroux 36000 Châteauroux.",
      "SCP Maître Olivier zanni prise en la personne de Me Olivier zanni",
    ],
    [
      "désignant en qualité de liquidateur la Selarl SBCMJ en la Personne de Maitre Alexandre BANC 22 rue Taisson 30100 Alès.",
      "Selarl SBCMJ en la Personne de Maitre Alexandre BANC",
    ],
    [
      "Date de cessation des paiements : 1er janvier 2024. Liquidateur : SELAS EGIDE, représentée par Me BRENAC Alix, 23 rue Delcassée, 0900 Foix.",
      "SELAS EGIDE, représentée par Me BRENAC Alix",
    ],
    [
      "Date de cessation des paiements : 12 Mai 2024 - Mandataire judiciaire au redressement et à la liquidation des entreprises : SELARL MJ AIR, représentée par Me CHARLIER Pierre, 4 rue",
      "SELARL MJ AIR, représentée par Me CHARLIER Pierre",
    ],
    [
      "date de cessation des paiements le 30/08/2024, mandataire judiciaire SELARL GUERY prise en la personne de Me Dorian GUERY 28 Rue Verdi 06000 Nice",
      "SELARL GUERY prise en la personne de Me Dorian GUERY",
    ],
    [
      "Date de cessation des paiements : 27 Novembre 2025. Représentant des créanciers: Maître Eric GIRAUDEAU 7 C avenue de la République, 50200 Coutances.",
      "Maître Eric GIRAUDEAU",
    ],
  ])("extracts the practitioner %#", (input, expected) => {
    expect(parseLiquidator(input)).toBe(expected);
  });

  it("returns null when nobody is named", () => {
    expect(parseLiquidator("Jugement prononçant la liquidation judiciaire.")).toBeNull();
  });
});

describe("parseNature", () => {
  it.each([
    ["Jugement d'ouverture de liquidation judiciaire", "liquidation"],
    ["Jugement d'ouverture d'une procédure de redressement judiciaire", "redressement"],
    ["Jugement d'ouverture d'une procédure de sauvegarde", "sauvegarde"],
    ["Jugement d'ouverture d'une procédure de sauvegarde accélérée", "sauvegarde"],
    ["Jugement d'extension de liquidation judiciaire", null],
    ["Jugement de désignation des organes de la procédure", null],
    ["Autre jugement d'ouverture", null],
  ])("%s -> %s", (input, expected) => {
    expect(parseNature(input)).toBe(expected);
  });
});

describe("parseJudgment", () => {
  it("parses a simplified liquidation notice", () => {
    expect(parseJudgment(liquidation as BodaccRecord)).toEqual({
      noticeId: "A202600631755",
      siren: "933137606",
      publishedOn: "2026-04-01",
      judgmentDate: "2026-03-16",
      nature: "liquidation",
      court: "Greffe du Tribunal de Commerce de Libourne",
      cessationDate: "2025-12-01",
      liquidator: "Selarl Ekip', prise en la personne de Maître Romain Rabusseau",
      personType: "pm",
      department: "33",
      raw: expect.stringContaining("date de cessation des paiements le 1er décembre 2025"),
    });
  });

  it("parses a receivership notice with a numeric cessation date", () => {
    const judgment = parseJudgment(redressement as BodaccRecord);
    expect(judgment).toMatchObject({
      noticeId: "A202600123890",
      siren: "423928118",
      publishedOn: "2026-01-20",
      judgmentDate: "2026-01-08",
      nature: "redressement",
      court: "Greffe du Tribunal de Commerce de Nice",
      cessationDate: "2026-01-05",
      liquidator: "SELARL XAVIER HUERTAS & ASSOCIES prise en la personne de Me Xavier HUERTAS",
      personType: "pm",
      department: "06",
    });
  });

  it("keeps safeguard openings with no cessation date", () => {
    expect(parseJudgment(sauvegarde as BodaccRecord)).toMatchObject({
      siren: "818002222",
      nature: "sauvegarde",
      cessationDate: null,
      liquidator: "Selarl Aegis prise en la personne de Me Orlane Gachet",
    });
  });

  it("drops notices that are not opening judgments", () => {
    const jugement = JSON.stringify({
      type: "initial",
      famille: "Avis de dépôt",
      nature: "Dépôt de l'état des créances",
      date: "2025-12-08",
      complementJugement: "L'état des créances est déposé au greffe.",
    });
    expect(parseJudgment({ ...(liquidation as BodaccRecord), jugement })).toBeNull();
  });

  it("drops corrections, annulments and notices without a SIREN", () => {
    expect(parseJudgment({ ...(liquidation as BodaccRecord), typeavis: "rectificatif" })).toBeNull();
    expect(parseJudgment({ ...(liquidation as BodaccRecord), typeavis: "annulation" })).toBeNull();
    expect(parseJudgment({ ...(liquidation as BodaccRecord), registre: null })).toBeNull();
    expect(parseJudgment({ ...(liquidation as BodaccRecord), jugement: "{not json" })).toBeNull();
  });
});

describe("dedupeBySiren", () => {
  const base = parseJudgment(liquidation as BodaccRecord) as Judgment;

  it("keeps the earliest published opening per company", () => {
    const later = { ...base, noticeId: "B2", publishedOn: "2026-06-01", nature: "liquidation" as const };
    const earlier = { ...base, noticeId: "B1", publishedOn: "2026-02-01", nature: "redressement" as const };
    const other = { ...base, noticeId: "C1", siren: "111111111" };
    const out = dedupeBySiren([later, other, earlier]);
    expect(out.map((j) => j.noticeId)).toEqual(["B1", "C1"]);
  });
});

describe("monthWindows", () => {
  it("splits an inclusive range into calendar months", () => {
    expect(monthWindows("2026-01-01", "2026-03-15")).toEqual([
      ["2026-01-01", "2026-02-01"],
      ["2026-02-01", "2026-03-01"],
      ["2026-03-01", "2026-03-16"],
    ]);
    expect(monthWindows("2025-12-10", "2026-01-31")).toEqual([
      ["2025-12-10", "2026-01-01"],
      ["2026-01-01", "2026-02-01"],
    ]);
  });
});
