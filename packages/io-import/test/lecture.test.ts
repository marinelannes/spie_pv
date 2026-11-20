import type { AnomalieImport, ListeEsLue } from "@spie/shared";
import { describe, expect, it } from "vitest";
import { lettreColonne, lireListeEs, texteCellule, texteLigne } from "../src/index.js";
import { classeurStandard, eq, es, feuilleEquipements, feuilleEs, nouveauClasseur, versOctets } from "./classeurs.js";
import type { Workbook } from "exceljs";

const lire = async (wb: Workbook, attendu?: string) =>
  lireListeEs(await versOctets(wb), attendu ? { numeroAffaireAttendu: attendu } : {});

const codes = (l: ListeEsLue, severite?: AnomalieImport["severite"]) =>
  l.anomalies.filter((a) => !severite || a.severite === severite).map((a) => a.code);

const feuille = (l: ListeEsLue, nom: string) => {
  const f = l.feuilles.find((x) => x.nom === nom);
  if (!f) throw new Error(`feuille ${nom} absente`);
  return f;
};

describe("texteCellule", () => {
  it("cellules simples", () => {
    expect(texteCellule(null)).toBe("");
    expect(texteCellule(undefined)).toBe("");
    expect(texteCellule("a\r\nb\rc")).toBe("a\nb\nc");
    expect(texteCellule(12)).toBe("12");
    expect(texteCellule(1.01)).toBe("1.01");
    expect(texteCellule(Number.NaN)).toBe("");
    expect(texteCellule(true)).toBe("VRAI");
    expect(texteCellule(false)).toBe("FAUX");
    expect(texteCellule(new Date("2026-11-13T00:00:00Z"))).toBe("2026-11-13");
    expect(texteCellule(new Date("invalide"))).toBe("");
  });

  it("texte riche, lien hypertexte, formules, erreurs", () => {
    expect(texteCellule({ richText: [{ text: "RES" }, { text: "ERVE", font: { bold: true } }] })).toBe("RESERVE");
    expect(texteCellule({ text: "lien", hyperlink: "https://exemple.test" })).toBe("lien");
    expect(texteCellule({ text: { richText: [{ text: "riche" }] }, hyperlink: "https://exemple.test" })).toBe("riche");
    expect(texteCellule({ formula: "A1", result: "E TOR" })).toBe("E TOR");
    expect(texteCellule({ formula: "A1", result: 5 })).toBe("5");
    expect(texteCellule({ formula: "A1", result: { error: "#N/A" } })).toBe("");
    expect(texteCellule({ formula: "A1" })).toBe("");
    expect(texteCellule({ sharedFormula: "A1", result: "S TOR" })).toBe("S TOR");
    expect(texteCellule({ error: "#REF!" })).toBe("");
    expect(texteCellule({ autre: 1 })).toBe("");
  });

  it("texteLigne ramène les espaces et retours à la ligne à un espace", () => {
    expect(texteLigne("  BI  1.01\n ")).toBe("BI 1.01");
    expect(texteLigne({ richText: [{ text: "LISTE\n" }, { text: " E/S" }] })).toBe("LISTE E/S");
  });

  it("lettreColonne", () => {
    expect([1, 5, 26, 27, 52, 703].map(lettreColonne)).toEqual(["A", "E", "Z", "AA", "AZ", "AAA"]);
  });
});

