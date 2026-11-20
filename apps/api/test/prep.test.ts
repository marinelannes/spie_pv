import type {
  AuditEntryDto,
  EquipementDto,
  IoImportAnalyseDto,
  IoImportResultDto,
  ListeEsDetailDto,
  PrepAffaireDto,
  PvDetailDto,
  PvResumeDto,
} from "@spie/shared";
import { nouvelleFonction } from "@spie/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { equipements } from "../src/db/schema.js";
import { createTestApp, type TestApp } from "./helpers.js";
import { as, classeurEs, scenario, type Scenario } from "./lot1.js";

let t: TestApp;
let s: Scenario;
let contenu: string;

beforeAll(async () => {
  t = await createTestApp();
  s = await scenario(t);
  contenu = await classeurEs();
});
afterAll(() => t.close());

const prep = () => as(t, s.prepToken);
const ASSOC_HTB = [
  { tag: "RPN_HTB_DIFF_TR", feuille: "HTB_TR1", filtreTag: "PROTECTION TRANSFO DIF." },
  { tag: "RPN_HTB_MCN_TR", feuille: "HTB_TR1", filtreTag: "PROTECTION TRANSFO BOBINE POINT NEUTRE" },
];

async function affaire(): Promise<PrepAffaireDto> {
  return (await prep().get(`/api/prep/affaires/${s.affaire.id}`)).json<PrepAffaireDto>();
}
const eqParTag = async (tag: string) => (await affaire()).equipements.find((e) => e.tag === tag)!;

describe("accès au back-office de préparation (spec §7.3)", () => {
  it("le technicien n'y a pas accès ; le préparateur ne voit que ses affaires", async () => {
    expect((await as(t, s.techToken).get("/api/prep/affaires")).statusCode).toBe(403);
    expect((await prep().get("/api/prep/affaires")).json().map((a: { numero: string }) => a.numero)).toEqual([
      "A35173",
    ]);
    // Une affaire à laquelle le préparateur n'est pas affecté.
    const autre = await as(t, s.adminToken).post("/api/admin/affaires", { numero: "A99999", client: "X", projet: "Y" });
    expect((await prep().get(`/api/prep/affaires/${autre.json().id}`)).statusCode).toBe(403);
    expect((await as(t, s.adminToken).get(`/api/prep/affaires/${autre.json().id}`)).statusCode).toBe(200);
  });
});

