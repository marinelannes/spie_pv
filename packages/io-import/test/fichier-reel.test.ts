import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pointsPourEquipement, type ListeEsLue } from "@spie/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { analyserImport, lireListeEs } from "../src/index.js";

/**
 * Liste E/S fournie par SPIE (affaire A35173, révision B), critère de fin du lot 1 : « La liste GAU11_AUT_009 est
 * importée ». Fichier client : il n'est pas copié dans le dépôt. Chemin par défaut : à côté du dossier spie-pv,
 * surchargeable par SPIE_IO_FIXTURE. Les tests sont sautés s'il est absent (CI).
 */
const FICHIER =
  process.env.SPIE_IO_FIXTURE ??
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../../GAU11_AUT_009_LISTE ENTREES SORTIES RPN_B.xlsx");
const present = existsSync(FICHIER);

describe.skipIf(!present)("liste E/S réelle GAU11_AUT_009 (rév. B)", () => {
  let lue: ListeEsLue;

  beforeAll(async () => {
    lue = await lireListeEs(new Uint8Array(readFileSync(FICHIER)), { numeroAffaireAttendu: "A35173" });
  });

  const feuille = (nom: string) => lue.feuilles.find((f) => f.nom === nom)!;

  it("référence, révision et affaire", () => {
    expect([lue.reference, lue.revision, lue.numeroAffaire]).toEqual(["GAU11_AUT_009", "B", "A35173"]);
  });

  it("12 équipements", () => {
    expect(lue.equipements.map((e) => e.tag)).toEqual([
      "RPN_HTA_TAUX_NORD",
      "RPN_HTA_TAUX_SUD",
      "RPN_HTA_F1",
      "RPN_HTA_F2",
      "RPN_HTA_F3",
      "RPN_HTA_F4",
      "RPN_HTA_F5",
      "RPN_HTA_AR_RTE",
      "RGU_HTB_TR",
      "RPN_HTB_MCN_TR",
      "RPN_HTB_DIFF_TR",
      "RPN_HTB_DIFF_TL",
    ]);
    expect(lue.equipements.find((e) => e.tag === "RPN_HTB_MCN_TR")).toMatchObject({
      libelle: "RELAIS PROTECTION NUMERIQUE PROTECTION BOBINE POINT NEUTRE",
      niveauTension: "HTB",
      typeCellule: "HTB",
      modele: "COMPACT - 7SX8000",
    });
  });

  it("6 feuilles d'E/S avec les volumes de la spec (annexe C)", () => {
    expect(lue.feuilles.map((f) => [f.nom, f.points.length])).toEqual([
      ["TYPE ARRIVEE TR1", 33],
      ["TYPE BATTERIE", 33],
      ["TYPE TR AUX", 33],
      ["HTB-TL", 104],
      ["HTB_TR1", 128],
      ["HTB_RGU", 35],
    ]);
  });

  it("E/S de réserve repérées (RESERVE, RESERVE CABLEE, avec ou sans accent)", () => {
    expect(lue.feuilles.map((f) => [f.nom, f.points.filter((p) => p.reserve).length])).toEqual([
      ["TYPE ARRIVEE TR1", 1],
      ["TYPE BATTERIE", 2],
      ["TYPE TR AUX", 1],
      ["HTB-TL", 69],
      ["HTB_TR1", 36],
      ["HTB_RGU", 11],
    ]);
  });

  it("types normalisés : tous reconnus, y compris la colonne « TAG RPN » de HTB_TR1", () => {
    const compte = (nom: string) => {
      const c: Record<string, number> = {};
      for (const p of feuille(nom).points) c[p.type!] = (c[p.type!] ?? 0) + 1;
      return c;
    };
    expect(compte("TYPE BATTERIE")).toEqual({ entree_tor: 17, sortie_tor: 8, entree_analogique: 8 });
    expect(compte("HTB-TL")).toEqual({ entree_tor: 51, sortie_tor: 46, entree_analogique: 7 });
    expect(compte("HTB_TR1")).toEqual({ entree_tor: 61, sortie_tor: 40, entree_analogique: 27 });
    expect(compte("HTB_RGU")).toEqual({ entree_tor: 22, sortie_tor: 13 });
  });

  it("HTB_TR1 décrit deux relais : la protection bobine point neutre (point ouvert n°10) y a 27 E/S", () => {
    const f = feuille("HTB_TR1");
    expect(f.groupesTag).toEqual(["PROTECTION TRANSFO DIF.", "PROTECTION TRANSFO BOBINE POINT NEUTRE"]);
    const mcn = pointsPourEquipement(f.points, "PROTECTION TRANSFO BOBINE POINT NEUTRE");
    expect(mcn).toHaveLength(27);
    expect(new Set(mcn.map((p) => p.carte))).toEqual(new Set(["RPN_HTB / PS050", "RPN_HTB / IO060"]));
    expect(pointsPourEquipement(f.points, "PROTECTION TRANSFO DIF.")).toHaveLength(101);
  });

  it("anomalies attendues", () => {
    const resume = lue.anomalies.map((a) => [a.severite, a.code, a.feuille, a.ligne]);
    expect(resume).toEqual([
      ["avertissement", "libelle_equipement_en_double", "LISTE DES EQUIPEMENTS", 13],
      ["info", "type_deduit", "HTB_TR1", 6],
      // I1 / I2 en double dans le groupe « PROTECTION TRANSFO DIF. » : cartes IO203 et IO202 différentes.
      ["avertissement", "adresse_en_double", "HTB_TR1", 106],
      ["avertissement", "adresse_en_double", "HTB_TR1", 107],
      ["info", "feuille_multi_equipements", "HTB_TR1", null],
    ]);
    expect(lue.anomalies[0]!.message).toContain("RPN_HTA_F4");
  });

  it("associations : automatiques pour les types HTA, à choisir pour les équipements HTB et le régulateur", () => {
    const a = analyserImport(lue, "GAU11_AUT_009_LISTE ENTREES SORTIES RPN_B.xlsx");
    expect(a.bloquant).toBe(false);
    expect(Object.fromEntries(a.equipements.map((e) => [e.tag, [e.association.feuille, e.association.mode]]))).toEqual({
      RPN_HTA_TAUX_NORD: ["TYPE TR AUX", "auto"],
      RPN_HTA_TAUX_SUD: ["TYPE TR AUX", "auto"],
      RPN_HTA_F1: ["TYPE BATTERIE", "auto"],
      RPN_HTA_F2: ["TYPE BATTERIE", "auto"],
      RPN_HTA_F3: ["TYPE BATTERIE", "auto"],
      RPN_HTA_F4: ["TYPE BATTERIE", "auto"],
      RPN_HTA_F5: ["TYPE BATTERIE", "auto"],
      RPN_HTA_AR_RTE: ["TYPE ARRIVEE TR1", "auto"],
      RGU_HTB_TR: [null, "aucune"],
      RPN_HTB_MCN_TR: [null, "aucune"],
      RPN_HTB_DIFF_TR: [null, "aucune"],
      RPN_HTB_DIFF_TL: [null, "aucune"],
    });
    expect(a.anomalies.filter((x) => x.code === "equipement_sans_feuille")).toHaveLength(4);
  });

  it("avec les choix du préparateur, plus aucun équipement sans feuille", () => {
    const a = analyserImport(lue, "f.xlsx", [
      { tag: "RGU_HTB_TR", feuille: "HTB_RGU" },
      { tag: "RPN_HTB_DIFF_TL", feuille: "HTB-TL" },
      { tag: "RPN_HTB_DIFF_TR", feuille: "HTB_TR1", filtreTag: "PROTECTION TRANSFO DIF." },
      { tag: "RPN_HTB_MCN_TR", feuille: "HTB_TR1", filtreTag: "PROTECTION TRANSFO BOBINE POINT NEUTRE" },
    ]);
    expect(a.anomalies.filter((x) => x.code === "equipement_sans_feuille")).toEqual([]);
    expect(a.bloquant).toBe(false);
  });

  it("refusé pour une autre affaire", async () => {
    const autre = await lireListeEs(new Uint8Array(readFileSync(FICHIER)), { numeroAffaireAttendu: "A00001" });
    expect(analyserImport(autre, "f.xlsx").bloquant).toBe(true);
  });
});
