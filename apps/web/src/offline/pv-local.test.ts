import { empreintePv, type PvRelaisData } from "@spie/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AFFAIRE, EQ_DIFF, EQ_MCN, EQ_REGULATEUR, EQ_SANS, LOCAL_AFFAIRE, completer, syncPv } from "../test/fixtures";
import {
  baseUtilisateur,
  creerBase,
  fermerBases,
  lireMeta,
  majMeta,
  nomBaseUtilisateur,
  type LocalPv,
  type UserDb,
} from "./db";
import {
  PvLocalError,
  avecEcritPar,
  construirePvDocument,
  creationSurSite,
  creerPvSurSite,
  enregistrerDonnees,
  esPourEquipement,
  listeEsObsolete,
  manquantsBloquants,
  ouvrirPvPrepare,
  signerPv,
  supprimerBrouillonSite,
  type Horloge,
} from "./pv-local";
import { fusionnerReference } from "./sync";

let db: UserDb;
let n = 0;
beforeEach(async () => {
  db = creerBase(`test-pv-local-${++n}`);
  await db.open();
});
afterEach(async () => {
  db.close();
  await db.delete();
  fermerBases();
});

/** Horloge simulée : `attendre` avance le temps. */
function horloge(iso: string): Horloge & { t: number; attentes: number[] } {
  const h = {
    t: new Date(iso).getTime(),
    attentes: [] as number[],
    now: () => new Date(h.t),
    attendre: async (ms: number) => {
      h.attentes.push(ms);
      h.t += ms;
    },
  };
  return h;
}

async function pvPrepareLocal(): Promise<LocalPv> {
  const f = fusionnerReference([], [syncPv()], "2026-11-19T08:00:00.000Z");
  await db.pvs.bulkAdd(f.aAjouter);
  return f.aAjouter[0]!;
}

describe("base locale", () => {
  it("une base par utilisateur, instance partagée", () => {
    expect(nomBaseUtilisateur("u1")).toBe("spie-pv-u1");
    const a = baseUtilisateur("u1");
    expect(baseUtilisateur("u1")).toBe(a);
    expect(baseUtilisateur("u2")).not.toBe(a);
    expect(a.name).toBe("spie-pv-u1");
  });

  it("lireMeta crée l'identifiant de tablette une seule fois ; majMeta le conserve", async () => {
    const m1 = await lireMeta(db);
    expect(m1.tabletteId).toMatch(/^[0-9a-f-]{36}$/);
    expect(m1).toMatchObject({ derniereSynchro: null, dernierNumeroLe: null });
    const m2 = await majMeta(db, { derniereSynchro: "2026-11-19T08:00:00.000Z" });
    expect(m2.tabletteId).toBe(m1.tabletteId);
    expect((await lireMeta(db)).derniereSynchro).toBe("2026-11-19T08:00:00.000Z");
  });
});

describe("esPourEquipement", () => {
  it("prend la feuille de l'équipement et applique son filtre TAG", () => {
    const es = esPourEquipement(LOCAL_AFFAIRE, EQ_MCN.id)!;
    expect(es).toMatchObject({
      feuille: "HTB_TR1",
      filtreTag: "PROTECTION TRANSFO BOBINE POINT NEUTRE",
      listeVersion: 2,
    });
    expect(es.points.map((p) => p.designation)).toEqual(["DEFAUT BOBINE"]);
    expect(esPourEquipement(LOCAL_AFFAIRE, EQ_DIFF.id)!.points).toHaveLength(2);
  });

  it("null sans feuille, sans liste ou pour un équipement inconnu", () => {
    expect(esPourEquipement(LOCAL_AFFAIRE, EQ_SANS.id)).toBeNull();
    expect(esPourEquipement({ ...LOCAL_AFFAIRE, liste: null }, EQ_DIFF.id)).toBeNull();
    expect(esPourEquipement(LOCAL_AFFAIRE, "inconnu")).toBeNull();
  });
});

