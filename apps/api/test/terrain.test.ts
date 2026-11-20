import { randomUUID } from "node:crypto";
import {
  creerPvRelais,
  numeroPv,
  type AuditEntryDto,
  type PrepAffaireDto,
  type PvDetailDto,
  type PvVersionStatusDto,
  type SyncReferenceDto,
} from "@spie/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reserves } from "../src/db/schema.js";
import { createTestApp, type TestApp } from "./helpers.js";
import { PNG, as, classeurEs, completer, envoiDuPrepare, envoiSigne, scenario, type Scenario } from "./lot1.js";

let t: TestApp;
let s: Scenario;
let pvF1: PvDetailDto;
let pvF2: PvDetailDto;
let affaireDto: PrepAffaireDto;

beforeAll(async () => {
  t = await createTestApp();
  s = await scenario(t);
  const prep = as(t, s.prepToken);
  await prep.post(`/api/prep/affaires/${s.affaire.id}/io-lists`, {
    fichier: "DEMO1_AUT_009_LISTE ENTREES SORTIES RPN_B.xlsx",
    contenuBase64: await classeurEs(),
    associations: [{ tag: "RPN_HTB_DIFF_TR", feuille: "HTB_TR1", filtreTag: "PROTECTION TRANSFO DIF." }],
  });
  affaireDto = (await prep.get(`/api/prep/affaires/${s.affaire.id}`)).json<PrepAffaireDto>();
  const eq = (tag: string) => affaireDto.equipements.find((e) => e.tag === tag)!.id;
  pvF1 = (
    await prep.post("/api/prep/pv", { affaireId: s.affaire.id, equipementId: eq("RPN_HTA_F1") })
  ).json<PvDetailDto>();
  pvF2 = (
    await prep.post("/api/prep/pv", { affaireId: s.affaire.id, equipementId: eq("RPN_HTA_F2") })
  ).json<PvDetailDto>();
  await prep.put(`/api/prep/pv/${pvF1.pvId}/affectations`, { userIds: [s.techId] });
});
afterAll(() => t.close());

const tech = () => as(t, s.techToken);
const journal = async () => (await as(t, s.adminToken).get("/api/admin/audit?limit=200")).json<AuditEntryDto[]>();

describe("synchronisation de la tablette (spec §3.1 étape 5, §6.5)", () => {
  it("renvoie les affaires affectées, leurs équipements, la dernière liste E/S et les PV préparés affectés", async () => {
    const res = await tech().get("/api/sync/reference");
    expect(res.statusCode).toBe(200);
    const r = res.json<SyncReferenceDto>();
    expect(r.serverTime).toBe("2026-11-19T13:32:05.000Z");
    expect(r.utilisateur).toEqual({ id: s.techId, nom: "Théo Technicien" });
    expect(r.modeles).toEqual([{ code: "relais", version: "1.0.0" }]);
    expect(r.affaires.map((a) => a.affaire.numero)).toEqual(["A00001"]);
    const a = r.affaires[0]!;
    expect(a.equipements.map((e) => e.tag)).toEqual(["RPN_HTA_F1", "RPN_HTA_F2", "RPN_HTB_DIFF_TR", "RPN_HTB_MCN_TR"]);
    expect(a.liste).toMatchObject({ version: 1, referenceDocument: "DEMO1_AUT_009" });
    expect(a.liste!.feuilles.map((f) => [f.nom, f.points.length])).toEqual([
      ["TYPE BATTERIE", 4],
      ["HTB_TR1", 5],
    ]);
    // Seul le PV affecté au technicien est préchargé.
    expect(r.pvs.map((p) => p.numero)).toEqual([pvF1.numero]);
    expect(r.pvs[0]).toMatchObject({
      statut: "prepare",
      indice: "A",
      modeleVersion: "1.0.0",
      equipementId: pvF1.equipementId,
      creeLe: pvF1.creeLe,
    });
    expect(r.pvs[0]!.donnees).toEqual(pvF1.donnees);
  });

  it("un technicien sans affectation ne reçoit rien", async () => {
    const r = (await as(t, s.autreTechToken).get("/api/sync/reference")).json<SyncReferenceDto>();
    expect(r.affaires).toEqual([]);
    expect(r.pvs).toEqual([]);
  });

  it("exige une session", async () => {
    expect((await t.app.inject({ method: "GET", url: "/api/sync/reference" })).statusCode).toBe(401);
  });

  it("« saisie commencée » : ignoré pour un PV non affecté, enregistré et tracé sinon", async () => {
    expect((await as(t, s.autreTechToken).post("/api/sync/started", { versionIds: [pvF1.versionId] })).statusCode).toBe(
      204,
    );
    expect(
      (await as(t, s.prepToken).get(`/api/prep/pv/${pvF1.pvId}`)).json<PvDetailDto>().saisieCommenceeLe,
    ).toBeNull();
    expect((await tech().post("/api/sync/started", { versionIds: [pvF1.versionId, pvF2.versionId] })).statusCode).toBe(
      204,
    );
    expect((await as(t, s.prepToken).get(`/api/prep/pv/${pvF1.pvId}`)).json<PvDetailDto>().saisieCommenceeLe).toBe(
      "2026-11-19T13:32:05.000Z",
    );
    expect(
      (await as(t, s.prepToken).get(`/api/prep/pv/${pvF2.pvId}`)).json<PvDetailDto>().saisieCommenceeLe,
    ).toBeNull();
    expect((await journal()).filter((e) => e.action === "pv.saisie_commencee")).toHaveLength(1);
    expect((await tech().post("/api/sync/started", { versionIds: ["pas-un-uuid"] })).statusCode).toBe(400);
  });
});

