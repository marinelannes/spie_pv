import type { ListeEsLue } from "@spie/shared";
import { describe, expect, it } from "vitest";
import { analyserImport, associationsAReprendre, proposerAssociations } from "../src/index.js";

const point = (ligne: number, tag: string, reserve = false) => ({
  ligne,
  carte: "C1",
  tag,
  typeBrut: "E TOR",
  type: "entree_tor" as const,
  designation: reserve ? "RESERVE" : "X",
  adresse: `BI 1.0${ligne}`,
  reserve,
});

const equipement = (ligne: number, tag: string, typeCellule: string) => ({
  ligne,
  libelle: `RELAIS ${tag}`,
  niveauTension: "HTA",
  typeCellule,
  tag,
  equipement: "",
  modele: "",
  local: "",
  tagArmoire: "",
  referenceConstructeur: "",
});

function liste(): ListeEsLue {
  return {
    reference: "GAU11_AUT_009",
    revision: "B",
    numeroAffaire: "A35173",
    equipements: [
      equipement(7, "RPN_HTA_F1", "type batterie"),
      equipement(8, "RGU_HTB_TR", ""),
      equipement(9, "RPN_HTB_DIFF_TR", "HTB"),
      equipement(10, "RPN_HTB_MCN_TR", "HTB"),
    ],
    feuilles: [
      {
        nom: "TYPE BATTERIE",
        titre: "TYPE DEPART BATTERIE",
        points: [point(1, "-"), point(2, "-", true)],
        groupesTag: [],
      },
      {
        nom: "HTB_TR1",
        titre: "TRANCHE TR1",
        points: [point(1, "PROTECTION TRANSFO DIF."), point(2, "PROTECTION TRANSFO BOBINE POINT NEUTRE", true)],
        groupesTag: ["PROTECTION TRANSFO DIF.", "PROTECTION TRANSFO BOBINE POINT NEUTRE"],
      },
      {
        nom: "HTB_RGU",
        titre: "REGULATEUR",
        points: [point(1, "REGULATEUR DE TENSION")],
        groupesTag: ["REGULATEUR DE TENSION"],
      },
    ],
    anomalies: [],
  };
}