describe("import de la liste E/S (spec §4.4)", () => {
  it("analyse sans enregistrer : associations automatiques par TYPE CELLULE, anomalies, groupes TAG", async () => {
    const res = await prep().post(`/api/prep/affaires/${s.affaire.id}/io-lists/analyse`, {
      fichier: "GAU11_AUT_009_LISTE ENTREES SORTIES RPN_B.xlsx",
      contenuBase64: contenu,
    });
    expect(res.statusCode).toBe(200);
    const a = res.json<IoImportAnalyseDto>();
    expect(a).toMatchObject({ reference: "GAU11_AUT_009", revision: "B", numeroAffaire: "A35173", bloquant: false });
    const assoc = Object.fromEntries(a.equipements.map((e) => [e.tag, e.association]));
    expect(assoc.RPN_HTA_F1).toMatchObject({ feuille: "TYPE BATTERIE", mode: "auto" });
    expect(assoc.RPN_HTB_DIFF_TR).toMatchObject({ feuille: null, mode: "aucune" });
    expect(a.anomalies.some((x) => x.code === "equipement_sans_feuille")).toBe(true);
    expect(a.feuilles.find((f) => f.nom === "HTB_TR1")?.groupesTag).toEqual([
      "PROTECTION TRANSFO DIF.",
      "PROTECTION TRANSFO BOBINE POINT NEUTRE",
    ]);
    expect(a.feuilles.find((f) => f.nom === "TYPE BATTERIE")).toMatchObject({ nbPoints: 4, nbReserves: 1 });
    expect((await affaire()).listes).toEqual([]);
  });

  it("refuse le fichier d'une autre affaire et un contenu illisible", async () => {
    const autre = await prep().post(`/api/prep/affaires/${s.affaire.id}/io-lists`, {
      fichier: "x.xlsx",
      contenuBase64: await classeurEs("A11111"),
    });
    expect(autre.statusCode).toBe(400);
    expect(autre.json().error.message).toMatch(/Import impossible/);
    const illisible = await prep().post(`/api/prep/affaires/${s.affaire.id}/io-lists/analyse`, {
      fichier: "x.xlsx",
      contenuBase64: "ceci n'est pas du base64 !",
    });
    expect(illisible.statusCode).toBe(400);
    const pasExcel = await prep().post(`/api/prep/affaires/${s.affaire.id}/io-lists/analyse`, {
      fichier: "x.xlsx",
      contenuBase64: Buffer.from("bonjour").toString("base64"),
    });
    expect(pasExcel.statusCode).toBe(400);
    expect(pasExcel.json().error.message).toMatch(/Fichier Excel illisible/);
  });

  it("importe : version 1, équipements créés, feuilles associées (avec filtre TAG pour les relais HTB)", async () => {
    const res = await prep().post(`/api/prep/affaires/${s.affaire.id}/io-lists`, {
      fichier: "GAU11_AUT_009_LISTE ENTREES SORTIES RPN_B.xlsx",
      contenuBase64: contenu,
      associations: ASSOC_HTB,
    });
    expect(res.statusCode).toBe(201);
    const r = res.json<IoImportResultDto>();
    expect(r.liste).toMatchObject({
      version: 1,
      referenceDocument: "GAU11_AUT_009",
      revision: "B",
      nbFeuilles: 2,
      nbPoints: 9,
    });
    expect(r.liste.importePar).toBe("Paul Préparateur");
    expect(r).toMatchObject({ equipementsCrees: 4, equipementsMisAJour: 0 });

    const eqs = Object.fromEntries((await affaire()).equipements.map((e) => [e.tag, e]));
    expect(eqs.RPN_HTA_F1).toMatchObject({
      feuilleNom: "TYPE BATTERIE",
      filtreTag: null,
      nbPointsEs: 4,
      modele: "COMPACT - 7SX8000",
    });
    expect(eqs.RPN_HTB_DIFF_TR).toMatchObject({ feuilleNom: "HTB_TR1", nbPointsEs: 3 });
    expect(eqs.RPN_HTB_MCN_TR).toMatchObject({ feuilleNom: "HTB_TR1", nbPointsEs: 2 });

    const journal = (await as(t, s.adminToken).get("/api/admin/audit")).json<AuditEntryDto[]>();
    expect(journal.find((e) => e.action === "io_liste.importee")?.details).toMatchObject({
      version: 1,
      points: 9,
      equipementsCrees: 4,
    });
  });

  it("détail d'une liste : feuilles et points, réserves repérées", async () => {
    const [liste] = (await affaire()).listes;
    const d = (await prep().get(`/api/prep/io-lists/${liste!.id}`)).json<ListeEsDetailDto>();
    const bat = d.feuilles.find((f) => f.nom === "TYPE BATTERIE")!;
    expect(bat.points.map((p) => [p.adresse, p.type, p.reserve])).toEqual([
      ["BI 1.01", "entree_tor", false],
      ["BI 2.11", "entree_tor", true],
      ["BO 1.01", "sortie_tor", false],
      ["I1", "entree_analogique", false],
    ]);
    expect((await as(t, s.techToken).get(`/api/prep/io-lists/${liste!.id}`)).statusCode).toBe(403);
  });

  it("un nouvel import propose les associations choisies à la main pour la version précédente", async () => {
    const res = await prep().post(`/api/prep/affaires/${s.affaire.id}/io-lists/analyse`, {
      fichier: "GAU11_AUT_009_LISTE ENTREES SORTIES RPN_C.xlsx",
      contenuBase64: contenu,
    });
    const a = res.json<IoImportAnalyseDto>();
    const assoc = Object.fromEntries(a.equipements.map((e) => [e.tag, e.association]));
    expect(assoc).toMatchObject({
      RPN_HTA_F1: { feuille: "TYPE BATTERIE", filtreTag: null, mode: "auto" },
      RPN_HTB_DIFF_TR: { feuille: "HTB_TR1", filtreTag: "PROTECTION TRANSFO DIF.", mode: "reprise" },
      RPN_HTB_MCN_TR: { feuille: "HTB_TR1", filtreTag: "PROTECTION TRANSFO BOBINE POINT NEUTRE", mode: "reprise" },
    });
    expect(a.anomalies.filter((x) => x.code === "equipement_sans_feuille")).toEqual([]);
  });

  it("un nouvel import crée la version 2, met à jour les équipements et garde leurs associations", async () => {
    // Sans associations dans la requête : celles de la version 1 (choisies à la main) sont reprises.
    const res = await prep().post(`/api/prep/affaires/${s.affaire.id}/io-lists`, {
      fichier: "GAU11_AUT_009_LISTE ENTREES SORTIES RPN_C.xlsx",
      contenuBase64: contenu,
    });
    expect(res.json<IoImportResultDto>()).toMatchObject({
      liste: { version: 2 },
      equipementsCrees: 0,
      equipementsMisAJour: 4,
    });
    const a = await affaire();
    expect(a.listes.map((l) => l.version)).toEqual([2, 1]);
    const f1 = a.equipements.find((e) => e.tag === "RPN_HTA_F1")!;
    const v2 = (await prep().get(`/api/prep/io-lists/${a.listes[0]!.id}`)).json<ListeEsDetailDto>();
    expect(v2.feuilles.map((f) => f.id)).toContain(f1.feuilleEsId);
    const eqs = Object.fromEntries(a.equipements.map((e) => [e.tag, e]));
    for (const tag of ["RPN_HTB_DIFF_TR", "RPN_HTB_MCN_TR"]) {
      expect(v2.feuilles.map((f) => f.id)).toContain(eqs[tag]!.feuilleEsId);
    }
    expect(eqs.RPN_HTB_DIFF_TR).toMatchObject({
      feuilleNom: "HTB_TR1",
      filtreTag: "PROTECTION TRANSFO DIF.",
      nbPointsEs: 3,
    });
    expect(eqs.RPN_HTB_MCN_TR).toMatchObject({
      feuilleNom: "HTB_TR1",
      filtreTag: "PROTECTION TRANSFO BOBINE POINT NEUTRE",
      nbPointsEs: 2,
    });
    expect(a.listes[0]!.anomalies.filter((x) => x.code === "equipement_sans_feuille")).toEqual([]);
  });

  it("change l'association d'un équipement ; refuse un filtre TAG inconnu", async () => {
    const mcn = await eqParTag("RPN_HTB_MCN_TR");
    const ok = await prep().put(`/api/prep/equipements/${mcn.id}/association`, {
      feuilleEsId: mcn.feuilleEsId,
      filtreTag: null,
    });
    expect(ok.json<EquipementDto>()).toMatchObject({ filtreTag: null, nbPointsEs: 5 });
    const ko = await prep().put(`/api/prep/equipements/${mcn.id}/association`, {
      feuilleEsId: mcn.feuilleEsId,
      filtreTag: "INCONNU",
    });
    expect(ko.statusCode).toBe(400);
    const remis = await prep().put(`/api/prep/equipements/${mcn.id}/association`, {
      feuilleEsId: mcn.feuilleEsId,
      filtreTag: "PROTECTION TRANSFO BOBINE POINT NEUTRE",
    });
    expect(remis.json<EquipementDto>().nbPointsEs).toBe(2);
    const aucune = await prep().put(`/api/prep/equipements/${mcn.id}/association`, { feuilleEsId: null });
    expect(aucune.json<EquipementDto>()).toMatchObject({ feuilleEsId: null, nbPointsEs: 0 });
    await prep().put(`/api/prep/equipements/${mcn.id}/association`, {
      feuilleEsId: mcn.feuilleEsId,
      filtreTag: "PROTECTION TRANSFO BOBINE POINT NEUTRE",
    });
  });
});

