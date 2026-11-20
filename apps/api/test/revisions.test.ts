import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  ajouterObservation,
  leverReserve,
  type AuditEntryDto,
  type PrepAffaireDto,
  type PvDetailDto,
  type PvRelaisData,
  type PvResumeDto,
  type PvVersionStatusDto,
  type ReserveSuiviDto,
  type SyncPvDto,
  type SyncReferenceDto,
} from "@spie/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { affaires } from "../src/db/schema.js";
import { createTestApp, type TestApp } from "./helpers.js";
import { PNG, as, classeurEs, envoiDuPrepare, envoiSigne, scenario, type Scenario } from "./lot1.js";

/** Lot 2 (spec §3.4, §4.3) : révision suivante, tableau des révisions, levée de réserves, suivi au bureau. */

let t: TestApp;
let s: Scenario;
let pvA: PvDetailDto;
let recuA: PvVersionStatusDto;
let revB: SyncPvDto;

const dossierAffaire = () =>
  join(t.dir, "sharepoint", "Documents partagés", "Affaires", "A00001 - Stockage batteries DEMO1");
const tech = () => as(t, s.techToken);
const prep = () => as(t, s.prepToken);
const detail = async () => (await prep().get(`/api/prep/pv/${pvA.pvId}`)).json<PvDetailDto>();
const reservesBureau = async (q = "") => (await prep().get(`/api/prep/reserves${q}`)).json<ReserveSuiviDto[]>();

/** Signe une révision reprise du serveur : statut du document et signatures, après `modifier`. */
async function envoiRevision(rev: SyncPvDto, modifier: (d: PvRelaisData) => PvRelaisData = (d) => d) {
  const d = structuredClone(rev.donnees);
  d.entete.statutDocument = "CMS";
  d.signatures = {
    spie: { nom: "Théo Technicien", date: "2026-12-01", signature: PNG, commentaires: "" },
    client: { nom: "M. Client", date: "2026-12-01", signature: PNG, commentaires: "", refus: null },
  };
  return envoiSigne({
    versionId: rev.versionId,
    pvId: rev.pvId,
    affaireId: rev.affaireId,
    equipementId: rev.equipementId,
    numero: rev.numero,
    indice: rev.indice,
    donnees: modifier(d),
    // Comme la tablette : la base de comparaison est celle que le serveur a précisée pour la révision.
    donneesPreparees: rev.donneesPreparees === undefined ? rev.donnees : rev.donneesPreparees,
    creeLe: rev.creeLe,
    signeLe: "2026-12-01T10:00:00.000Z",
  });
}

beforeAll(async () => {
  t = await createTestApp();
  s = await scenario(t);
  await prep().post(`/api/prep/affaires/${s.affaire.id}/io-lists`, {
    fichier: "liste.xlsx",
    contenuBase64: await classeurEs(),
  });
  const a = (await prep().get(`/api/prep/affaires/${s.affaire.id}`)).json<PrepAffaireDto>();
  const equipementId = a.equipements.find((e) => e.tag === "RPN_HTA_F1")!.id;
  pvA = (await prep().post("/api/prep/pv", { affaireId: s.affaire.id, equipementId })).json<PvDetailDto>();
  await prep().put(`/api/prep/pv/${pvA.pvId}/affectations`, { userIds: [s.techId] });
  // Révision A signée avec une réserve ouverte.
  const res = await tech().put(
    `/api/pv-versions/${pvA.versionId}`,
    await envoiDuPrepare(pvA, "Théo Technicien", (d) => {
      Object.assign(
        d,
        ajouterObservation(d, {
          ref: null,
          libelle: "Repérage des câbles",
          jugement: "NC",
          observation: "Étiquettes manquantes sur le bornier X12.",
          reserve: { criticite: "non_bloquante", responsable: "SPIE — câblage", datePrevue: "2026-11-10" },
        }),
      );
    }),
  );
  if (res.statusCode !== 201) throw new Error(res.body);
  recuA = res.json<PvVersionStatusDto>();
});
afterAll(() => t.close());