describe("lireListeEs : référence, révision, affaire", () => {
  it("lit le cartouche des feuilles", async () => {
    const l = await lire(classeurStandard(), "A35173");
    expect({ reference: l.reference, revision: l.revision, numeroAffaire: l.numeroAffaire }).toEqual({
      reference: "GAU11_AUT_009",
      revision: "B",
      numeroAffaire: "A35173",
    });
    expect(l.anomalies).toEqual([]);
  });

  it("retient la valeur majoritaire quand les cartouches divergent", async () => {
    const wb = classeurStandard();
    feuilleEs(wb, "TYPE TR AUX", [es("C", "-", "E TOR", "X", "BI 1.01")], { cartouche: { revision: "B" } });
    feuilleEs(wb, "AUTRE", [es("C", "-", "E TOR", "X", "BI 1.01")], { cartouche: { revision: "A" } });
    expect((await lire(wb)).revision).toBe("B");
  });

  it("se replie sur la page de garde PdG_Client", async () => {
    const wb = nouveauClasseur();
    const pdg = wb.addWorksheet("PdG_Client");
    pdg.getCell("B2").value = "\n\n\nSTOCKAGE BATTERIES - GAU11\n\nGAU11_AUT_009\nLISTE ENTREES / SORTIES RPN";
    pdg.getCell("B30").value = "B";
    pdg.getCell("C30").value = "Mise à jour";
    pdg.getCell("B31").value = "A";
    pdg.getCell("B32").value = "INDICE";
    feuilleEquipements(wb, [eq("RPN_HTA_F1", "TYPE BATTERIE")], { cartouche: false });
    feuilleEs(wb, "TYPE BATTERIE", [es("C", "-", "E TOR", "X", "BI 1.01")], { cartouche: false });
    const l = await lire(wb, "A35173");
    expect(l.reference).toBe("GAU11_AUT_009");
    expect(l.revision).toBe("B");
    expect(l.numeroAffaire).toBe("");
    expect(l.anomalies).toEqual([
      expect.objectContaining({
        code: "reference_introuvable",
        severite: "avertissement",
        message: expect.stringContaining("A35173"),
      }),
    ]);
  });

  it("signale référence et révision introuvables", async () => {
    const wb = nouveauClasseur();
    feuilleEquipements(wb, [eq("RPN_HTA_F1", "TYPE BATTERIE")], { cartouche: false });
    feuilleEs(wb, "TYPE BATTERIE", [es("C", "-", "E TOR", "X", "BI 1.01")], { cartouche: false });
    const l = await lire(wb);
    expect(l.reference).toBe("");
    expect(l.revision).toBe("");
    expect(codes(l)).toEqual(["reference_introuvable", "reference_introuvable"]);
  });

  it("refuse un fichier d'une autre affaire (erreur) et compare sans tenir compte de la casse", async () => {
    expect(codes(await lire(classeurStandard(), "A99999"), "erreur")).toEqual(["affaire_differente"]);
    expect((await lire(classeurStandard(), "A99999")).anomalies[0]?.message).toBe(
      "Le fichier concerne l'affaire A35173, pas l'affaire A99999.",
    );
    expect((await lire(classeurStandard(), " a35173 ")).anomalies).toEqual([]);
  });
});

