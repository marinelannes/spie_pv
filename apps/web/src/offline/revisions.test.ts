import {
  creerRevisionSuivante,
  leverReserve,
  transformerEnReserve,
  ajouterObservation,
  type SyncPvDeposeDto,
  type SyncPvDto,
} from "@spie/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "../lib/api";
import { AFFAIRE, EQ_DIFF, LOCAL_AFFAIRE, completer, syncPv } from "../test/fixtures";
import { creerBase, fermerBases, type LocalPv, type UserDb } from "./db";
import { PvLocalError, enregistrerDonnees, ouvrirPvPrepare, signerPv } from "./pv-local";
import { creerRevisionSurTablette, deposesHorsTablette, revisionACreer, revisionLocaleSuivante } from "./revisions";
import { SyncEngine, fusionnerReference, pvDepuisReference, type Fetcher } from "./sync";

let db: UserDb;
let n = 0;
beforeEach(async () => {
  db = creerBase(`test-revisions-${++n}`);
  await db.open();
  await db.affaires.put({ ...LOCAL_AFFAIRE, deposes: [DEPOSE] });
});
afterEach(async () => {
  db.close();
  await db.delete();
  fermerBases();
});

const NOW = new Date("2026-12-01T09:00:00.000Z");
const PV_ID = syncPv().pvId;
const VERSION_B = "00000000-0000-4000-8000-0000000d0002";

const DEPOSE: SyncPvDeposeDto = {
  pvId: PV_ID,
  versionId: syncPv().versionId,
  numero: syncPv().numero,
  indice: "A",
  affaireId: AFFAIRE.id,
  equipementId: EQ_DIFF.id,
  deposeLe: "2026-11-19T15:05:00.000Z",
  reserves: { ouvertes: 1, levees: 0 },
};

/** Révision A signée avec une réserve ouverte, telle que le serveur la reprend dans la révision B. */
function revisionB(): SyncPvDto {
  let a = completer(syncPv().donnees);
  a = ajouterObservation(a, { ref: null, libelle: "Repérage", jugement: "NC", observation: "Étiquettes." });
  a = transformerEnReserve(a, a.observations[0]!.id);
  return syncPv({
    versionId: VERSION_B,
    indice: "B",
    donnees: creerRevisionSuivante(a, { indice: "B", date: "2026-12-01", modifications: "Levée de la réserve n°1" }),
    creeLe: NOW.toISOString(),
    misAJourLe: NOW.toISOString(),
  });
}

/** Serveur simulé : répond à la création de révision, note les appels. */
function serveur(reponse: () => unknown): { fetcher: Fetcher; appels: { path: string; body: unknown }[] } {
  const appels: { path: string; body: unknown }[] = [];
  const fetcher = (async (path: string, opts?: { body?: unknown }) => {
    appels.push({ path, body: opts?.body });
    return reponse();
  }) as Fetcher;
  return { fetcher, appels };
}