describe("création de la révision suivante (spec §3.4)", () => {
  it("refusée tant que le PV n'est pas déposé dans SharePoint", async () => {
    const r = await tech().post(`/api/pv/${pvA.pvId}/revisions`, { modifications: "Levée de la réserve n°1" });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.message).toContain("déposé");
  });

  it("une fois déposé : le PV est proposé à la tablette pour une révision, avec ses réserves", async () => {
    expect(await t.traitement.traiterEchus()).toBe(3);
    const ref = (await tech().get("/api/sync/reference")).json<SyncReferenceDto>();
    expect(ref.deposes).toEqual([
      expect.objectContaining({
        pvId: pvA.pvId,
        versionId: pvA.versionId,
        indice: "A",
        reserves: { ouvertes: 1, levees: 0 },
      }),
    ]);
    const [resume] = (await prep().get(`/api/prep/pv?affaireId=${s.affaire.id}`)).json<PvResumeDto[]>();
    expect(resume).toMatchObject({ revisionSuivante: "B", nbVersions: 1, reserves: { ouvertes: 1, levees: 0 } });
  });

  it("exige une description et l'accès à l'affaire", async () => {
    expect((await tech().post(`/api/pv/${pvA.pvId}/revisions`, { modifications: "  " })).statusCode).toBe(400);
    expect(
      (await as(t, s.autreTechToken).post(`/api/pv/${pvA.pvId}/revisions`, { modifications: "x" })).statusCode,
    ).toBe(403);
    expect((await t.app.inject({ method: "POST", url: `/api/pv/${pvA.pvId}/revisions` })).statusCode).toBe(401);
  });

  it("réserve l'indice B : données reprises, signatures et statut vidés, ligne ajoutée au tableau des révisions", async () => {
    const r = await tech().post(`/api/pv/${pvA.pvId}/revisions`, { modifications: " Levée de la réserve n°1 " });
    expect(r.statusCode).toBe(201);
    revB = r.json<SyncPvDto>();
    expect(revB).toMatchObject({ pvId: pvA.pvId, numero: pvA.numero, indice: "B", statut: "prepare" });
    expect(revB.versionId).not.toBe(pvA.versionId);
    const d = revB.donnees;
    expect(d.entete).toMatchObject({ indice: "B", statutDocument: null });
    expect(d.signatures.spie).toEqual({ nom: "", date: "", signature: null, commentaires: "" });
    expect(d.signatures.client.signature).toBeNull();
    expect(d.revisions.map((x) => x.indice)).toEqual(["A", "B"]);
    expect(d.revisions[0]).toEqual(pvA.donnees.revisions[0]);
    expect(d.revisions[1]).toEqual({
      indice: "B",
      date: "2026-11-19",
      ecritPar: "",
      validePar: "V. VALIDEUR",
      approuvePar: "A. APPROBATEUR",
      modifications: "Levée de la réserve n°1",
    });
    // Tout le reste est repris : mesures, E/S, conclusion, réserves.
    expect(d.conclusion.materiel).toBe("accepte");
    expect(d.es.points.filter((p) => p.teste === "C").length).toBeGreaterThan(0);
    expect(d.reserves).toEqual([
      expect.objectContaining({ numero: 1, statut: "ouverte", indiceCreation: "A", levee: null }),
    ]);

    const audit = (await as(t, s.adminToken).get("/api/admin/audit?limit=200")).json<AuditEntryDto[]>();
    expect(audit.find((e) => e.action === "pv.revision_creee")?.details).toMatchObject({
      numero: pvA.numero,
      indice: "B",
    });
  });

  it("la base de comparaison de la révision est la préparation d'origine, pas les saisies reprises", async () => {
    // Ni les réserves, ni les résultats d'E/S, ni la conclusion de la révision A n'ont été « pré-remplis ».
    expect(revB.donneesPreparees).toMatchObject({
      entete: { indice: "B", statutDocument: null },
      reserves: [],
      observations: [],
      conclusion: { materiel: null },
    });
    const ref = (await tech().get("/api/sync/reference")).json<SyncReferenceDto>();
    expect(ref.pvs[0]!.donneesPreparees?.reserves).toEqual([]);
  });

  it("verrouille le PV : pas de seconde révision tant que B n'est pas déposée", async () => {
    const r = await prep().post(`/api/pv/${pvA.pvId}/revisions`, { modifications: "Autre modification" });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.message).toContain("révision B");
  });

  it("la révision B arrive sur la tablette comme un PV préparé ; le bureau voit l'historique", async () => {
    const ref = (await tech().get("/api/sync/reference")).json<SyncReferenceDto>();
    expect(ref.pvs.map((p) => [p.versionId, p.indice])).toEqual([[revB.versionId, "B"]]);
    expect(ref.deposes).toEqual([]);

    const d = await detail();
    expect(d).toMatchObject({ versionId: revB.versionId, indice: "B", statut: "prepare", nbVersions: 2 });
    expect(d.revisionSuivante).toBeNull();
    expect(d.historique.map((h) => [h.indice, h.statut, h.signePar])).toEqual([
      ["A", "depose", "Théo Technicien"],
      ["B", "prepare", null],
    ]);
    expect(d.historique[0]!.depots.map((x) => x.statut)).toEqual(["depose", "depose", "depose"]);
    expect(d.historique[1]).toMatchObject({ modifications: "Levée de la réserve n°1", date: "2026-11-19" });

    // L'équipement n'a toujours qu'un PV, désormais en cours.
    const a = (await prep().get(`/api/prep/affaires/${s.affaire.id}`)).json<PrepAffaireDto>();
    expect(a.equipements.find((e) => e.tag === "RPN_HTA_F1")!.avancement).toEqual({
      nbPv: 1,
      deposes: 0,
      enCours: 1,
    });
  });

  it("une révision ne se duplique pas vers un autre équipement", async () => {
    const a = (await prep().get(`/api/prep/affaires/${s.affaire.id}`)).json<PrepAffaireDto>();
    const f2 = a.equipements.find((e) => e.tag === "RPN_HTA_F2")!.id;
    const r = await prep().post(`/api/prep/pv/${pvA.pvId}/duplicate`, { equipementIds: [f2] });
    expect(r.statusCode).toBe(409);
  });
});