describe("lireListeEs : liste des équipements", () => {
  it("lit toutes les colonnes, supprime les espaces superflus et saute les lignes vides", async () => {
    const wb = nouveauClasseur();
    feuilleEquipements(wb, [
      [
        " RELAIS PROTECTION NUMERIQUE PROTECTION DIFFERENTIELLE TR",
        "HTB",
        "HTB",
        "RPN_HTB_DIFF_TR",
        "RELAIS SIPROTEC 5",
        "7UT85",
        "LOCAL HTA - ZONE NORD",
        "ZN_HTB_1G02",
        "REF-1",
      ],
      [null, null, null, null, null, null, null, null, null],
      [
        "REGULATEUR DE TENSION HTB TRANCHE TRANSFO TR1",
        "HTB",
        null,
        "RGU_HTB_TR",
        "A.EBERLE",
        "REG-DA",
        "LOCAL",
        "ZN_HTB_1G02",
        null,
      ],
    ]);
    feuilleEs(wb, "HTB_TR1", [es("C", "-", "E TOR", "X", "BI 1.01")]);
    const l = await lire(wb);
    expect(l.equipements).toEqual([
      {
        ligne: 7,
        libelle: "RELAIS PROTECTION NUMERIQUE PROTECTION DIFFERENTIELLE TR",
        niveauTension: "HTB",
        typeCellule: "HTB",
        tag: "RPN_HTB_DIFF_TR",
        equipement: "RELAIS SIPROTEC 5",
        modele: "7UT85",
        local: "LOCAL HTA - ZONE NORD",
        tagArmoire: "ZN_HTB_1G02",
        referenceConstructeur: "REF-1",
      },
      expect.objectContaining({ ligne: 9, tag: "RGU_HTB_TR", typeCellule: "", referenceConstructeur: "" }),
    ]);
  });

  it("signale libellés en double (avertissement), TAG en double (erreur, ligne ignorée) et équipement sans TAG", async () => {
    const wb = nouveauClasseur();
    feuilleEquipements(wb, [
      eq("RPN_HTA_F4", "TYPE BATTERIE", "RELAIS DE PROTECTION NUMERIQUE DEPART F5"),
      eq("RPN_HTA_F5", "TYPE BATTERIE", "Relais de protection numérique départ F5"),
      eq("RPN_HTA_F5", "TYPE BATTERIE", "DOUBLON"),
      ["SANS TAG", "HTA", "TYPE BATTERIE", null, null, null, null, null, null],
    ]);
    feuilleEs(wb, "TYPE BATTERIE", [es("C", "-", "E TOR", "X", "BI 1.01")]);
    const l = await lire(wb);
    expect(l.equipements.map((e) => e.tag)).toEqual(["RPN_HTA_F4", "RPN_HTA_F5"]);
    expect(l.anomalies.map((a) => [a.code, a.severite, a.ligne])).toEqual([
      ["libelle_equipement_en_double", "avertissement", 8],
      ["tag_equipement_en_double", "erreur", 9],
      ["ligne_incomplete", "avertissement", 10],
    ]);
    expect(l.anomalies[0]!.message).toContain("RPN_HTA_F4");
    expect(l.anomalies[2]!.message).toBe("Équipement sans TAG (« SANS TAG ») : ligne ignorée.");
  });

  it("trouve la feuille des équipements par son en-tête si elle est renommée, en-tête décalé", async () => {
    const wb = nouveauClasseur();
    feuilleEquipements(wb, [eq("RPN_HTA_F1", "TYPE BATTERIE")], { nom: "Equipements", ligneEnTete: 8 });
    feuilleEs(wb, "TYPE BATTERIE", [es("C", "-", "E TOR", "X", "BI 1.01")]);
    const l = await lire(wb);
    expect(l.equipements).toEqual([expect.objectContaining({ ligne: 9, tag: "RPN_HTA_F1" })]);
    expect(l.anomalies).toEqual([]);
  });

  it("erreur si la feuille des équipements manque ou n'a pas d'en-tête reconnaissable", async () => {
    const sans = nouveauClasseur();
    feuilleEs(sans, "TYPE BATTERIE", [es("C", "-", "E TOR", "X", "BI 1.01")]);
    expect(codes(await lire(sans), "erreur")).toEqual(["feuille_equipements_absente"]);

    const mauvaise = nouveauClasseur();
    mauvaise.addWorksheet("LISTE DES EQUIPEMENTS").getCell("A6").value = "NOM";
    feuilleEs(mauvaise, "TYPE BATTERIE", [es("C", "-", "E TOR", "X", "BI 1.01")]);
    const l = await lire(mauvaise);
    expect(l.anomalies.filter((a) => a.severite === "erreur")).toEqual([
      expect.objectContaining({ code: "en_tete_introuvable", feuille: "LISTE DES EQUIPEMENTS" }),
    ]);
  });
});