describe("création de la révision suivante depuis la tablette (spec §3.4)", () => {
  it("demande l'indice au serveur, range la révision sur la tablette comme un PV préparé", async () => {
    const s = serveur(revisionB);
    const pv = await creerRevisionSurTablette(db, s.fetcher, { pvId: PV_ID, modifications: " Levée " }, NOW);
    expect(s.appels).toEqual([
      { path: `/api/pv/${PV_ID}/revisions`, body: { modifications: "Levée", affecter: true } },
    ]);
    expect(pv).toMatchObject({
      versionId: VERSION_B,
      pvId: PV_ID,
      indice: "B",
      statut: "prepare",
      origine: "prepare",
      bureauMisAJourLe: NOW.toISOString(),
    });
    expect((await db.pvs.get(VERSION_B))?.donnees.entete.indice).toBe("B");
    // Le PV n'est plus proposé pour une révision.
    expect((await db.affaires.get(AFFAIRE.id))?.deposes).toEqual([]);
  });

  it("garde la base de comparaison précisée par le serveur (préparation d'origine), même nulle", async () => {
    const base = syncPv().donnees;
    const avecBase = await creerRevisionSurTablette(
      db,
      serveur(() => ({ ...revisionB(), donneesPreparees: base })).fetcher,
      { pvId: PV_ID, modifications: "x" },
      NOW,
    );
    expect(avecBase.donneesPreparees).toEqual(base);
    await db.pvs.clear();
    // PV créé sur site : rien n'a été préparé.
    const sansBase = await creerRevisionSurTablette(
      db,
      serveur(() => ({ ...revisionB(), donneesPreparees: null })).fetcher,
      { pvId: PV_ID, modifications: "x" },
      NOW,
    );
    expect(sansBase.donneesPreparees).toBeNull();
  });

  it("sans description : aucun appel au serveur", async () => {
    const s = serveur(revisionB);
    await expect(creerRevisionSurTablette(db, s.fetcher, { pvId: PV_ID, modifications: "  " }, NOW)).rejects.toThrow(
      /Décrivez la modification/,
    );
    expect(s.appels).toEqual([]);
  });

  it("hors ligne : message clair, rien n'est créé", async () => {
    const s = serveur(() => {
      throw new ApiError(0, "network", "Serveur injoignable.");
    });
    const p = creerRevisionSurTablette(db, s.fetcher, { pvId: PV_ID, modifications: "Levée" }, NOW);
    await expect(p).rejects.toBeInstanceOf(PvLocalError);
    await expect(p).rejects.toThrow(/demande du réseau/);
    expect(await db.pvs.count()).toBe(0);
  });

  it("refus du serveur (révision déjà en cours) : son message est montré", async () => {
    const s = serveur(() => {
      throw new ApiError(409, "conflict", "La révision B de ce PV existe déjà (préparé).");
    });
    await expect(creerRevisionSurTablette(db, s.fetcher, { pvId: PV_ID, modifications: "Levée" }, NOW)).rejects.toThrow(
      "La révision B de ce PV existe déjà (préparé).",
    );
  });

  it("ne remplace pas une révision déjà arrivée par la synchronisation et commencée", async () => {
    const dto = revisionB();
    await db.pvs.add(pvDepuisReference(dto, NOW.toISOString()));
    await ouvrirPvPrepare(db, VERSION_B, NOW);
    const pv = await creerRevisionSurTablette(db, serveur(() => dto).fetcher, { pvId: PV_ID, modifications: "x" }, NOW);
    expect(pv.statut).toBe("brouillon");
  });
});

describe("révision sur la tablette : levée, signature, envoi", () => {
  it("la révision B se complète hors ligne ; la requête d'envoi porte l'indice B et la levée", async () => {
    const pv = await creerRevisionSurTablette(db, serveur(revisionB).fetcher, { pvId: PV_ID, modifications: "x" }, NOW);
    await ouvrirPvPrepare(db, pv.versionId, NOW);
    const trace = { par: "Théo Technicien", le: NOW.toISOString() };
    const levee = leverReserve(pv.donnees, pv.donnees.reserves[0]!.id, { date: "2026-12-01", commentaire: "Fait." });
    await enregistrerDonnees(db, pv.versionId, levee, trace);

    // Signatures et statut du document sont à refaire.
    await expect(
      signerPv(db, pv.versionId, { donnees: levee, signataire: { id: "u", nom: "Théo Technicien" } }, NOW),
    ).rejects.toThrow("Le PV n'est pas complet.");

    const signe = await signerPv(
      db,
      pv.versionId,
      { donnees: completer(levee), signataire: { id: "u", nom: "Théo Technicien" } },
      NOW,
    );
    expect(signe.statut).toBe("signe");
    expect(signe.donnees.revisions.map((r) => [r.indice, r.ecritPar])).toEqual([
      ["A", ""],
      ["B", "Théo Technicien"],
    ]);
    const envoi = (await db.outbox.get(pv.versionId))!.payload;
    expect(envoi).toMatchObject({ pvId: PV_ID, indice: "B", numero: pv.numero });
    expect(envoi.donnees.reserves[0]).toMatchObject({ statut: "levee", levee: { indice: "B", commentaire: "Fait." } });
    // Repère des valeurs modifiées dans cette révision : l'état repris de la révision A.
    expect(envoi.donneesPreparees?.entete.indice).toBe("B");
  });
});