describe("levée de réserves et suivi (spec §4.3)", () => {
  it("le suivi montre la réserve ouverte de la révision A, en retard, avec la révision B en cours", async () => {
    expect(await reservesBureau()).toEqual([
      expect.objectContaining({
        pvId: pvA.pvId,
        versionId: pvA.versionId,
        numeroPv: pvA.numero,
        indicePv: "A",
        affaireNumero: "A00001",
        equipementTag: "RPN_HTA_F1",
        numero: 1,
        controle: "Repérage des câbles",
        description: "Étiquettes manquantes sur le bornier X12.",
        criticite: "non_bloquante",
        responsable: "SPIE — câblage",
        datePrevue: "2026-11-10",
        statut: "ouverte",
        indiceCreation: "A",
        levee: null,
        enRetard: true,
        revisionEnCours: "B",
      }),
    ]);
    expect(await reservesBureau("?statut=levee")).toEqual([]);
    expect(await reservesBureau("?criticite=bloquante")).toEqual([]);
    expect((await tech().get("/api/prep/reserves")).statusCode).toBe(403);
  });

  it("refuse une révision qui supprime une réserve ou réécrit une révision signée", async () => {
    const sansReserve = await tech().put(
      `/api/pv-versions/${revB.versionId}`,
      await envoiRevision(revB, (d) => ({ ...d, reserves: [], observations: [] })),
    );
    expect(sansReserve.statusCode).toBe(400);
    expect(sansReserve.json().error.message).toContain("réserve n°1");

    const reecrite = await tech().put(
      `/api/pv-versions/${revB.versionId}`,
      await envoiRevision(revB, (d) => ({
        ...d,
        revisions: d.revisions.map((r) => (r.indice === "A" ? { ...r, ecritPar: "Quelqu'un d'autre" } : r)),
      })),
    );
    expect(reecrite.statusCode).toBe(400);
    expect(reecrite.json().error.message).toContain("révisions précédentes");

    const mauvaisIndice = await tech().put(
      `/api/pv-versions/${revB.versionId}`,
      await envoiRevision(revB, (d) => ({
        ...d,
        reserves: d.reserves.map((r) => ({
          ...r,
          statut: "levee" as const,
          levee: { date: "2026-12-01", commentaire: "", indice: "A" },
        })),
      })),
    );
    expect(mauvaisIndice.statusCode).toBe(400);
  });

  it("accepte la révision B qui lève la réserve ; A et B sont dans SharePoint", async () => {
    const r = await tech().put(
      `/api/pv-versions/${revB.versionId}`,
      await envoiRevision(revB, (d) =>
        leverReserve(d, d.reserves[0]!.id, { date: "2026-12-01", commentaire: "Étiquettes posées." }),
      ),
    );
    expect(r.statusCode).toBe(201);
    const recuB = r.json<PvVersionStatusDto>();
    expect(recuB.depots.map((d) => d.nom).every((n) => n.includes("_indB."))).toBe(true);
    expect(await t.traitement.traiterEchus()).toBe(3);

    // Critère de fin du lot 2 : les révisions A et B sont présentes, A inchangée.
    for (const d of [...recuA.depots, ...recuB.depots]) expect(existsSync(join(dossierAffaire(), d.nom))).toBe(true);
    expect(recuA.depots.map((d) => d.nom).every((n) => n.includes("_indA."))).toBe(true);

    const d = await detail();
    expect(d).toMatchObject({ indice: "B", statut: "depose", revisionSuivante: "C" });
    expect(d.reserves).toEqual({ ouvertes: 0, levees: 1 });
    // La levée et les saisies reprises ne sont pas des « valeurs pré-remplies modifiées » ; celles de la révision A
    // gardent leur auteur et leur date.
    const a = d.historique[0]!;
    expect(
      d.modifications.map((m) => m.chemin).filter((c) => /^(reserves|observations|es|conclusion|entete)/.test(c)),
    ).toEqual([]);
    expect(a.indice).toBe("A");
    expect(d.modifications.every((m) => m.le === "2026-11-19T15:00:00.000Z")).toBe(true);
    expect(d.historique.map((h) => [h.indice, h.statut, h.reserves])).toEqual([
      ["A", "depose", { ouvertes: 1, levees: 0 }],
      ["B", "depose", { ouvertes: 0, levees: 1 }],
    ]);

    expect(await reservesBureau("?statut=ouverte")).toEqual([]);
    expect(await reservesBureau()).toEqual([
      expect.objectContaining({
        indicePv: "B",
        versionId: revB.versionId,
        statut: "levee",
        indiceCreation: "A",
        levee: { date: "2026-12-01", commentaire: "Étiquettes posées.", indice: "B" },
        enRetard: false,
        revisionEnCours: null,
      }),
    ]);
    const audit = (await as(t, s.adminToken).get("/api/admin/audit?limit=200")).json<AuditEntryDto[]>();
    expect(audit.find((e) => e.action === "reserve.levee")?.details).toMatchObject({ indice: "B", reserves: [1] });
  });
});

