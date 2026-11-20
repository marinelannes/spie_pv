import { describe, expect, it } from "vitest";
import { loginRequestSchema } from "./auth.js";
import { libelleCheminPv, valeurLisible } from "./pv-libelles.js";
import { creerPvRelais, modelePvEquipement, nouvelleFonction } from "./pv-modele-relais.js";
import type { PvRelaisData } from "./pv-relais.js";
import { STATUTS_SUIVI, statutSuivi } from "./pv-statuts.js";

const CTX = {
  affaire: { numero: "A35173", client: "HUAWEI", projet: "GAU11", valideParDefaut: "F. BUCAU", approuveParDefaut: "" },
  date: "2026-11-19",
};

function pv(): PvRelaisData {
  const d = creerPvRelais(CTX);
  d.fonctions = [{ ...nouvelleFonction(), id: "f1", nomLogique: "PHPTOC1", reglages: "6250A" }];
  d.es.points = [
    {
      id: "p1",
      carte: "RPN_HTA / PS050_1",
      tag: "-",
      adresse: "BI 1.01",
      type: "entree_tor",
      designation: "SURVEILLANCE CIRCUIT DECLENCHEMENT",
      reserve: false,
      teste: null,
      leds: null,
      relais: null,
      scada: null,
      message: "",
      commentaire: "",
      saisie: null,
    },
  ];
  return d;
}

describe("libelleCheminPv : chemin technique → libellé du back-office (anomalie 10)", () => {
  it.each([
    ["revisions[0].ecritPar", "Tableau des révisions — Rév. A — Écrit par"],
    ["fonctions[f1].reglages", "Plan de protection — PHPTOC1 — Réglages"],
    ["identification[modele].valeur", "Identification du relais — Numéro du modèle — Valeur"],
    ["generalites.lieu", "Généralités — Lieu des tests"],
    ["es.points[p1].designation", "Affectation cartes E/S — BI 1.01 SURVEILLANCE CIRCUIT DECLENCHEMENT — Désignation"],
    ["entete.client", "En-tête — Client"],
    ["fonctions[inconnue].reglages", "Plan de protection — inconnue — Réglages"],
    ["revisions[3]", "Tableau des révisions — n°4"],
    ["champInconnu.sousChamp", "Champ inconnu — Sous champ"],
  ])("%s", (chemin, attendu) => {
    expect(libelleCheminPv(chemin, pv())).toBe(attendu);
  });
});

describe("valeurLisible : plus de JSON brut", () => {
  it("textes, nombres à virgule, booléens, vides", () => {
    expect(valeurLisible("6250A")).toBe("6250A");
    expect(valeurLisible(0.5)).toBe("0,5");
    expect(valeurLisible(true)).toBe("Oui");
    expect(valeurLisible(null)).toBe("—");
    expect(valeurLisible("")).toBe("—");
    expect(valeurLisible([])).toBe("—");
  });

  it("phaseur, objet (sans id ni champ vide) et liste", () => {
    expect(valeurLisible({ amplitude: 57.7, angle: -120 })).toBe("57,7 ∠ -120°");
    expect(valeurLisible({ amplitude: null, angle: null })).toBe("—");
    expect(
      valeurLisible({
        id: "r1",
        indice: "A",
        date: "2026-11-19",
        ecritPar: "",
        validePar: "F. BUCAU",
        approuvePar: "",
      }),
    ).toBe("Indice : A\nDate : 2026-11-19\nValidé par : F. BUCAU");
    expect(valeurLisible([{ fr: "Contrôle fil à fil", en: "" }, "x"])).toBe("Texte : Contrôle fil à fil\nx");
  });
});

describe("modelePvEquipement (spec §4.5, anomalie 7)", () => {
  it("relais de protection : modèle relais ; régulateur de tension : aucun modèle", () => {
    expect(modelePvEquipement({ tag: "RPN_HTA_F1", libelle: "RELAIS DE PROTECTION NUMERIQUE DEPART F1" })).toBe(
      "relais",
    );
    expect(modelePvEquipement({ tag: "RPN_HTB_DIFF_TR", libelle: "RELAIS PROTECTION NUMERIQUE" })).toBe("relais");
    expect(
      modelePvEquipement({ tag: "RGU_HTB_TR", libelle: "REGULATEUR DE TENSION HTB TRANCHE TRANSFO TR1" }),
    ).toBeNull();
    expect(modelePvEquipement({ tag: "X1", libelle: "Régulateur de tension" })).toBeNull();
    // Règle étroite : un TAG qui contient « RGU » sans en commencer reste un relais.
    expect(modelePvEquipement({ tag: "RPN_RGU_1", libelle: "RELAIS" })).toBe("relais");
  });
});

describe("statutSuivi (anomalie 8)", () => {
  it("un PV préparé dont la saisie a commencé est « en cours de saisie » au bureau", () => {
    expect(statutSuivi({ statut: "prepare", saisieCommenceeLe: null })).toBe("prepare");
    expect(statutSuivi({ statut: "prepare", saisieCommenceeLe: "2026-11-19T15:00:00Z" })).toBe("brouillon");
    expect(statutSuivi({ statut: "recu", saisieCommenceeLe: new Date() })).toBe("recu");
    expect(STATUTS_SUIVI).not.toContain("signe");
  });
});

describe("connexion : e-mail vide (anomalie 21)", () => {
  it("« Adresse e-mail requise. » si vide, « invalide » si mal formée", () => {
    const premier = (email: string) => loginRequestSchema.safeParse({ email, password: "x" }).error?.issues[0]?.message;
    expect(premier("")).toBe("Adresse e-mail requise.");
    expect(premier("   ")).toBe("Adresse e-mail requise.");
    expect(premier("theo@")).toBe("Adresse e-mail invalide.");
    expect(loginRequestSchema.parse({ email: " Theo@SPIE.local ", password: "x" }).email).toBe("theo@spie.local");
  });
});
