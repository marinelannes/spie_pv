import { describe, expect, it } from "vitest";
import { ajouterObservation, controlesAvantSignature, recapReserves, reserveSupprimable } from "./pv-controles.js";
import { creerPvRelais } from "./pv-modele-relais.js";
import { valeursPrepareesModifiees } from "./pv-modifications.js";
import type { PvRelaisData } from "./pv-relais.js";
import {
  annulerLevee,
  baseSuiviRevision,
  comparerIndices,
  controlesRevision,
  creerRevisionSuivante,
  estRevision,
  indiceSuivant,
  leveeAnnulable,
  leverReserve,
  reserveEnRetard,
  reserveHeritee,
  trierParIndice,
  versionCourante,
} from "./pv-revisions.js";

const PNG = "data:image/png;base64,AAAA";

/** Révision A signée, avec une réserve ouverte. */
function revisionA(): PvRelaisData {
  const d = creerPvRelais({
    affaire: {
      numero: "A00001",
      client: "Client",
      projet: "Projet",
      valideParDefaut: "V. VALIDEUR",
      approuveParDefaut: "A. APPROBATEUR",
    },
    es: null,
    date: "2026-11-19",
  });
  const avecReserve = ajouterObservation(
    d,
    { ref: null, libelle: "Repérage", jugement: "NC", observation: "Étiquettes manquantes.", reserve: {} },
    () => "r1",
  );
  return {
    ...avecReserve,
    entete: { ...avecReserve.entete, statutDocument: "BPO" },
    revisions: avecReserve.revisions.map((r) => ({ ...r, ecritPar: "Théo" })),
    conclusion: { materiel: "accepte" },
    signatures: {
      spie: { nom: "Théo", date: "2026-11-19", signature: PNG, commentaires: "" },
      client: { nom: "Client", date: "2026-11-19", signature: PNG, commentaires: "vu", refus: null },
    },
  };
}

const revisionB = (a = revisionA()) =>
  creerRevisionSuivante(a, { indice: "B", date: "2026-12-01", modifications: " Levée de la réserve n°1 " });

describe("indice suivant", () => {
  it("A → B … Y → Z, puis plus rien", () => {
    expect(indiceSuivant("A")).toBe("B");
    expect(indiceSuivant("Y")).toBe("Z");
    expect(indiceSuivant("Z")).toBeNull();
    expect(indiceSuivant("")).toBeNull();
    expect(indiceSuivant("a")).toBeNull();
    expect(indiceSuivant("AA")).toBeNull();
  });
});

describe("création de la révision suivante (spec §3.4)", () => {
  it("reprend les données, vide les signatures et le statut, ajoute une ligne au tableau des révisions", () => {
    const a = revisionA();
    const b = revisionB(a);
    expect(b.entete).toEqual({ ...a.entete, indice: "B", statutDocument: null });
    expect(b.signatures.spie).toEqual({ nom: "", date: "", signature: null, commentaires: "" });
    expect(b.signatures.client).toEqual({ nom: "", date: "", signature: null, commentaires: "", refus: null });
    expect(b.revisions).toEqual([
      a.revisions[0],
      {
        indice: "B",
        date: "2026-12-01",
        ecritPar: "",
        validePar: "V. VALIDEUR",
        approuvePar: "A. APPROBATEUR",
        modifications: "Levée de la réserve n°1",
      },
    ]);
    expect(b.conclusion).toEqual(a.conclusion);
    expect(b.reserves).toEqual(a.reserves);
    expect(b.observations).toEqual(a.observations);
    expect(estRevision(a)).toBe(false);
    expect(estRevision(b)).toBe(true);
  });

  it("ne partage aucune référence avec la révision précédente", () => {
    const a = revisionA();
    const b = revisionB(a);
    b.reserves[0]!.description = "modifiée";
    expect(a.reserves[0]!.description).toBe("Étiquettes manquantes.");
  });

  it("la description de la modification est exigée avant la signature d'une révision", () => {
    const b = creerRevisionSuivante(revisionA(), { indice: "B", date: "2026-12-01", modifications: "" });
    expect(controlesAvantSignature(b).map((m) => m.ref)).toContain("revisions.modifications");
    expect(controlesAvantSignature(revisionB()).map((m) => m.ref)).not.toContain("revisions.modifications");
  });
});