describe("révision préparée au bureau, puis annulée (spec §3.4 étape 6)", () => {
  it("le préparateur crée la révision C ; le technicien du PV la reçoit", async () => {
    const r = await prep().post(`/api/pv/${pvA.pvId}/revisions`, { modifications: "Remplacement du relais" });
    expect(r.statusCode).toBe(201);
    expect(r.json<SyncPvDto>().indice).toBe("C");
    const ref = (await tech().get("/api/sync/reference")).json<SyncReferenceDto>();
    expect(ref.pvs.map((p) => p.indice)).toEqual(["C"]);
  });

  it("annuler la révision C libère l'indice sans toucher aux révisions signées", async () => {
    expect((await prep().del(`/api/prep/pv/${pvA.pvId}`)).statusCode).toBe(204);
    const d = await detail();
    expect(d).toMatchObject({ indice: "B", statut: "depose", nbVersions: 2, revisionSuivante: "C" });
    const audit = (await as(t, s.adminToken).get("/api/admin/audit?limit=200")).json<AuditEntryDto[]>();
    expect(audit.find((e) => e.action === "pv.revision_annulee")?.details).toMatchObject({ indice: "C" });
    // Un PV déposé ne se supprime pas.
    expect((await prep().del(`/api/prep/pv/${pvA.pvId}`)).statusCode).toBe(409);
  });
});