describe("lireListeEs : feuilles d'E/S", () => {
  it("lit les E/S : types normalisés, réserves, carte, tag, titre, numéros de ligne", async () => {
    const l = await lire(classeurStandard());
    const f = feuille(l, "TYPE BATTERIE");
    expect(f.titre).toBe("LISTE DES ENTREES / SORTIES RELAIS PROTECTION NUMERIQUE TYPE BATTERIE");
    expect(f.groupesTag).toEqual([]);
    expect(f.points).toEqual([
      {
        ligne: 7,
        carte: "RPN_HTA / PS050_1",
        tag: "-",
        typeBrut: "ENTREE TOR",
        type: "entree_tor",
        designation: "SURVEILLANCE CIRCUIT DECLENCHEMENT",
        adresse: "BI 1.01",
        reserve: false,
      },
      {
        ligne: 8,
        carte: "RPN_HTA / IO60_1",
        tag: "-",
        typeBrut: "ENTREE TOR",
        type: "entree_tor",
        designation: "RESERVE",
        adresse: "BI 2.11",
        reserve: true,
      },
      {
        ligne: 9,
        carte: "RPN_HTA / PS050_1",
        tag: "-",
        typeBrut: "SORTIE TOR",
        type: "sortie_tor",
        designation: "DÉCLENCHEMENT DISJ. MBO1",
        adresse: "BO 1.01",
        reserve: false,
      },
      {
        ligne: 10,
        carte: "RPN_HTA / PS050_1",
        tag: "-",
        typeBrut: "ENTREE ANALOGIQUE",
        type: "entree_analogique",
        designation: "COURANT PHASE 1",
        adresse: "I1",
        reserve: false,
      },
    ]);
    // Les feuilles sans en-tête d'E/S (page de garde, équipements) ne sont pas des feuilles d'E/S.
    expect(l.feuilles.map((x) => x.nom)).toEqual(["TYPE BATTERIE"]);
  });

  it("détecte un en-tête décalé (ligne 9) et ignore les lignes vides", async () => {
    const wb = nouveauClasseur();
    feuilleEquipements(wb, [eq("RPN_HTA_F1", "TYPE BATTERIE")]);
    feuilleEs(
      wb,
      "TYPE BATTERIE",
      [
        es("C1", "-", "E TOR", "A", "BI 1.01"),
        [],
        [null, null, null, null, null],
        es("C1", "-", "S TOR", "RESERVE CABLEE", "BO 1.01"),
      ],
      { ligneEnTete: 9 },
    );
    const f = feuille(await lire(wb), "TYPE BATTERIE");
    expect(f.points.map((p) => [p.ligne, p.adresse, p.type, p.reserve])).toEqual([
      [10, "BI 1.01", "entree_tor", false],
      [13, "BO 1.01", "sortie_tor", true],
    ]);
  });

  it("colonne des types intitulée « TAG RPN » (cas HTB_TR1) : types déduits, info dans le rapport", async () => {
    const wb = nouveauClasseur();
    feuilleEquipements(wb, [eq("RPN_HTB_DIFF_TR", "HTB")]);
    feuilleEs(
      wb,
      "HTB_TR1",
      [
        es("SICAM 7XV5674", "PROTECTION TRANSFO DIF.", "E ANA", "NIVEAU HUILE TRANSFO (POL1)", "Q 01"),
        es("RPN_HTB / IO203", "PROTECTION TRANSFO DIF.", "E TOR", "BUCHHOLZ ALARME", "BI 1.01"),
        es("RPN_HTB / IO203", "PROTECTION TRANSFO DIF.", "S TOR", "DECLENCHEMENT", "BO 1.01"),
      ],
      { enTete: ["CARTES", "TAG CELLULE / EQUIPEMENT", "TAG RPN", "COMMENTAIRE", "ADRESSE"] },
    );
    const l = await lire(wb);
    const f = feuille(l, "HTB_TR1");
    expect(f.points.map((p) => [p.tag, p.type])).toEqual([
      ["PROTECTION TRANSFO DIF.", "entree_analogique"],
      ["PROTECTION TRANSFO DIF.", "entree_tor"],
      ["PROTECTION TRANSFO DIF.", "sortie_tor"],
    ]);
    expect(f.groupesTag).toEqual(["PROTECTION TRANSFO DIF."]);
    expect(l.anomalies).toEqual([
      expect.objectContaining({
        code: "type_deduit",
        severite: "info",
        feuille: "HTB_TR1",
        ligne: 6,
        message: "Pas de colonne « TYPE » : la colonne C (« TAG RPN »), qui contient les types d'E/S, est utilisée.",
      }),
    ]);
  });

  it("sans colonne de types exploitable : avertissement et aucune E/S importée pour la feuille", async () => {
    const wb = nouveauClasseur();
    feuilleEquipements(wb, [eq("RPN_HTA_F1", "TYPE BATTERIE")]);
    feuilleEs(wb, "TYPE BATTERIE", [["C1", "-", "X", "Y", "BI 1.01"]], {
      enTete: ["CARTES", "TAG CELLULE / EQUIPEMENT", "AUTRE", "COMMENTAIRE", "ADRESSE"],
    });
    const l = await lire(wb);
    expect(feuille(l, "TYPE BATTERIE").points).toEqual([]);
    expect(l.anomalies).toEqual([expect.objectContaining({ code: "en_tete_introuvable", severite: "avertissement" })]);
  });

  it("lit texte riche, formules, liens et nombres", async () => {
    const wb = nouveauClasseur();
    feuilleEquipements(wb, [eq("RPN_HTA_F1", "TYPE BATTERIE")]);
    feuilleEs(wb, "TYPE BATTERIE", [
      [
        { richText: [{ text: "RPN_HTA / " }, { text: "PS050_1", font: { bold: true } }] },
        "-",
        { formula: '"E "&"TOR"', result: "E TOR" },
        { text: "POSITION DISJ. OUVERT", hyperlink: "https://exemple.test" },
        12,
      ],
    ]);
    const f = feuille(await lire(wb), "TYPE BATTERIE");
    expect(f.points[0]).toMatchObject({
      carte: "RPN_HTA / PS050_1",
      type: "entree_tor",
      designation: "POSITION DISJ. OUVERT",
      adresse: "12",
    });
  });

  it("ignore les colonnes sans en-tête (info), sans rien signaler pour une colonne vide", async () => {
    const wb = nouveauClasseur();
    feuilleEquipements(wb, [eq("RPN_HTA_F1", "TYPE BATTERIE")]);
    const ws = feuilleEs(wb, "TYPE BATTERIE", [
      [...es("C1", "-", "E TOR", "A", "BI 1.01"), "note libre"],
      [...es("C1", "-", "E TOR", "B", "BI 1.02"), "autre note"],
    ]);
    ws.getCell("H6").value = null;
    ws.getCell("H20").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFF0000" } };
    const l = await lire(wb);
    expect(feuille(l, "TYPE BATTERIE").points.map((p) => p.designation)).toEqual(["A", "B"]);
    expect(l.anomalies).toEqual([
      expect.objectContaining({
        code: "colonne_sans_en_tete",
        severite: "info",
        feuille: "TYPE BATTERIE",
        message: "Colonne F sans en-tête ignorée (2 valeurs).",
      }),
    ]);
  });

  it("lignes incomplètes : sans adresse ou sans type non importées, sans désignation ou carte importées", async () => {
    const wb = nouveauClasseur();
    feuilleEquipements(wb, [eq("RPN_HTA_F1", "TYPE BATTERIE")]);
    feuilleEs(wb, "TYPE BATTERIE", [
      es("C1", "-", "E TOR", "SANS ADRESSE", ""),
      es("C1", "-", "", "SANS TYPE", "BI 1.02"),
      es("C1", "-", "E TOR", "", "BI 1.03"),
      es("", "-", "S TOR", "SANS CARTE", "BO 1.01"),
      es("C1", "-", "E TOR", "COMPLETE", "BI 1.04"),
      es("", "", "", "NOTA : voir schéma", ""),
    ]);
    const l = await lire(wb);
    expect(feuille(l, "TYPE BATTERIE").points.map((p) => [p.adresse, p.designation, p.carte])).toEqual([
      ["BI 1.03", "", "C1"],
      ["BO 1.01", "SANS CARTE", ""],
      ["BI 1.04", "COMPLETE", "C1"],
    ]);
    expect(l.anomalies.map((a) => [a.code, a.ligne, a.message])).toEqual([
      ["ligne_incomplete", 7, "Ligne incomplète (adresse manquante) : ligne non importée."],
      ["ligne_incomplete", 8, "Ligne incomplète (type manquant) : ligne non importée."],
      ["ligne_incomplete", 9, "Ligne incomplète (désignation manquante)."],
      ["ligne_incomplete", 10, "Ligne incomplète (carte manquante)."],
      [
        "ligne_incomplete",
        12,
        "Ligne incomplète (adresse manquante, type manquant, carte manquante) : ligne non importée.",
      ],
    ]);
    expect(l.anomalies.every((a) => a.severite === "avertissement")).toBe(true);
  });

  it("type inconnu : avertissement, ligne non importée", async () => {
    const wb = nouveauClasseur();
    feuilleEquipements(wb, [eq("RPN_HTA_F1", "TYPE BATTERIE")]);
    feuilleEs(wb, "TYPE BATTERIE", [
      es("C1", "-", "S ANA", "SORTIE 4-20 mA", "AO 1"),
      es("C1", "-", "E TOR", "OK", "BI 1.01"),
    ]);
    const l = await lire(wb);
    expect(feuille(l, "TYPE BATTERIE").points.map((p) => p.adresse)).toEqual(["BI 1.01"]);
    expect(l.anomalies).toEqual([
      expect.objectContaining({
        code: "type_inconnu",
        severite: "avertissement",
        ligne: 7,
        message: expect.stringContaining("« S ANA »"),
      }),
    ]);
  });

  it("doublons d'adresse dans un même groupe TAG, pas entre deux groupes ; feuille multi-équipements signalée", async () => {
    const wb = nouveauClasseur();
    feuilleEquipements(wb, [eq("RPN_HTB_DIFF_TR", "HTB")]);
    feuilleEs(wb, "HTB_TR1", [
      es("SICAM 7XV5674", "PROTECTION TRANSFO DIF.", "E ANA", "NIVEAU HUILE", "Q 01"),
      es("SICAM 7XV5674", "PROTECTION TRANSFO DIF.", "E ANA", "TEMPERATURE", "q  01"),
      es("RPN_HTB / IO203", "PROTECTION TRANSFO DIF.", "E TOR", "BUCHHOLZ", "BI 1.01"),
      es("RPN_HTB / PS050", "PROTECTION TRANSFO BOBINE POINT NEUTRE", "E TOR", "DISJONCTEUR TR1 OUVERT", "BI 1.01"),
    ]);
    const l = await lire(wb);
    const f = feuille(l, "HTB_TR1");
    expect(f.points).toHaveLength(4); // un doublon est signalé mais importé
    expect(f.groupesTag).toEqual(["PROTECTION TRANSFO DIF.", "PROTECTION TRANSFO BOBINE POINT NEUTRE"]);
    expect(l.anomalies.map((a) => [a.code, a.severite, a.ligne])).toEqual([
      ["adresse_en_double", "avertissement", 8],
      ["feuille_multi_equipements", "info", null],
    ]);
    expect(l.anomalies[0]!.message).toBe("Adresse « q 01 » en double pour « PROTECTION TRANSFO DIF. » (déjà ligne 7).");
  });

  it("doublon sur deux cartes différentes : la carte est précisée dans le message", async () => {
    const wb = nouveauClasseur();
    feuilleEquipements(wb, [eq("RPN_HTA_F1", "TYPE BATTERIE")]);
    feuilleEs(wb, "TYPE BATTERIE", [
      es("IO203", "-", "E ANA", "COURANT", "I1"),
      es("IO202", "-", "E ANA", "AUTRE COURANT", "I1"),
    ]);
    const l = await lire(wb);
    expect(l.anomalies[0]!.message).toBe("Adresse « I1 » en double (déjà ligne 7, carte IO203 ; ici carte IO202).");
  });

  it("erreur si le classeur ne contient aucune feuille d'E/S", async () => {
    const wb = nouveauClasseur();
    feuilleEquipements(wb, [eq("RPN_HTA_F1", "TYPE BATTERIE")]);
    const rev = wb.addWorksheet("REV");
    rev.getCell("C10").value = "Rev";
    rev.getCell("D10").value = "Statut";
    const l = await lire(wb);
    expect(l.feuilles).toEqual([]);
    expect(codes(l, "erreur")).toEqual(["aucune_feuille_es"]);
  });

  it("rejette un fichier qui n'est pas un classeur Excel", async () => {
    await expect(lireListeEs(new TextEncoder().encode("pas un xlsx"))).rejects.toThrow();
  });
});