describe("levée de réserve (spec §4.3)", () => {
  it("date, commentaire et indice de la révision qui lève", () => {
    const b = revisionB();
    const leve = leverReserve(b, b.reserves[0]!.id, { date: "2026-12-01", commentaire: "Fait." });
    expect(leve.reserves[0]).toMatchObject({
      statut: "levee",
      indiceCreation: "A",
      levee: { date: "2026-12-01", commentaire: "Fait.", indice: "B" },
    });
    expect(recapReserves(leve)).toEqual({ ouvertes: 0, levees: 1 });
    // Déjà levée : rien ne change.
    expect(leverReserve(leve, b.reserves[0]!.id, { date: "2027-01-01" })).toEqual(leve);
  });

  it("une réserve héritée ne se supprime pas ; sa levée s'annule seulement dans la révision qui l'a prononcée", () => {
    const b = revisionB();
    const r = b.reserves[0]!;
    expect(reserveHeritee(b, r)).toBe(true);
    expect(reserveSupprimable(b, r)).toBe(false);
    const leve = leverReserve(b, r.id, { date: "2026-12-01" });
    expect(leveeAnnulable(leve, leve.reserves[0]!)).toBe(true);
    expect(annulerLevee(leve, r.id).reserves[0]).toMatchObject({ statut: "ouverte", levee: null });

    const c = creerRevisionSuivante(leve, { indice: "C", date: "2027-01-10", modifications: "Autre" });
    expect(leveeAnnulable(c, c.reserves[0]!)).toBe(false);
    expect(annulerLevee(c, r.id)).toEqual(c);
  });

  it("une levée sans date bloque la signature", () => {
    const b = revisionB();
    const leve = leverReserve(b, b.reserves[0]!.id, { date: "" });
    expect(controlesAvantSignature(leve).map((m) => m.message)).toContain(
      "Réserve n°1 : date de levée non renseignée.",
    );
  });

  it("en retard : ouverte et date prévue dépassée", () => {
    expect(reserveEnRetard({ statut: "ouverte", datePrevue: "2026-11-25" }, "2026-12-01")).toBe(true);
    expect(reserveEnRetard({ statut: "ouverte", datePrevue: "2026-12-01" }, "2026-12-01")).toBe(false);
    expect(reserveEnRetard({ statut: "ouverte", datePrevue: "" }, "2026-12-01")).toBe(false);
    expect(reserveEnRetard({ statut: "levee", datePrevue: "2026-11-25" }, "2026-12-01")).toBe(false);
  });
});