describe("affaire archivée", () => {
  it("aucune révision n'y est créée : elle ne serait jamais livrée aux tablettes", async () => {
    await t.db.update(affaires).set({ archivee: true }).where(eq(affaires.id, s.affaire.id));
    try {
      const r = await as(t, s.adminToken).post(`/api/pv/${pvA.pvId}/revisions`, { modifications: "x" });
      expect(r.statusCode).toBe(409);
      expect(r.json().error.message).toContain("archivée");
    } finally {
      await t.db.update(affaires).set({ archivee: false }).where(eq(affaires.id, s.affaire.id));
    }
    expect((await detail()).indice).toBe("B");
  });
});

describe("révision créée sur tablette par un préparateur, annulée au bureau pendant la saisie hors ligne", () => {
  let revC: SyncPvDto;

  it("« affecter » : celui qui crée la révision pour la compléter devient technicien du PV et la reçoit", async () => {
    const r = await prep().post(`/api/pv/${pvA.pvId}/revisions`, { modifications: "Contrôle annuel", affecter: true });
    expect(r.statusCode).toBe(201);
    revC = r.json<SyncPvDto>();
    expect((await detail()).techniciens.map((x) => x.nom)).toEqual(["Paul Préparateur", "Théo Technicien"]);
    const ref = (await prep().get("/api/sync/reference")).json<SyncReferenceDto>();
    expect(ref.pvs.map((p) => p.versionId)).toEqual([revC.versionId]);
  });

  it("annulée puis recréée au bureau : la révision signée sur la tablette est rétablie et remplace la nouvelle", async () => {
    // Le bureau ne sait pas que la saisie a commencé hors ligne : il annule, puis quelqu'un recrée la révision C.
    expect((await prep().del(`/api/prep/pv/${pvA.pvId}`)).statusCode).toBe(204);
    const recreee = (
      await tech().post(`/api/pv/${pvA.pvId}/revisions`, { modifications: "Autre demande" })
    ).json<SyncPvDto>();
    expect(recreee.versionId).not.toBe(revC.versionId);

    // Une révision qui ne suit pas la dernière révision déposée reste refusée.
    const horsSuite = await prep().put(
      `/api/pv-versions/${revC.versionId}`,
      await envoiRevision({
        ...revC,
        indice: "D",
        donnees: { ...revC.donnees, entete: { ...revC.donnees.entete, indice: "D" } },
      }),
    );
    expect(horsSuite.statusCode).toBe(409);

    const r = await prep().put(`/api/pv-versions/${revC.versionId}`, await envoiRevision(revC));
    expect(r.statusCode).toBe(201);
    const d = await detail();
    expect(d).toMatchObject({ versionId: revC.versionId, indice: "C", statut: "recu", nbVersions: 3 });
    expect(d.historique.at(-1)).toMatchObject({ modifications: "Contrôle annuel", signePar: "Paul Préparateur" });
    const audit = (await as(t, s.adminToken).get("/api/admin/audit?limit=200")).json<AuditEntryDto[]>();
    expect(audit.find((e) => e.action === "pv.recu")?.details).toMatchObject({ indice: "C", revisionRetablie: true });
  });

  it("une révision recréée et déjà commencée ailleurs n'est pas remplacée", async () => {
    expect(await t.traitement.traiterEchus()).toBe(3);
    const revD = (
      await prep().post(`/api/pv/${pvA.pvId}/revisions`, { modifications: "D", affecter: true })
    ).json<SyncPvDto>();
    expect((await prep().del(`/api/prep/pv/${pvA.pvId}`)).statusCode).toBe(204);
    const autre = (await tech().post(`/api/pv/${pvA.pvId}/revisions`, { modifications: "D bis" })).json<SyncPvDto>();
    await tech().post("/api/sync/started", { versionIds: [autre.versionId] });
    const r = await prep().put(`/api/pv-versions/${revD.versionId}`, await envoiRevision(revD));
    expect(r.statusCode).toBe(409);
    expect((await detail()).versionId).toBe(autre.versionId);
  });
});