describe("creerPvSurSite (spec §3.2, §4.1)", () => {
  it("numérote sans réseau, pré-remplit seulement les E/S et ouvre en brouillon", async () => {
    const h = horloge("2026-11-19T13:32:05.300Z");
    const pv = await creerPvSurSite(db, { affaire: LOCAL_AFFAIRE, equipementId: EQ_DIFF.id, auteur: "Théo" }, h);
    expect(pv).toMatchObject({
      numero: "A35173-20261119-143205",
      indice: "A",
      origine: "site",
      statut: "brouillon",
      donneesPreparees: null,
      affaireId: AFFAIRE.id,
      equipementId: EQ_DIFF.id,
    });
    expect(pv.pvId).not.toBe(pv.versionId);
    expect(pv.donnees.es.points.map((p) => [p.adresse, p.teste])).toEqual([
      ["BI 1.01", null],
      ["BI 1.02", "NA"],
    ]);
    expect(pv.donnees.identification.find((f) => f.id === "modele")?.valeur).toBe("7UT85");
    expect(pv.donnees.revisions[0]?.date).toBe("2026-11-19");
    expect(await db.pvs.get(pv.versionId)).toEqual(pv);
    expect((await lireMeta(db)).dernierNumeroLe).toBe("2026-11-19T13:32:05.300Z");
  });

  it("attend la seconde suivante pour deux PV créés dans la même seconde", async () => {
    const h = horloge("2026-11-19T13:32:05.300Z");
    const [a, b] = await Promise.all([
      creerPvSurSite(db, { affaire: LOCAL_AFFAIRE, equipementId: EQ_DIFF.id, auteur: "Théo" }, h),
      creerPvSurSite(db, { affaire: LOCAL_AFFAIRE, equipementId: EQ_MCN.id, auteur: "Théo" }, h),
    ]);
    expect(a.numero).toBe("A35173-20261119-143205");
    expect(b.numero).toBe("A35173-20261119-143206");
    expect(h.attentes).toEqual([700]);
  });

  it("équipement sans feuille : PV sans E/S ; équipement inconnu : erreur", async () => {
    const h = horloge("2026-11-19T13:32:05.000Z");
    const pv = await creerPvSurSite(db, { affaire: LOCAL_AFFAIRE, equipementId: EQ_SANS.id, auteur: "Théo" }, h);
    expect(pv.donnees.es.points).toEqual([]);
    await expect(
      creerPvSurSite(db, { affaire: LOCAL_AFFAIRE, equipementId: "inconnu", auteur: "Théo" }, h),
    ).rejects.toThrow(PvLocalError);
  });

  it("régulateur de tension : pas de modèle de PV, création refusée", async () => {
    const affaire = { ...LOCAL_AFFAIRE, equipements: [...LOCAL_AFFAIRE.equipements, EQ_REGULATEUR] };
    await expect(
      creerPvSurSite(db, { affaire, equipementId: EQ_REGULATEUR.id, auteur: "Théo" }, horloge(NOW_SITE)),
    ).rejects.toThrow("RGU_HTB_TR : aucun modèle de PV pour cet équipement.");
  });
});

const NOW_SITE = "2026-11-19T13:40:00.000Z";

describe("creationSurSite : « Créer un PV sur site » seulement si pertinent (anomalie 7)", () => {
  it("proposé pour un relais sans PV ; refusé pour le régulateur, ou si un PV existe ici ou au serveur", () => {
    expect(creationSurSite(EQ_DIFF, [])).toEqual({ possible: true });
    expect(creationSurSite(EQ_REGULATEUR, [])).toEqual({
      possible: false,
      raison: "Pas de modèle de PV pour cet équipement : aucun PV n'est prévu.",
    });
    expect(creationSurSite(EQ_DIFF, [{ equipementId: EQ_DIFF.id }])).toMatchObject({
      possible: false,
      raison: "Un PV existe déjà pour cet équipement sur cette tablette.",
    });
    expect(creationSurSite(EQ_DIFF, [{ equipementId: EQ_MCN.id }])).toEqual({ possible: true });
    const auServeur = { ...EQ_DIFF, avancement: { nbPv: 1, deposes: 1, enCours: 0 } };
    expect(creationSurSite(auServeur, [])).toMatchObject({
      possible: false,
      raison: expect.stringContaining("bureau"),
    });
  });
});