describe("proposerAssociations", () => {
  it("associe automatiquement par TYPE CELLULE (sans tenir compte de la casse) ; sinon aucune feuille, avec avertissement", () => {
    const { associations, anomalies } = proposerAssociations(liste());
    expect(associations).toEqual([
      { tag: "RPN_HTA_F1", feuille: "TYPE BATTERIE", filtreTag: null, mode: "auto" },
      { tag: "RGU_HTB_TR", feuille: null, filtreTag: null, mode: "aucune" },
      { tag: "RPN_HTB_DIFF_TR", feuille: null, filtreTag: null, mode: "aucune" },
      { tag: "RPN_HTB_MCN_TR", feuille: null, filtreTag: null, mode: "aucune" },
    ]);
    expect(anomalies.map((a) => [a.code, a.severite, a.ligne, a.message])).toEqual([
      ["equipement_sans_feuille", "avertissement", 8, "RGU_HTB_TR : TYPE CELLULE vide : choisir la feuille d'E/S."],
      [
        "equipement_sans_feuille",
        "avertissement",
        9,
        "RPN_HTB_DIFF_TR : aucune feuille « HTB » (TYPE CELLULE) : choisir la feuille d'E/S.",
      ],
      [
        "equipement_sans_feuille",
        "avertissement",
        10,
        "RPN_HTB_MCN_TR : aucune feuille « HTB » (TYPE CELLULE) : choisir la feuille d'E/S.",
      ],
    ]);
    expect(anomalies.every((a) => a.feuille === "LISTE DES EQUIPEMENTS")).toBe(true);
  });

  it("applique les choix du préparateur (feuille et filtre TAG), y compris à la place d'une association automatique", () => {
    const { associations, anomalies } = proposerAssociations(liste(), [
      { tag: "rpn_hta_f1", feuille: "HTB_TR1", filtreTag: "PROTECTION TRANSFO DIF." },
      { tag: "RGU_HTB_TR", feuille: "htb_rgu" },
      { tag: "RPN_HTB_DIFF_TR", feuille: "HTB_TR1", filtreTag: "PROTECTION TRANSFO DIF." },
      { tag: "RPN_HTB_MCN_TR", feuille: "HTB_TR1", filtreTag: "  PROTECTION TRANSFO BOBINE POINT NEUTRE " },
      { tag: "INCONNU", feuille: "HTB_TR1" },
    ]);
    expect(associations).toEqual([
      { tag: "RPN_HTA_F1", feuille: "HTB_TR1", filtreTag: "PROTECTION TRANSFO DIF.", mode: "manuel" },
      { tag: "RGU_HTB_TR", feuille: "HTB_RGU", filtreTag: null, mode: "manuel" },
      { tag: "RPN_HTB_DIFF_TR", feuille: "HTB_TR1", filtreTag: "PROTECTION TRANSFO DIF.", mode: "manuel" },
      {
        tag: "RPN_HTB_MCN_TR",
        feuille: "HTB_TR1",
        filtreTag: "PROTECTION TRANSFO BOBINE POINT NEUTRE",
        mode: "manuel",
      },
    ]);
    expect(anomalies).toEqual([]);
  });

  it("feuille inconnue : erreur ; filtre TAG absent de la feuille : avertissement ; aucune feuille choisie : avertissement", () => {
    const { associations, anomalies } = proposerAssociations(liste(), [
      { tag: "RPN_HTA_F1", feuille: "TYPE INEXISTANT" },
      { tag: "RPN_HTB_DIFF_TR", feuille: "HTB_TR1", filtreTag: "AUTRE" },
      { tag: "RGU_HTB_TR", feuille: null },
      { tag: "RPN_HTB_MCN_TR", feuille: "HTB_TR1", filtreTag: "   " },
    ]);
    expect(associations.map((a) => [a.tag, a.feuille, a.filtreTag, a.mode])).toEqual([
      ["RPN_HTA_F1", null, null, "aucune"],
      ["RGU_HTB_TR", null, null, "aucune"],
      ["RPN_HTB_DIFF_TR", "HTB_TR1", "AUTRE", "manuel"],
      ["RPN_HTB_MCN_TR", "HTB_TR1", null, "manuel"],
    ]);
    expect(anomalies.map((a) => [a.code, a.severite, a.message])).toEqual([
      ["feuille_inconnue", "erreur", "RPN_HTA_F1 : la feuille « TYPE INEXISTANT » n'existe pas dans le fichier."],
      ["equipement_sans_feuille", "avertissement", "RGU_HTB_TR : aucune feuille d'E/S choisie."],
      [
        "filtre_tag_inconnu",
        "avertissement",
        "RPN_HTB_DIFF_TR : le filtre TAG « AUTRE » n'existe pas dans la feuille « HTB_TR1 » : aucune E/S retenue.",
      ],
    ]);
  });

  it("reprend les choix manuels de la version précédente ; un choix de l'import en cours l'emporte", () => {
    const precedentes = [
      { tag: "RGU_HTB_TR", feuille: "HTB_RGU", filtreTag: null },
      { tag: "RPN_HTB_DIFF_TR", feuille: "htb_tr1", filtreTag: "PROTECTION TRANSFO DIF." },
      { tag: "RPN_HTB_MCN_TR", feuille: "HTB_TR1", filtreTag: "PROTECTION TRANSFO BOBINE POINT NEUTRE" },
    ];
    const { associations, anomalies } = proposerAssociations(
      liste(),
      [{ tag: "RPN_HTB_MCN_TR", feuille: "HTB_TR1", filtreTag: null }],
      precedentes,
    );
    expect(associations).toEqual([
      { tag: "RPN_HTA_F1", feuille: "TYPE BATTERIE", filtreTag: null, mode: "auto" },
      { tag: "RGU_HTB_TR", feuille: "HTB_RGU", filtreTag: null, mode: "reprise" },
      { tag: "RPN_HTB_DIFF_TR", feuille: "HTB_TR1", filtreTag: "PROTECTION TRANSFO DIF.", mode: "reprise" },
      { tag: "RPN_HTB_MCN_TR", feuille: "HTB_TR1", filtreTag: null, mode: "manuel" },
    ]);
    expect(anomalies).toEqual([]);
  });

  it("feuille précédente disparue : un seul avertissement, puis règle automatique ; filtre disparu : avertissement", () => {
    const l = liste();
    l.feuilles = l.feuilles.filter((f) => f.nom !== "HTB_RGU");
    const { associations, anomalies } = proposerAssociations(l, undefined, [
      { tag: "RPN_HTA_F1", feuille: "ANCIENNE FEUILLE", filtreTag: null },
      { tag: "RGU_HTB_TR", feuille: "HTB_RGU", filtreTag: null },
      { tag: "RPN_HTB_DIFF_TR", feuille: "HTB_TR1", filtreTag: "GROUPE SUPPRIME" },
    ]);
    expect(associations.map((a) => [a.tag, a.feuille, a.filtreTag, a.mode])).toEqual([
      ["RPN_HTA_F1", "TYPE BATTERIE", null, "auto"],
      ["RGU_HTB_TR", null, null, "aucune"],
      ["RPN_HTB_DIFF_TR", "HTB_TR1", "GROUPE SUPPRIME", "reprise"],
      ["RPN_HTB_MCN_TR", null, null, "aucune"],
    ]);
    expect(anomalies.map((a) => [a.code, a.severite, a.ligne, a.message])).toEqual([
      [
        "feuille_precedente_absente",
        "avertissement",
        7,
        "RPN_HTA_F1 : la feuille « ANCIENNE FEUILLE » associée dans la version précédente n'existe plus : choisir la feuille d'E/S.",
      ],
      [
        "feuille_precedente_absente",
        "avertissement",
        8,
        "RGU_HTB_TR : la feuille « HTB_RGU » associée dans la version précédente n'existe plus : choisir la feuille d'E/S.",
      ],
      [
        "filtre_tag_inconnu",
        "avertissement",
        9,
        "RPN_HTB_DIFF_TR : le filtre TAG « GROUPE SUPPRIME » n'existe pas dans la feuille « HTB_TR1 » : aucune E/S retenue.",
      ],
      [
        "equipement_sans_feuille",
        "avertissement",
        10,
        "RPN_HTB_MCN_TR : aucune feuille « HTB » (TYPE CELLULE) : choisir la feuille d'E/S.",
      ],
    ]);
  });

  it("refuse un choix mal formé", () => {
    let erreur: unknown = null;
    try {
      proposerAssociations(liste(), [{ tag: " ", feuille: "HTB_TR1" }]);
    } catch (e) {
      erreur = e;
    }
    expect((erreur as Error | null)?.name).toBe("ZodError");
  });
});