describe("intégrité d'une révision face à la précédente", () => {
  it("accepte la révision reprise telle quelle, une levée et une nouvelle réserve", () => {
    const a = revisionA();
    const b = revisionB(a);
    expect(controlesRevision(a, b)).toEqual([]);
    const leve = leverReserve(b, b.reserves[0]!.id, { date: "2026-12-01" });
    const plus = ajouterObservation(
      leve,
      { ref: null, libelle: "Autre", jugement: "NC", observation: "Nouveau défaut.", reserve: {} },
      () => "r2",
    );
    expect(plus.reserves[1]).toMatchObject({ numero: 2, indiceCreation: "B" });
    expect(controlesRevision(a, plus)).toEqual([]);
  });

  it("signale une réserve disparue, une révision signée réécrite, un indice incohérent", () => {
    const a = revisionA();
    const b = revisionB(a);
    expect(controlesRevision(a, { ...b, reserves: [] })[0]).toContain("réserve n°1");
    expect(
      controlesRevision(a, {
        ...b,
        revisions: b.revisions.map((r, i) => (i === 0 ? { ...r, date: "2020-01-01" } : r)),
      }),
    ).toEqual(["Les lignes des révisions précédentes ont été modifiées dans le tableau des révisions."]);
    expect(controlesRevision(a, { ...b, revisions: a.revisions })[0]).toContain("tableau des révisions");
    expect(controlesRevision(a, { ...b, entete: { ...b.entete, indice: "C" } })[0]).toContain("ne suit pas");
    const mauvaiseLevee = {
      ...b,
      reserves: b.reserves.map((r) => ({
        ...r,
        statut: "levee" as const,
        levee: { date: "2026-12-01", commentaire: "", indice: "A" },
      })),
    };
    expect(controlesRevision(a, mauvaiseLevee)[0]).toContain("l'indice de levée doit être B");
  });

  it("une levée prononcée dans une révision signée ne se modifie plus", () => {
    const b = leverReserve(revisionB(), "r1", { date: "2026-12-01", commentaire: "Fait." });
    const id = b.reserves[0]!.id;
    const levee = leverReserve(revisionB(), id, { date: "2026-12-01", commentaire: "Fait." });
    const c = creerRevisionSuivante(levee, { indice: "C", date: "2027-01-10", modifications: "Autre" });
    expect(controlesRevision(levee, c)).toEqual([]);
    const rouverte = { ...c, reserves: c.reserves.map((r) => ({ ...r, statut: "ouverte" as const, levee: null })) };
    expect(controlesRevision(levee, rouverte)[0]).toContain("a été modifiée");
    expect(b.reserves).toHaveLength(1);
  });
});

describe("valeurs modifiées dans une révision", () => {
  it("la base de comparaison est la préparation d'origine, pas les saisies de site reprises", () => {
    const preparees = revisionA();
    // État préparé au bureau : ni statut, ni signataire, ni signatures, ni saisies de site.
    const prepareesA: PvRelaisData = {
      ...preparees,
      entete: { ...preparees.entete, statutDocument: null },
      revisions: preparees.revisions.map((r) => ({ ...r, ecritPar: "" })),
      generalites: { ...preparees.generalites, lieu: "Poste DEMO1" },
      observations: [],
      reserves: [],
      conclusion: { materiel: null },
      signatures: {
        spie: { nom: "", date: "", signature: null, commentaires: "" },
        client: { nom: "", date: "", signature: null, commentaires: "", refus: null },
      },
    };
    const b = revisionB({ ...preparees, generalites: { ...preparees.generalites, lieu: "Poste DEMO1" } });
    const base = baseSuiviRevision(prepareesA, "B")!;
    expect(base.entete.indice).toBe("B");

    // Lever une réserve, compléter une observation, changer la conclusion : saisies de site, non signalées.
    const leve = leverReserve(b, b.reserves[0]!.id, { date: "2026-12-01", commentaire: "Fait." });
    const complete: PvRelaisData = {
      ...leve,
      observations: leve.observations.map((o) => ({ ...o, observation: `${o.observation} Corrigé.` })),
      conclusion: { materiel: "refuse" },
    };
    expect(valeursPrepareesModifiees(base, complete).map((m) => m.chemin)).toEqual([]);
    // Une valeur préparée au bureau et corrigée reste signalée.
    const corrige = { ...complete, generalites: { ...complete.generalites, lieu: "Autre poste" } };
    expect(valeursPrepareesModifiees(base, corrige).map((m) => m.chemin)).toEqual(["generalites.lieu"]);
    // PV créé sur site : rien n'a été préparé, rien n'est suivi.
    expect(baseSuiviRevision(null, "B")).toBeNull();
  });

  it("indices : ordre, tri et révision courante", () => {
    const vs = [{ indice: "B" }, { indice: "A" }, { indice: "C" }];
    expect(comparerIndices("A", "B")).toBeLessThan(0);
    expect(comparerIndices("B", "B")).toBe(0);
    expect(trierParIndice(vs).map((v) => v.indice)).toEqual(["A", "B", "C"]);
    expect(vs.map((v) => v.indice)).toEqual(["B", "A", "C"]);
    expect(versionCourante(vs)).toEqual({ indice: "C" });
    expect(versionCourante([])).toBeUndefined();
  });
});