describe("ouvrirPvPrepare et enregistrerDonnees", () => {
  it("l'ouverture d'un PV préparé démarre la saisie, une seule fois", async () => {
    const pv = await pvPrepareLocal();
    const ouvert = await ouvrirPvPrepare(db, pv.versionId, new Date("2026-11-19T09:00:00.000Z"));
    expect(ouvert).toMatchObject({
      statut: "brouillon",
      saisieCommenceeLe: "2026-11-19T09:00:00.000Z",
      saisieSignalee: false,
    });
    const encore = await ouvrirPvPrepare(db, pv.versionId, new Date("2026-11-19T10:00:00.000Z"));
    expect(encore.saisieCommenceeLe).toBe("2026-11-19T09:00:00.000Z");
    await expect(ouvrirPvPrepare(db, "inconnu", new Date())).rejects.toThrow("introuvable");
  });

  it("enregistre les données et trace les valeurs préparées modifiées (auteur, date)", async () => {
    const pv = await pvPrepareLocal();
    const d: PvRelaisData = structuredClone(pv.donnees);
    d.generalites.lieu = "Poste GAU11 — cellule 3"; // préparé : « Poste GAU11 »
    d.generalites.dates = "Semaine 47"; // vide au bureau : pas une modification
    const maj = await enregistrerDonnees(db, pv.versionId, d, { par: "Théo", le: "2026-11-19T09:05:00.000Z" });
    expect(maj.statut).toBe("brouillon"); // modifier un PV préparé commence la saisie
    expect(maj.saisieCommenceeLe).toBe("2026-11-19T09:05:00.000Z");
    expect(maj.journal).toEqual([
      {
        chemin: "generalites.lieu",
        avant: "Poste GAU11",
        apres: "Poste GAU11 — cellule 3",
        par: "Théo",
        le: "2026-11-19T09:05:00.000Z",
      },
    ]);
    // Annuler la modification la retire du journal.
    const annule = await enregistrerDonnees(db, pv.versionId, pv.donnees, {
      par: "Théo",
      le: "2026-11-19T09:06:00.000Z",
    });
    expect(annule.journal).toEqual([]);
    expect((await db.pvs.get(pv.versionId))?.modifieLe).toBe("2026-11-19T09:06:00.000Z");
  });

  it("pas de journal pour un PV créé sur site ; refus sur un PV signé", async () => {
    const h = horloge("2026-11-19T13:32:05.000Z");
    const pv = await creerPvSurSite(db, { affaire: LOCAL_AFFAIRE, equipementId: EQ_DIFF.id, auteur: "Théo" }, h);
    const maj = await enregistrerDonnees(
      db,
      pv.versionId,
      { ...pv.donnees, generalites: { ...pv.donnees.generalites, lieu: "X" } },
      { par: "Théo", le: "2026-11-19T13:40:00.000Z" },
    );
    expect(maj.journal).toEqual([]);
    await db.pvs.update(pv.versionId, { statut: "signe" });
    await expect(
      enregistrerDonnees(db, pv.versionId, pv.donnees, { par: "Théo", le: "2026-11-19T13:41:00.000Z" }),
    ).rejects.toThrow("signé");
  });
});