describe("associationsAReprendre", () => {
  it("ne garde que les choix manuels : feuille autre que le TYPE CELLULE, ou restreinte à un groupe TAG", () => {
    expect(
      associationsAReprendre([
        { tag: "RPN_HTA_F1", typeCellule: "type batterie", feuille: "TYPE BATTERIE", filtreTag: null },
        { tag: "RPN_HTA_F2", typeCellule: "TYPE BATTERIE", feuille: "TYPE TR AUX", filtreTag: null },
        { tag: "RGU_HTB_TR", typeCellule: "", feuille: "HTB_RGU", filtreTag: null },
        { tag: "RPN_HTB_MCN_TR", typeCellule: "HTB", feuille: "HTB_TR1", filtreTag: "PROTECTION TRANSFO BOBINE" },
        { tag: "RPN_HTB_GRP", typeCellule: "HTB_TR1", feuille: "HTB_TR1", filtreTag: "GROUPE" },
        { tag: "RPN_HTB_DIFF_TL", typeCellule: "HTB", feuille: null, filtreTag: null },
      ]),
    ).toEqual([
      { tag: "RPN_HTA_F2", feuille: "TYPE TR AUX", filtreTag: null },
      { tag: "RGU_HTB_TR", feuille: "HTB_RGU", filtreTag: null },
      { tag: "RPN_HTB_MCN_TR", feuille: "HTB_TR1", filtreTag: "PROTECTION TRANSFO BOBINE" },
      { tag: "RPN_HTB_GRP", feuille: "HTB_TR1", filtreTag: "GROUPE" },
    ]);
  });
});

describe("analyserImport", () => {
  it("résume les feuilles, rattache l'association à chaque équipement et cumule les anomalies", () => {
    const l = liste();
    l.anomalies.push({
      code: "colonne_sans_en_tete",
      severite: "info",
      feuille: "TYPE BATTERIE",
      ligne: 6,
      message: "x",
    });
    const a = analyserImport(l, "GAU11_AUT_009_LISTE ENTREES SORTIES RPN_B.xlsx");
    expect(a).toMatchObject({
      fichier: "GAU11_AUT_009_LISTE ENTREES SORTIES RPN_B.xlsx",
      reference: "GAU11_AUT_009",
      revision: "B",
      numeroAffaire: "A35173",
      bloquant: false,
    });
    expect(a.feuilles).toEqual([
      { nom: "TYPE BATTERIE", titre: "TYPE DEPART BATTERIE", nbPoints: 2, nbReserves: 1, groupesTag: [] },
      {
        nom: "HTB_TR1",
        titre: "TRANCHE TR1",
        nbPoints: 2,
        nbReserves: 1,
        groupesTag: ["PROTECTION TRANSFO DIF.", "PROTECTION TRANSFO BOBINE POINT NEUTRE"],
      },
      { nom: "HTB_RGU", titre: "REGULATEUR", nbPoints: 1, nbReserves: 0, groupesTag: ["REGULATEUR DE TENSION"] },
    ]);
    expect(a.equipements[0]).toMatchObject({
      tag: "RPN_HTA_F1",
      libelle: "RELAIS RPN_HTA_F1",
      association: { feuille: "TYPE BATTERIE", mode: "auto" },
    });
    expect(a.anomalies.map((x) => x.code)).toEqual([
      "colonne_sans_en_tete",
      "equipement_sans_feuille",
      "equipement_sans_feuille",
      "equipement_sans_feuille",
    ]);
  });

  it("est bloquant dès qu'une anomalie est une erreur (lecture ou association)", () => {
    expect(analyserImport(liste(), "f.xlsx", [{ tag: "RPN_HTA_F1", feuille: "NON" }]).bloquant).toBe(true);
    const l = liste();
    l.anomalies.push({ code: "affaire_differente", severite: "erreur", feuille: null, ligne: null, message: "x" });
    expect(analyserImport(l, "f.xlsx").bloquant).toBe(true);
  });
});