describe("PV déposés et révisions locales", () => {
  const local = (over: Partial<LocalPv>): LocalPv => ({ ...pvDepuisReference(syncPv(), "x"), ...over });

  it("révision locale suivante : la plus récente du même PV", () => {
    const a = local({ statut: "depose" });
    const b = local({ versionId: VERSION_B, indice: "B" });
    const autre = local({ versionId: "v3", pvId: "autre", indice: "C" });
    expect(revisionLocaleSuivante(a, [a, b, autre])).toBe(b);
    expect(revisionLocaleSuivante(b, [a, b, autre])).toBeUndefined();
  });

  it("PV déposés hors tablette : ceux dont aucune révision n'est sur la tablette", () => {
    const affaire = {
      ...LOCAL_AFFAIRE,
      deposes: [DEPOSE, { ...DEPOSE, pvId: "p2", numero: "A00001-20261101-080000" }],
    };
    expect(deposesHorsTablette(affaire, [local({ statut: "depose" })]).map((d) => d.pvId)).toEqual(["p2"]);
    expect(deposesHorsTablette(LOCAL_AFFAIRE, [])).toEqual([]);
  });

  it("révision déposée ailleurs : elle reste proposée, et l'indice annoncé est celui que le serveur attribuera", () => {
    const a = local({ statut: "depose" });
    const serveurB = { ...DEPOSE, indice: "B", reserves: { ouvertes: 0, levees: 1 } };
    const affaire = { ...LOCAL_AFFAIRE, deposes: [serveurB] };
    // La copie locale (A) est plus ancienne que la révision déposée (B).
    expect(deposesHorsTablette(affaire, [a]).map((d) => d.indice)).toEqual(["B"]);
    expect(revisionACreer(a, affaire)).toEqual({ indice: "C", base: "B", reservesOuvertes: 0, baseAilleurs: true });
    // Serveur et tablette d'accord, ou liste des PV déposés pas encore reçue : la copie locale sert de base.
    const memeIndice = { ...LOCAL_AFFAIRE, deposes: [DEPOSE] };
    expect(revisionACreer(a, memeIndice)).toMatchObject({ indice: "B", base: "A", baseAilleurs: false });
    expect(revisionACreer(a, LOCAL_AFFAIRE)).toMatchObject({ indice: "B", base: "A", baseAilleurs: false });
    expect(revisionACreer(a, null)).toMatchObject({ indice: "B" });
    expect(revisionACreer(local({ statut: "depose", indice: "Z" }), null)).toBeNull();
  });

  it("la synchronisation range les PV déposés par affaire et apporte une révision préparée au bureau", async () => {
    const b = revisionB();
    const fetcher = (async (path: string) => {
      if (path === "/api/sync/reference") {
        return {
          serverTime: NOW.toISOString(),
          utilisateur: { id: "u", nom: "Théo" },
          affaires: [{ affaire: AFFAIRE, equipements: LOCAL_AFFAIRE.equipements, liste: LOCAL_AFFAIRE.liste }],
          pvs: [b],
          deposes: [
            { ...DEPOSE, pvId: "p2" },
            { ...DEPOSE, pvId: "p3", affaireId: "autre-affaire" },
          ],
          modeles: [{ code: "relais", version: "1.0.0" }],
        };
      }
      throw new Error(`appel inattendu : ${path}`);
    }) as Fetcher;
    const r = await new SyncEngine({ db, fetcher, now: () => NOW }).synchroniser();
    expect(r.referenceOk).toBe(true);
    expect((await db.affaires.get(AFFAIRE.id))?.deposes?.map((d) => d.pvId)).toEqual(["p2"]);
    expect((await db.pvs.get(VERSION_B))?.indice).toBe("B");
    // Une seconde synchronisation identique ne touche pas la révision.
    expect(fusionnerReference(await db.pvs.toArray(), [b], NOW.toISOString())).toEqual({
      aAjouter: [],
      aMettreAJour: [],
      aSupprimer: [],
    });
  });
});