describe("signature (spec §3.2 étapes 6 à 8)", () => {
  it("avecEcritPar renseigne « Écrit par » de la révision courante s'il est vide", () => {
    const d = syncPv().donnees;
    expect(avecEcritPar(d, "Théo").revisions[0]?.ecritPar).toBe("Théo");
    const deja = { ...d, revisions: [{ ...d.revisions[0]!, ecritPar: "Paul" }] };
    expect(avecEcritPar(deja, "Théo").revisions[0]?.ecritPar).toBe("Paul");
  });

  it("refuse un PV incomplet en listant ce qui manque", async () => {
    const pv = await pvPrepareLocal();
    expect(manquantsBloquants(pv.donnees).length).toBeGreaterThan(5);
    const err = await signerPv(
      db,
      pv.versionId,
      { donnees: pv.donnees, signataire: { id: "u", nom: "Théo" } },
      new Date(),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PvLocalError);
    expect((err as PvLocalError).manquants.map((m) => m.message)).toContain("Signature SPIE manquante.");
    expect((await db.pvs.get(pv.versionId))?.statut).toBe("prepare");
    expect(await db.outbox.count()).toBe(0);
  });

  it("fige le PV, calcule l'empreinte et met la requête d'envoi dans la file", async () => {
    const pv = await pvPrepareLocal();
    await ouvrirPvPrepare(db, pv.versionId, new Date("2026-11-19T09:00:00.000Z"));
    const donnees = completer(pv.donnees);
    donnees.generalites.lieu = "Poste GAU11 bis";
    const now = new Date("2026-11-19T15:00:00.000Z");
    const signe = await signerPv(db, pv.versionId, { donnees, signataire: { id: "u", nom: "Théo Technicien" } }, now);
    expect(signe).toMatchObject({ statut: "signe", signeLe: now.toISOString(), signePar: "Théo Technicien" });
    expect(signe.donnees.revisions[0]?.ecritPar).toBe("Théo Technicien");
    const attendu = await empreintePv({
      pvId: pv.pvId,
      versionId: pv.versionId,
      numero: pv.numero,
      indice: "A",
      signeLe: now.toISOString(),
      donnees: signe.donnees,
    });
    expect(signe.empreinte).toBe(attendu);

    const item = await db.outbox.get(pv.versionId);
    expect(item).toMatchObject({ tentatives: 0, bloque: false, ajouteLe: now.toISOString() });
    expect(item!.payload).toMatchObject({
      pvId: pv.pvId,
      numero: pv.numero,
      empreinte: attendu,
      tabletteId: (await lireMeta(db)).tabletteId,
      donneesPreparees: pv.donneesPreparees,
    });
    expect(item!.payload.modifications.map((m) => m.chemin)).toContain("generalites.lieu");

    await expect(signerPv(db, pv.versionId, { donnees, signataire: { id: "u", nom: "Théo" } }, now)).rejects.toThrow(
      "déjà signé",
    );
    await expect(
      enregistrerDonnees(db, pv.versionId, donnees, { par: "Théo", le: now.toISOString() }),
    ).rejects.toThrow();
  });

  it("un PV créé sur site est envoyé sans données préparées", async () => {
    const h = horloge("2026-11-19T13:32:05.000Z");
    const pv = await creerPvSurSite(db, { affaire: LOCAL_AFFAIRE, equipementId: EQ_DIFF.id, auteur: "Théo" }, h);
    await signerPv(
      db,
      pv.versionId,
      { donnees: completer(pv.donnees), signataire: { id: "u", nom: "Théo" } },
      new Date("2026-11-19T15:00:00.000Z"),
    );
    expect((await db.outbox.get(pv.versionId))!.payload.donneesPreparees).toBeNull();
  });
});

describe("supprimerBrouillonSite", () => {
  it("supprime un brouillon créé sur site, refuse un PV préparé", async () => {
    const h = horloge("2026-11-19T13:32:05.000Z");
    const pv = await creerPvSurSite(db, { affaire: LOCAL_AFFAIRE, equipementId: EQ_DIFF.id, auteur: "Théo" }, h);
    await supprimerBrouillonSite(db, pv.versionId);
    expect(await db.pvs.get(pv.versionId)).toBeUndefined();
    const prep = await pvPrepareLocal();
    await expect(supprimerBrouillonSite(db, prep.versionId)).rejects.toThrow(PvLocalError);
    await supprimerBrouillonSite(db, "inconnu"); // sans effet
  });
});

describe("listeEsObsolete et construirePvDocument", () => {
  it("avertit quand la liste E/S de l'affaire a une version plus récente", async () => {
    const pv = await pvPrepareLocal(); // version 2 de la liste
    expect(listeEsObsolete(pv, LOCAL_AFFAIRE)).toBe(false);
    expect(listeEsObsolete(pv, { ...LOCAL_AFFAIRE, liste: { ...LOCAL_AFFAIRE.liste!, version: 3 } })).toBe(true);
    expect(listeEsObsolete(pv, undefined)).toBe(false);
  });

  it("construit le document de l'aperçu à partir du PV local et de l'affaire", async () => {
    const pv = await pvPrepareLocal();
    const doc = construirePvDocument(pv, LOCAL_AFFAIRE, new Date("2026-11-19T10:00:00.000Z"));
    expect(doc).toMatchObject({
      format: "spie-pv/1",
      pv: { id: pv.pvId, numero: pv.numero, famille: "MES", modele: "relais" },
      version: { id: pv.versionId, indice: "A", empreinte: null },
      affaire: { numero: "A35173", client: "HUAWEI", site: "Gaudonville" },
      equipement: { tag: "RPN_HTB_DIFF_TR" },
      listeEs: { reference: "GAU11_AUT_009", revision: "B", version: 2 },
      meta: { genereLe: "2026-11-19T10:00:00.000Z" },
    });
    expect(construirePvDocument(pv, undefined, new Date()).affaire.numero).toBe("A35173");
  });
});