describe("préparation des PV (spec §3.1, §4.6)", () => {
  let pvF1: PvDetailDto;

  it("crée un PV pour un équipement : numéro affaire + date/heure de Paris, E/S de l'équipement, valeurs par défaut", async () => {
    const f1 = await eqParTag("RPN_HTA_F1");
    const res = await prep().post("/api/prep/pv", { affaireId: s.affaire.id, equipementId: f1.id });
    expect(res.statusCode).toBe(201);
    pvF1 = res.json<PvDetailDto>();
    expect(pvF1).toMatchObject({
      numero: "A35173-20261119-143205",
      indice: "A",
      statut: "prepare",
      equipementTag: "RPN_HTA_F1",
      avancementEs: { total: 4, testees: 1, nc: 0 },
    });
    expect(pvF1.donnees.entete).toMatchObject({
      numeroDocument: "GAU11_AUT_009",
      numeroAffaire: "A35173",
      indice: "A",
    });
    expect(pvF1.donnees.revisions[0]).toMatchObject({
      date: "2026-11-19",
      validePar: "F. BUCAU",
      approuvePar: "F. DELORDI",
    });
    expect(pvF1.donnees.identification.find((f) => f.id === "modele")?.valeur).toBe("COMPACT - 7SX8000");
    expect(pvF1.donnees.es).toMatchObject({ feuille: "TYPE BATTERIE", listeVersion: 2, revision: "B" });
    expect(pvF1.donnees.es.points.find((p) => p.reserve)?.teste).toBe("NA");
    expect(pvF1.donneesPreparees).toEqual(pvF1.donnees);
  });

  it("deux PV créés dans la même seconde reçoivent des numéros distincts", async () => {
    const mcn = await eqParTag("RPN_HTB_MCN_TR");
    const p = (
      await prep().post("/api/prep/pv", { affaireId: s.affaire.id, equipementId: mcn.id })
    ).json<PvDetailDto>();
    expect(p.numero).toBe("A35173-20261119-143206");
    expect(p.donnees.es.points.map((x) => x.designation)).toEqual(["DEFAUT BOBINE", "COURANT MASSE GRILLE HTA"]);
    expect(p.donnees.es.filtreTag).toBe("PROTECTION TRANSFO BOBINE POINT NEUTRE");
    expect((await prep().del(`/api/prep/pv/${p.pvId}`)).statusCode).toBe(204);
  });

  it("refuse un équipement d'une autre affaire", async () => {
    const res = await prep().post("/api/prep/pv", {
      affaireId: s.affaire.id,
      equipementId: "00000000-0000-4000-8000-000000000000",
    });
    expect(res.statusCode).toBe(400);
  });

  it("pré-remplit le PV (même schéma que la tablette) et refuse des données invalides", async () => {
    const donnees = structuredClone(pvF1.donnees);
    donnees.fonctions = [
      {
        ...nouvelleFonction(),
        nomLogique: "PHPTOC1",
        libelleFr: "Maximum de courant",
        codeAnsi: "51",
        reglages: "6250A",
        courbe: "DT",
        temps: "100ms",
      },
    ];
    donnees.identification = donnees.identification.map((f) =>
      f.id === "adresse-ip" ? { ...f, valeur: "10.0.0.11" } : f,
    );
    const res = await prep().put(`/api/prep/pv/${pvF1.pvId}`, { donnees });
    expect(res.statusCode).toBe(200);
    pvF1 = res.json<PvDetailDto>();
    expect(pvF1.donnees.fonctions[0]?.nomLogique).toBe("PHPTOC1");
    expect(pvF1.donneesPreparees?.fonctions).toHaveLength(1);

    const invalide = structuredClone(donnees) as unknown as { conclusion: { materiel: string } };
    invalide.conclusion.materiel = "peut-être";
    expect((await prep().put(`/api/prep/pv/${pvF1.pvId}`, { donnees: invalide })).statusCode).toBe(400);
  });

  it("affecte des techniciens de l'affaire, pas les autres", async () => {
    const ok = await prep().put(`/api/prep/pv/${pvF1.pvId}/affectations`, { userIds: [s.techId] });
    expect(ok.json<PvDetailDto>().techniciens).toEqual([{ id: s.techId, nom: "Théo Technicien" }]);
    const ko = await prep().put(`/api/prep/pv/${pvF1.pvId}/affectations`, { userIds: [s.autreTechId] });
    expect(ko.statusCode).toBe(400);
  });

  it("duplique vers un équipement de même type : réglages repris, E/S et identifiants propres à la cible", async () => {
    const f2 = await eqParTag("RPN_HTA_F2");
    const res = await prep().post(`/api/prep/pv/${pvF1.pvId}/duplicate`, { equipementIds: [f2.id] });
    expect(res.statusCode).toBe(201);
    const [copie] = res.json<PvResumeDto[]>();
    expect(copie).toMatchObject({ equipementTag: "RPN_HTA_F2", statut: "prepare", techniciens: [{ id: s.techId }] });
    expect(copie!.numero).not.toBe(pvF1.numero);
    const d = (await prep().get(`/api/prep/pv/${copie!.pvId}`)).json<PvDetailDto>();
    expect(d.donnees.fonctions[0]?.reglages).toBe("6250A");
    expect(d.donnees.identification.find((f) => f.id === "adresse-ip")?.valeur).toBe("");
    expect(d.donnees.es).toMatchObject({ feuille: "TYPE BATTERIE", listeVersion: 2 });
    expect(d.donnees.es.points).toHaveLength(4);
    expect(d.donnees.identification.find((f) => f.id === "modele")?.valeur).toBe("COMPACT - 7SX8000");
    expect(
      (await prep().post(`/api/prep/pv/${pvF1.pvId}/duplicate`, { equipementIds: [pvF1.equipementId] })).statusCode,
    ).toBe(400);
  });

  it("liste de suivi filtrable par affaire, équipement, statut et technicien", async () => {
    const tous = (await prep().get(`/api/prep/pv?affaireId=${s.affaire.id}`)).json<PvResumeDto[]>();
    expect(tous.map((p) => p.equipementTag)).toEqual(["RPN_HTA_F1", "RPN_HTA_F2"]);
    const f1 = await eqParTag("RPN_HTA_F1");
    expect((await prep().get(`/api/prep/pv?equipementId=${f1.id}`)).json<PvResumeDto[]>()).toHaveLength(1);
    expect((await prep().get(`/api/prep/pv?statut=depose`)).json<PvResumeDto[]>()).toHaveLength(0);
    expect((await prep().get(`/api/prep/pv?technicienId=${s.techId}`)).json<PvResumeDto[]>()).toHaveLength(2);
    expect((await prep().get(`/api/prep/pv?technicienId=${s.autreTechId}`)).json<PvResumeDto[]>()).toHaveLength(0);
    expect((await as(t, s.techToken).get(`/api/prep/pv/${pvF1.pvId}`)).statusCode).toBe(403);
  });

  it("avancement par équipement dans la fiche affaire", async () => {
    expect((await eqParTag("RPN_HTA_F1")).avancement).toEqual({ nbPv: 1, deposes: 0, enCours: 1 });
    expect((await eqParTag("RPN_HTB_DIFF_TR")).avancement).toEqual({ nbPv: 0, deposes: 0, enCours: 0 });
  });

  it("un PV dont la saisie a commencé sur tablette ne peut plus être supprimé", async () => {
    await as(t, s.techToken).post("/api/sync/started", { versionIds: [pvF1.versionId] });
    const d = (await prep().get(`/api/prep/pv/${pvF1.pvId}`)).json<PvDetailDto>();
    expect(d.saisieCommenceeLe).not.toBeNull();
    expect((await prep().del(`/api/prep/pv/${pvF1.pvId}`)).statusCode).toBe(409);
  });

  it("suivi : un PV préparé dont la saisie a commencé se filtre « en cours de saisie », plus « préparé »", async () => {
    const tags = async (statut: string) =>
      (await prep().get(`/api/prep/pv?affaireId=${s.affaire.id}&statut=${statut}`))
        .json<PvResumeDto[]>()
        .map((p) => p.equipementTag);
    expect(await tags("brouillon")).toEqual(["RPN_HTA_F1"]);
    expect(await tags("prepare")).toEqual(["RPN_HTA_F2"]);
    // Le statut serveur reste « préparé » : le bureau peut encore modifier la préparation (avec avertissement).
    expect((await prep().get(`/api/prep/pv/${pvF1.pvId}`)).json<PvDetailDto>().statut).toBe("prepare");
  });

  it("régulateur de tension : pas de modèle de PV, ni création ni duplication vers lui (spec §4.5)", async () => {
    const [rgu] = await t.db
      .insert(equipements)
      .values({
        affaireId: s.affaire.id,
        tag: "RGU_HTB_TR",
        libelle: "REGULATEUR DE TENSION HTB TRANCHE TRANSFO TR1",
        niveauTension: "HTB",
        typeCellule: "",
        equipement: "A.EBERLE",
        modele: "REG-DA",
        local: "",
        tagArmoire: "",
        referenceConstructeur: "",
      })
      .returning();
    const avant = (await prep().get(`/api/prep/pv?affaireId=${s.affaire.id}`)).json<PvResumeDto[]>().length;

    const creation = await prep().post("/api/prep/pv", { affaireId: s.affaire.id, equipementId: rgu!.id });
    expect(creation.statusCode).toBe(400);
    expect(creation.json().error.message).toBe(
      "RGU_HTB_TR : aucun modèle de PV pour cet équipement (seuls les relais de protection ont un PV).",
    );

    // Une cible invalide fait échouer toute la duplication : aucune copie partielle.
    const diff = await eqParTag("RPN_HTB_DIFF_TR");
    const dup = await prep().post(`/api/prep/pv/${pvF1.pvId}/duplicate`, { equipementIds: [diff.id, rgu!.id] });
    expect(dup.statusCode).toBe(400);
    expect((await prep().get(`/api/prep/pv?affaireId=${s.affaire.id}`)).json<PvResumeDto[]>()).toHaveLength(avant);
  });
});