describe("envoi d'un PV préparé puis signé (spec §3.3, §6.3)", () => {
  let status: PvVersionStatusDto;

  it("refuse une empreinte qui ne correspond pas aux données (422 integrity)", async () => {
    const req = await envoiDuPrepare(pvF1, "Théo Technicien");
    req.donnees.generalites.lieu = "Données modifiées après signature";
    const res = await tech().put(`/api/pv-versions/${pvF1.versionId}`, req);
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("integrity");
  });

  it("refuse un PV sans signatures ni statut du document", async () => {
    const req = await envoiDuPrepare(pvF1, "Théo Technicien", (d) => {
      d.entete.statutDocument = null;
      d.signatures.client = { nom: "", date: "", signature: null, commentaires: "", refus: null };
    });
    const res = await tech().put(`/api/pv-versions/${pvF1.versionId}`, req);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/Statut du document/);
  });

  it("refuse un technicien non affecté à l'affaire, ou au PV", async () => {
    const req = await envoiDuPrepare(pvF1, "Agathe Autre");
    expect((await as(t, s.autreTechToken).put(`/api/pv-versions/${pvF1.versionId}`, req)).statusCode).toBe(403);
    const req2 = await envoiDuPrepare(pvF2, "Théo Technicien");
    expect((await tech().put(`/api/pv-versions/${pvF2.versionId}`, req2)).statusCode).toBe(403);
  });

  it("accepte le PV signé : statut reçu, dépôts planifiés, valeurs préparées modifiées relevées", async () => {
    const req = await envoiDuPrepare(pvF1, "Théo Technicien", (d) => {
      d.identification = d.identification.map((f) => (f.id === "modele" ? { ...f, valeur: "7SX82" } : f));
      d.es.points[0] = { ...d.es.points[0]!, teste: "NC", commentaire: "Pas de remontée" };
      d.observations = [
        {
          id: "o1",
          numero: 1,
          ref: `es.${d.es.points[0]!.id}`,
          libelle: "E/S BI 1.01",
          jugement: "NC",
          reserveNumero: 1,
          observation: "Pas de remontée",
        },
      ];
      d.reserves = [
        {
          id: "r1",
          numero: 1,
          ref: `es.${d.es.points[0]!.id}`,
          controle: "E/S BI 1.01",
          description: "Pas de remontée SCADA",
          criticite: "bloquante",
          responsable: "SPIE",
          datePrevue: "2026-12-01",
          statut: "ouverte",
          indiceCreation: "A",
          levee: null,
        },
      ];
    });
    req.modifications = [
      {
        chemin: "identification[modele].valeur",
        avant: "COMPACT - 7SX8000",
        apres: "7SX82",
        par: "Théo Technicien",
        le: "2026-11-19T14:10:00.000Z",
      },
    ];
    const res = await tech().put(`/api/pv-versions/${pvF1.versionId}`, req);
    expect(res.statusCode).toBe(201);
    status = res.json<PvVersionStatusDto>();
    expect(status).toMatchObject({
      versionId: pvF1.versionId,
      pvId: pvF1.pvId,
      numero: pvF1.numero,
      statut: "recu",
      alerteDoublon: false,
    });
    expect(status.depots.map((d) => [d.fichier, d.nom, d.statut])).toEqual([
      ["pdf", `PV_MES_RPN_HTA_F1_${pvF1.numero}_indA.pdf`, "en_attente"],
      ["json", `PV_MES_RPN_HTA_F1_${pvF1.numero}_indA.json`, "en_attente"],
      ["xlsx", `PV_MES_RPN_HTA_F1_${pvF1.numero}_indA.xlsx`, "en_attente"],
    ]);

    const d = (await as(t, s.prepToken).get(`/api/prep/pv/${pvF1.pvId}`)).json<PvDetailDto>();
    expect(d).toMatchObject({
      statut: "recu",
      statutDocument: "CMS",
      signeLe: "2026-11-19T15:00:00.000Z",
      empreinte: req.empreinte,
    });
    expect(d.donneesPreparees).toEqual(pvF1.donnees);
    // Valeurs préparées modifiées (spec §4.2) : auteur et date repris du journal de la tablette.
    expect(d.modifications).toEqual([
      {
        chemin: "identification[modele].valeur",
        avant: "COMPACT - 7SX8000",
        apres: "7SX82",
        par: "Théo Technicien",
        le: "2026-11-19T14:10:00.000Z",
      },
    ]);
    expect(d.nbModifications).toBe(1);
    const rows = await t.db.select().from(reserves).where(eq(reserves.pvId, pvF1.pvId));
    expect(rows).toMatchObject([{ numero: 1, statut: "ouverte", criticite: "bloquante", indiceCreation: "A" }]);
    const actions = (await journal()).map((e) => e.action);
    expect(actions).toContain("pv.recu");
    expect(actions).toContain("pv.valeurs_modifiees");
  });

  it("renvoi identique : idempotent (200, aucun doublon)", async () => {
    const d = (await as(t, s.prepToken).get(`/api/prep/pv/${pvF1.pvId}`)).json<PvDetailDto>();
    const req = await envoiSigne({
      versionId: pvF1.versionId,
      pvId: pvF1.pvId,
      affaireId: pvF1.affaireId,
      equipementId: pvF1.equipementId,
      numero: pvF1.numero,
      indice: "A",
      donnees: d.donnees,
      donneesPreparees: pvF1.donnees,
    });
    const res = await tech().put(`/api/pv-versions/${pvF1.versionId}`, req);
    expect(res.statusCode).toBe(200);
    expect(res.json<PvVersionStatusDto>().depots).toHaveLength(3);
    expect((await journal()).filter((e) => e.action === "pv.recu")).toHaveLength(1);
  });

  it("même version, contenu différent : 409", async () => {
    const req = await envoiDuPrepare(pvF1, "Théo Technicien", (d) => {
      d.generalites.lieu = "Autre lieu";
    });
    expect((await tech().put(`/api/pv-versions/${pvF1.versionId}`, req)).statusCode).toBe(409);
  });

  it("le PV reçu n'est plus modifiable au bureau", async () => {
    expect((await as(t, s.prepToken).put(`/api/prep/pv/${pvF1.pvId}`, { donnees: pvF1.donnees })).statusCode).toBe(409);
    expect((await as(t, s.prepToken).del(`/api/prep/pv/${pvF1.pvId}`)).statusCode).toBe(409);
  });

  it("statut consultable par la tablette, pas par une personne hors de l'affaire", async () => {
    expect((await tech().get(`/api/pv-versions/${pvF1.versionId}/status`)).json<PvVersionStatusDto>().statut).toBe(
      "recu",
    );
    expect((await as(t, s.autreTechToken).get(`/api/pv-versions/${pvF1.versionId}/status`)).statusCode).toBe(403);
    expect((await tech().get(`/api/pv-versions/${randomUUID()}/status`)).statusCode).toBe(404);
  });
});

