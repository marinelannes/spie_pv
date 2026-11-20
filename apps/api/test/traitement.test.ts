import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AffaireDetailDto,
  AuditEntryDto,
  DepotSuiviDto,
  FamilleSharePointDto,
  PrepAffaireDto,
  PvDetailDto,
  PvDocument,
  PvVersionStatusDto,
} from "@spie/shared";
import { eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { depots } from "../src/db/schema.js";
import { createTestApp, login, type TestApp } from "./helpers.js";
import { as, classeurEs, envoiDuPrepare, scenario, type Scenario } from "./lot1.js";

/** Dossier de l'affaire dans le SharePoint simulé (arborescence d'exemple). */
const dossierAffaire = (t: TestApp) =>
  join(t.dir, "sharepoint", "Documents partagés", "Affaires", "A35173 - Stockage batteries GAU11");

/** Affaire, liste E/S, PV préparé pour RPN_HTA_F1 affecté au technicien, puis signé et envoyé. */
async function pvRecu(t: TestApp, s: Scenario, tag = "RPN_HTA_F1"): Promise<PvVersionStatusDto> {
  const prep = as(t, s.prepToken);
  let a = (await prep.get(`/api/prep/affaires/${s.affaire.id}`)).json<PrepAffaireDto>();
  if (a.listes.length === 0) {
    await prep.post(`/api/prep/affaires/${s.affaire.id}/io-lists`, {
      fichier: "liste.xlsx",
      contenuBase64: await classeurEs(),
    });
    a = (await prep.get(`/api/prep/affaires/${s.affaire.id}`)).json<PrepAffaireDto>();
  }
  const equipementId = a.equipements.find((e) => e.tag === tag)!.id;
  const pv = (await prep.post("/api/prep/pv", { affaireId: s.affaire.id, equipementId })).json<PvDetailDto>();
  await prep.put(`/api/prep/pv/${pv.pvId}/affectations`, { userIds: [s.techId] });
  const res = await as(t, s.techToken).put(
    `/api/pv-versions/${pv.versionId}`,
    await envoiDuPrepare(pv, "Théo Technicien"),
  );
  if (res.statusCode !== 201) throw new Error(res.body);
  return res.json<PvVersionStatusDto>();
}

describe("paramétrage SharePoint : chemin relatif par famille (spec §4.6, §5.2)", () => {
  let t: TestApp;
  let s: Scenario;
  beforeAll(async () => {
    t = await createTestApp();
    s = await scenario(t);
  });
  afterAll(() => t.close());

  it("liste la famille MES (chemin vide par défaut), l'enregistre normalisé, refuse le reste", async () => {
    const admin = as(t, s.adminToken);
    expect((await admin.get("/api/admin/sharepoint/familles")).json<FamilleSharePointDto[]>()).toEqual([
      { famille: "MES", libelle: "Mise en service / essais (PV de test relais)", cheminRelatif: "" },
    ]);
    const ok = await admin.put("/api/admin/sharepoint/familles", {
      familles: [{ famille: "MES", cheminRelatif: " 03 - Mise en service / PV/" }],
    });
    expect(ok.json<FamilleSharePointDto[]>()[0]?.cheminRelatif).toBe("03 - Mise en service/PV");
    expect(
      (await admin.put("/api/admin/sharepoint/familles", { familles: [{ famille: "REC", cheminRelatif: "x" }] }))
        .statusCode,
    ).toBe(400);
    expect(
      (await admin.put("/api/admin/sharepoint/familles", { familles: [{ famille: "MES", cheminRelatif: "../x" }] }))
        .statusCode,
    ).toBe(400);
    expect((await as(t, s.prepToken).get("/api/admin/sharepoint/familles")).statusCode).toBe(403);
  });
});

describe("génération des fichiers et dépôt SharePoint (spec §3.3, §5)", () => {
  let t: TestApp;
  let s: Scenario;
  let recu: PvVersionStatusDto;

  beforeAll(async () => {
    t = await createTestApp();
    s = await scenario(t);
    await as(t, s.adminToken).put("/api/admin/sharepoint/familles", {
      familles: [{ famille: "MES", cheminRelatif: "03 - Mise en service/PV" }],
    });
    recu = await pvRecu(t, s);
  });
  afterAll(() => t.close());

  it("dépose PDF, JSON et XLSX dans le dossier de l'affaire + chemin de la famille ; la version passe à « déposé »", async () => {
    expect(await t.traitement.traiterEchus()).toBe(3);
    const dossier = join(dossierAffaire(t), "03 - Mise en service", "PV");
    for (const d of recu.depots) expect(existsSync(join(dossier, d.nom))).toBe(true);

    const st = (await as(t, s.techToken).get(`/api/pv-versions/${recu.versionId}/status`)).json<PvVersionStatusDto>();
    expect(st.statut).toBe("depose");
    expect(st.depots.every((d) => d.statut === "depose" && d.webUrl?.startsWith("/sharepoint-simule/"))).toBe(true);
    expect(st.depots[0]!.cheminSharePoint).toBe(
      `Documents partagés / Affaires / A35173 - Stockage batteries GAU11 / 03 - Mise en service / PV / ${st.depots[0]!.nom}`,
    );
    expect(t.pdfRendus()).toBe(1);
    expect(await t.traitement.traiterEchus()).toBe(0);
  });

  it("le JSON déposé contient tout le PV : données préparées et saisies, empreinte, versions, métadonnées", async () => {
    const nom = recu.depots.find((d) => d.fichier === "json")!.nom;
    const doc = JSON.parse(
      await readFile(join(dossierAffaire(t), "03 - Mise en service", "PV", nom), "utf8"),
    ) as PvDocument;
    expect(doc).toMatchObject({
      format: "spie-pv/1",
      pv: { id: recu.pvId, numero: recu.numero, modele: "relais", modeleVersion: "1.0.0", famille: "MES" },
      version: { id: recu.versionId, indice: "A", statutDocument: "CMS", signeLe: "2026-11-19T15:00:00.000Z" },
      affaire: { numero: "A35173", client: "HUAWEI TECHNOLOGIES FRANCE" },
      equipement: { tag: "RPN_HTA_F1" },
      listeEs: { reference: "GAU11_AUT_009", revision: "B", version: 1 },
      meta: { tabletteId: "tablette-test", signePar: { nom: "Théo Technicien" } },
    });
    expect(doc.version.empreinte).toMatch(/^[0-9a-f]{64}$/);
    expect(doc.donneesPreparees?.conclusion.materiel).toBeNull();
    expect(doc.donnees.conclusion.materiel).toBe("accepte");
  });

  it("le XLSX déposé reprend la feuille d'E/S complétée des résultats", async () => {
    const nom = recu.depots.find((d) => d.fichier === "xlsx")!.nom;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(
      (await readFile(join(dossierAffaire(t), "03 - Mise en service", "PV", nom))) as unknown as ExcelJS.Buffer,
    );
    const ws = wb.worksheets[0]!;
    expect(ws.name).toBe("TYPE BATTERIE");
    const valeurs = ws.getSheetValues().flat().map(String);
    expect(valeurs).toContain("SURVEILLANCE CIRCUIT DECLENCHEMENT");
    expect(valeurs).toContain("BI 1.01");
  });

  it("le back-office télécharge les fichiers depuis la copie d'archive", async () => {
    const prep = as(t, s.prepToken);
    const pdf = await prep.get(`/api/prep/versions/${recu.versionId}/fichiers/pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect(pdf.headers["content-disposition"]).toContain(recu.depots[0]!.nom);
    expect(pdf.body.startsWith("%PDF")).toBe(true);
    expect((await as(t, s.techToken).get(`/api/prep/versions/${recu.versionId}/fichiers/pdf`)).statusCode).toBe(403);
    expect((await prep.get(`/api/prep/versions/${recu.versionId}/fichiers/docx`)).statusCode).toBe(400);
    expect(await t.archive.get(`pv/A35173/${recu.numero}/${recu.depots[0]!.nom}`)).not.toBeNull();
  });

  it("la fiche affaire compte le PV comme déposé", async () => {
    const a = (await as(t, s.prepToken).get(`/api/prep/affaires/${s.affaire.id}`)).json<PrepAffaireDto>();
    expect(a.equipements.find((e) => e.tag === "RPN_HTA_F1")?.avancement).toEqual({ nbPv: 1, deposes: 1, enCours: 0 });
    const journal = (await as(t, s.adminToken).get("/api/admin/audit?limit=200")).json<AuditEntryDto[]>();
    expect(journal.filter((e) => e.action === "depot.reussi")).toHaveLength(3);
  });

  it("accusé perdu : le même fichier déjà présent (même taille) est considéré comme déposé, jamais écrasé", async () => {
    const [d] = await t.db.select().from(depots).where(eq(depots.versionId, recu.versionId));
    await t.db
      .update(depots)
      .set({ statut: "en_attente", prochaineTentative: t.clock.now(), webUrl: null })
      .where(eq(depots.id, d!.id));
    expect(await t.traitement.traiterEchus()).toBe(1);
    const [apres] = await t.db.select().from(depots).where(eq(depots.id, d!.id));
    expect(apres).toMatchObject({ statut: "depose", tentatives: 0 });
    expect(apres!.webUrl).not.toBeNull();
    expect(t.pdfRendus()).toBe(1); // contenu relu dans l'archive, pas régénéré
  });

  it("un autre fichier du même nom (taille différente) : échec, jamais d'écrasement", async () => {
    const [d] = await t.db.select().from(depots).where(eq(depots.versionId, recu.versionId));
    const chemin = join(dossierAffaire(t), "03 - Mise en service", "PV", d!.nom);
    await writeFile(chemin, "un autre contenu");
    await t.db
      .update(depots)
      .set({ statut: "en_attente", prochaineTentative: t.clock.now() })
      .where(eq(depots.id, d!.id));
    await t.traitement.traiterEchus();
    const [apres] = await t.db.select().from(depots).where(eq(depots.id, d!.id));
    expect(apres).toMatchObject({ statut: "en_attente", tentatives: 1 });
    expect(apres!.derniereErreur).toMatch(/Un autre fichier nommé/);
    expect(await readFile(chemin, "utf8")).toBe("un autre contenu");
  });
});

describe("reprises avec délai croissant puis erreur et relance (spec §5.4)", () => {
  let t: TestApp;
  let s: Scenario;
  let recu: PvVersionStatusDto;

  beforeAll(async () => {
    t = await createTestApp();
    s = await scenario(t);
    // Dossier de l'affaire retiré : chaque dépôt échoue tant que l'administrateur ne l'a pas corrigé.
    await t.app.inject({
      method: "PATCH",
      url: `/api/admin/affaires/${s.affaire.id}`,
      headers: { authorization: `Bearer ${s.adminToken}` },
      payload: { dossierSharePoint: null },
    });
    recu = await pvRecu(t, s);
  });
  afterAll(() => t.close());

  const etat = async () => t.db.select().from(depots).where(eq(depots.versionId, recu.versionId));

  it("reprend après 1 min, 5 min, 30 min, 2 h, 6 h, puis passe en Erreur avec alerte", async () => {
    const delais = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000];
    expect(await t.traitement.traiterEchus()).toBe(3);
    for (const [i, delai] of delais.entries()) {
      const rows = await etat();
      expect(rows.every((r) => r.statut === "en_attente" && r.tentatives === i + 1)).toBe(true);
      expect(rows[0]!.derniereErreur).toMatch(/n'a pas de dossier SharePoint cible/);
      expect(rows[0]!.prochaineTentative!.getTime() - t.clock.now().getTime()).toBe(delai);
      t.clock.advance(delai - 1000);
      expect(await t.traitement.traiterEchus()).toBe(0); // pas encore échu
      t.clock.advance(1000);
      expect(await t.traitement.traiterEchus()).toBe(3);
    }
    const rows = await etat();
    expect(rows.every((r) => r.statut === "erreur" && r.tentatives === 6 && r.prochaineTentative === null)).toBe(true);
    // L'horloge a avancé de plus de 8 h : les jetons d'accès (15 min) ont expiré, on se reconnecte.
    s.techToken = (await login(t.app, "tech@spie.test")).accessToken;
    s.adminToken = (await login(t.app, "admin@spie.test")).accessToken;
    s.prepToken = (await login(t.app, "prep@spie.test")).accessToken;
    const st = (await as(t, s.techToken).get(`/api/pv-versions/${recu.versionId}/status`)).json<PvVersionStatusDto>();
    expect(st.statut).toBe("erreur");
    // Le PDF n'a été produit qu'une fois : les reprises relisent la copie d'archive.
    expect(t.pdfRendus()).toBe(1);
  });

  it("le back-office liste les dépôts en erreur (alerte) ; réservé à l'administrateur", async () => {
    const res = await as(t, s.adminToken).get("/api/admin/depots?statut=erreur");
    const liste = res.json<DepotSuiviDto[]>();
    expect(liste).toHaveLength(3);
    expect(liste[0]).toMatchObject({
      numero: recu.numero,
      affaireNumero: "A35173",
      equipementTag: "RPN_HTA_F1",
      statut: "erreur",
      tentatives: 6,
    });
    expect((await as(t, s.prepToken).get("/api/admin/depots")).statusCode).toBe(403);
    const journal = (await as(t, s.adminToken).get("/api/admin/audit?limit=200")).json<AuditEntryDto[]>();
    expect(journal.filter((e) => e.action === "depot.erreur")).toHaveLength(3);
  });

  it("après correction, la relance par l'administrateur dépose le PV", async () => {
    const admin = as(t, s.adminToken);
    const drive = (await admin.get("/api/admin/sharepoint/browse")).json<{ items: { driveId: string }[] }>().items[0]!
      .driveId;
    const patch = await t.app.inject({
      method: "PATCH",
      url: `/api/admin/affaires/${s.affaire.id}`,
      headers: { authorization: `Bearer ${s.adminToken}` },
      payload: { dossierSharePoint: { driveId: drive, itemId: "root", path: "Documents partagés", webUrl: null } },
    });
    expect(patch.json<AffaireDetailDto>().dossierSharePoint?.path).toBe("Documents partagés");

    for (const d of (await admin.get("/api/admin/depots?statut=erreur")).json<DepotSuiviDto[]>()) {
      const r = await admin.post(`/api/admin/depots/${d.id}/retry`);
      expect(r.statusCode).toBe(200);
      expect(r.json<DepotSuiviDto>()).toMatchObject({ statut: "en_attente", tentatives: 0 });
    }
    expect(
      (await as(t, s.techToken).get(`/api/pv-versions/${recu.versionId}/status`)).json<PvVersionStatusDto>().statut,
    ).toBe("recu");
    expect(await t.traitement.traiterEchus()).toBe(3);
    expect(
      (await as(t, s.techToken).get(`/api/pv-versions/${recu.versionId}/status`)).json<PvVersionStatusDto>().statut,
    ).toBe("depose");
    const [d] = await etat();
    expect((await admin.post(`/api/admin/depots/${d!.id}/retry`)).statusCode).toBe(409);
    expect((await admin.post(`/api/admin/depots/00000000-0000-4000-8000-000000000000/retry`)).statusCode).toBe(404);
    const journal = (await admin.get("/api/admin/audit?limit=200")).json<AuditEntryDto[]>();
    expect(journal.filter((e) => e.action === "depot.relance")).toHaveLength(3);
  });
});

describe("sous-dossier manquant et SharePoint absent (points ouverts n°13)", () => {
  it("sans création automatique, un sous-dossier manquant met le dépôt en échec", async () => {
    const t = await createTestApp({ SHAREPOINT_CREATE_MISSING_FOLDERS: "false" });
    try {
      const s = await scenario(t);
      await as(t, s.adminToken).put("/api/admin/sharepoint/familles", {
        familles: [{ famille: "MES", cheminRelatif: "04 - Inexistant" }],
      });
      const recu = await pvRecu(t, s);
      await t.traitement.traiterEchus();
      const rows = await t.db.select().from(depots).where(eq(depots.versionId, recu.versionId));
      expect(
        rows.every(
          (r) => r.tentatives === 1 && /sous-dossier « 04 - Inexistant » introuvable/.test(r.derniereErreur ?? ""),
        ),
      ).toBe(true);
    } finally {
      await t.close();
    }
  });

  it("avec création automatique (défaut), le sous-dossier est créé", async () => {
    const t = await createTestApp();
    try {
      const s = await scenario(t);
      await as(t, s.adminToken).put("/api/admin/sharepoint/familles", {
        familles: [{ famille: "MES", cheminRelatif: "04 - Nouveau/PV" }],
      });
      const recu = await pvRecu(t, s);
      expect(await t.traitement.traiterEchus()).toBe(3);
      expect(existsSync(join(dossierAffaire(t), "04 - Nouveau", "PV", recu.depots[0]!.nom))).toBe(true);
    } finally {
      await t.close();
    }
  });

  it("SharePoint désactivé : le dépôt échoue avec un message explicite, mais les fichiers sont archivés", async () => {
    // SharePoint actif pour créer l'affaire, puis traitement sans client SharePoint.
    const t = await createTestApp();
    try {
      const s = await scenario(t);
      const recu = await pvRecu(t, s);
      const { TraitementDepots } = await import("../src/services/traitement.js");
      const { fichiersDeTest } = await import("./helpers.js");
      const sansSp = new TraitementDepots({
        db: t.db,
        sharepoint: null,
        archive: t.archive,
        fichiers: fichiersDeTest().fichiers,
        now: t.clock.now,
        createMissingFolders: true,
      });
      expect(await sansSp.traiterEchus()).toBe(3);
      const rows = await t.db.select().from(depots).where(eq(depots.versionId, recu.versionId));
      expect(
        rows.every((r) => r.derniereErreur === "SharePoint n'est pas configuré sur ce serveur." && r.archiveKey),
      ).toBe(true);
    } finally {
      await t.close();
    }
  });
});

describe("boucle de traitement (worker / API en développement)", () => {
  it("dépose automatiquement après la réception, sans traiter deux fois le même dépôt", async () => {
    const t = await createTestApp();
    try {
      const s = await scenario(t);
      // Deux passes concurrentes : chaque dépôt n'est réservé qu'une fois.
      const recu0 = await pvRecu(t, s);
      const [a, b] = await Promise.all([t.traitement.traiterEchus(), t.traitement.traiterEchus()]);
      expect(a + b).toBe(3);
      expect(
        (await as(t, s.techToken).get(`/api/pv-versions/${recu0.versionId}/status`)).json<PvVersionStatusDto>().statut,
      ).toBe("depose");

      t.traitement.demarrer(50);
      const recu = await pvRecu(t, s, "RPN_HTA_F2"); // la réception réveille la boucle
      const debut = Date.now();
      let statut = "";
      while (Date.now() - debut < 10_000) {
        statut = (await as(t, s.techToken).get(`/api/pv-versions/${recu.versionId}/status`)).json<PvVersionStatusDto>()
          .statut;
        if (statut === "depose") break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(statut).toBe("depose");
      await t.traitement.arreter();
      t.traitement.reveiller(); // sans effet une fois arrêtée
    } finally {
      await t.close();
    }
  });
});