describe("PV créé sur site, hors ligne (spec §3.2 étape 1, §4.1)", () => {
  const eqId = (tag: string) => affaireDto.equipements.find((e) => e.tag === tag)!.id;
  const liste = () => affaireDto.listes[0]!;

  async function pvSite(creeLe: Date, pvId = randomUUID(), versionId = randomUUID(), tag = "RPN_HTB_DIFF_TR") {
    const donnees = completer(
      creerPvRelais({
        affaire: {
          numero: "A00001",
          client: "CLIENT DEMO",
          projet: "Stockage batteries – DEMO1",
          valideParDefaut: "",
          approuveParDefaut: "",
        },
        es: {
          listeId: liste().id,
          listeVersion: 1,
          referenceDocument: "DEMO1_AUT_009",
          revision: "B",
          feuille: "HTB_TR1",
          filtreTag: "PROTECTION TRANSFO DIF.",
          points: [
            {
              id: "p1",
              carte: "RPN_HTB / IO203",
              tag: "PROTECTION TRANSFO DIF.",
              adresse: "BI 1.01",
              type: "entree_tor",
              designation: "BUCHHOLZ ALARME",
              reserve: false,
            },
          ],
        },
        date: "2026-11-19",
      }),
      "Théo Technicien",
    );
    const numero = numeroPv("A00001", creeLe);
    return {
      pvId,
      versionId,
      req: await envoiSigne({
        versionId,
        pvId,
        affaireId: s.affaire.id,
        equipementId: eqId(tag),
        numero,
        indice: "A",
        donnees,
        creeLe: creeLe.toISOString(),
      }),
    };
  }

  it("crée le PV et sa version avec les identifiants choisis par la tablette", async () => {
    const { pvId, versionId, req } = await pvSite(new Date("2026-11-19T09:00:00Z"));
    const res = await tech().put(`/api/pv-versions/${versionId}`, req);
    expect(res.statusCode).toBe(201);
    expect(res.json<PvVersionStatusDto>()).toMatchObject({ pvId, numero: "A00001-20261119-100000", statut: "recu" });
    const d = (await as(t, s.prepToken).get(`/api/prep/pv/${pvId}`)).json<PvDetailDto>();
    expect(d).toMatchObject({
      equipementTag: "RPN_HTB_DIFF_TR",
      techniciens: [{ id: s.techId }],
      donneesPreparees: null,
      modifications: [],
    });
    expect(d.creeLe).toBe("2026-11-19T09:00:00.000Z");
  });

  it("numéro identique à un autre PV de l'affaire : accepté mais signalé à l'administrateur", async () => {
    const { req, versionId } = await pvSite(
      new Date("2026-11-19T09:00:00Z"),
      randomUUID(),
      randomUUID(),
      "RPN_HTB_MCN_TR",
    );
    const res = await tech().put(`/api/pv-versions/${versionId}`, req);
    expect(res.statusCode).toBe(201);
    expect(res.json<PvVersionStatusDto>().alerteDoublon).toBe(true);
    expect((await journal()).some((e) => e.action === "pv.doublon_numero")).toBe(true);
    const liste = (await as(t, s.prepToken).get(`/api/prep/pv?affaireId=${s.affaire.id}`)).json<
      { numero: string; alerteDoublon: boolean }[]
    >();
    expect(liste.filter((p) => p.numero === "A00001-20261119-100000").every((p) => p.alerteDoublon)).toBe(true);
  });

  it("refuse un numéro qui n'est pas celui de l'affaire, et un PV existant avec une nouvelle version", async () => {
    const { pvId, versionId, req } = await pvSite(new Date("2026-11-19T09:30:00Z"));
    const faux = await envoiSigne({ ...req, versionId, numero: "A99999-20261119-103000" });
    expect((await tech().put(`/api/pv-versions/${versionId}`, faux)).statusCode).toBe(400);
    expect((await tech().put(`/api/pv-versions/${versionId}`, req)).statusCode).toBe(201);
    const autreVersion = randomUUID();
    const encore = await envoiSigne({ ...req, versionId: autreVersion, pvId });
    expect((await tech().put(`/api/pv-versions/${autreVersion}`, encore)).statusCode).toBe(409);
  });

  it("accepte un corps de plus d'1 Mo (deux signatures volumineuses)", async () => {
    const { versionId, pvId, req } = await pvSite(new Date("2026-11-19T11:00:00Z"));
    const grosse = `data:image/png;base64,${"A".repeat(590_000)}`;
    const donnees = structuredClone(req.donnees);
    donnees.signatures.spie.signature = grosse;
    donnees.signatures.client.signature = grosse;
    const signe = await envoiSigne({ ...req, versionId, pvId, donnees });
    expect(JSON.stringify(signe).length).toBeGreaterThan(1_100_000);
    expect((await tech().put(`/api/pv-versions/${versionId}`, signe)).statusCode).toBe(201);
  });

  it("accepte un refus de signer daté et motivé du client, refuse un refus sans motif ou sans date", async () => {
    const { versionId, pvId, req } = await pvSite(new Date("2026-11-19T11:30:00Z"));
    const donnees = structuredClone(req.donnees);
    donnees.signatures.client = {
      nom: "",
      date: "2026-11-19",
      signature: null,
      commentaires: "",
      refus: { motif: "" },
    };
    const sansMotif = await envoiSigne({ ...req, versionId, pvId, donnees });
    expect((await tech().put(`/api/pv-versions/${versionId}`, sansMotif)).statusCode).toBe(400);
    donnees.signatures.client = {
      ...donnees.signatures.client,
      date: "",
      refus: { motif: "Désaccord sur la réserve n°1" },
    };
    const sansDate = await envoiSigne({ ...req, versionId, pvId, donnees });
    const refusSansDate = await tech().put(`/api/pv-versions/${versionId}`, sansDate);
    expect(refusSansDate.statusCode).toBe(400);
    expect(refusSansDate.body).toContain("Date du refus de signer manquante.");
    donnees.signatures.client.date = "2026-11-19";
    const motive = await envoiSigne({ ...req, versionId, pvId, donnees });
    expect((await tech().put(`/api/pv-versions/${versionId}`, motive)).statusCode).toBe(201);
    expect(PNG.startsWith("data:image/png")).toBe(true);
  });

  it("refuse un équipement d'une autre affaire", async () => {
    const { versionId, req } = await pvSite(new Date("2026-11-19T12:00:00Z"));
    const faux = await envoiSigne({ ...req, versionId, equipementId: randomUUID() });
    expect((await tech().put(`/api/pv-versions/${versionId}`, faux)).statusCode).toBe(400);
  });
});

describe("PV affecté à deux techniciens : le premier qui signe l'emporte", () => {
  const agathe = () => as(t, s.autreTechToken);

  it("le second voit qui a signé et quand ; son envoi est refusé avec ces informations", async () => {
    await as(t, s.adminToken).put(`/api/admin/affaires/${s.affaire.id}/affectations`, {
      userIds: [s.prepId, s.techId, s.autreTechId],
    });
    await as(t, s.prepToken).put(`/api/prep/pv/${pvF2.pvId}/affectations`, { userIds: [s.techId, s.autreTechId] });
    const dansReference = async (who: ReturnType<typeof tech>) =>
      (await who.get("/api/sync/reference")).json<SyncReferenceDto>().pvs.some((p) => p.versionId === pvF2.versionId);
    expect(await dansReference(tech())).toBe(true);
    expect(await dansReference(agathe())).toBe(true);

    // Agathe signe et envoie la première.
    const signeAgathe = await agathe().put(
      `/api/pv-versions/${pvF2.versionId}`,
      await envoiDuPrepare(pvF2, "Agathe Autre"),
    );
    expect(signeAgathe.statusCode).toBe(201);
    expect(signeAgathe.json<PvVersionStatusDto>()).toMatchObject({
      statut: "recu",
      signePar: "Agathe Autre",
      signeLe: "2026-11-19T15:00:00.000Z",
    });

    // La tablette de Théo ne reçoit plus le PV comme « préparé » ; le statut lui dit qui l'a signé.
    expect(await dansReference(tech())).toBe(false);
    expect((await tech().get(`/api/pv-versions/${pvF2.versionId}/status`)).json<PvVersionStatusDto>()).toMatchObject({
      statut: "recu",
      signePar: "Agathe Autre",
      signeLe: "2026-11-19T15:00:00.000Z",
    });

    // S'il signe quand même (hors ligne), son envoi est refusé avec un message explicite.
    const signeTheo = await tech().put(
      `/api/pv-versions/${pvF2.versionId}`,
      await envoiDuPrepare(pvF2, "Théo Technicien", (d) => {
        d.generalites.lieu = "Lieu saisi par Théo";
      }),
    );
    expect(signeTheo.statusCode).toBe(409);
    expect(signeTheo.json().error.message).toBe(
      "Ce PV a déjà été signé par Agathe Autre le 19/11/2026 16:00 et reçu par le serveur : cette version n'est pas prise en compte.",
    );
  });
});
