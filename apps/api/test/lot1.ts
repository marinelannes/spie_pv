import {
  empreintePv,
  type AffaireDetailDto,
  type PvDetailDto,
  type PvRelaisData,
  type SharePointBrowseResponse,
  type UploadPvVersionRequest,
} from "@spie/shared";
import ExcelJS from "exceljs";
import { bearer, login, seedUser, type TestApp } from "./helpers.js";

/** Plus petit PNG valide (1×1), pour les signatures de test. */
export const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const CARTOUCHE = (ws: ExcelJS.Worksheet, titre: string, affaire: string) => {
  ws.getCell("B1").value = titre;
  ws.getCell("E1").value = "N° Document\nDEMO1_AUT_009";
  ws.getCell("E4").value = `N° AFF : ${affaire}`;
  ws.getCell("E5").value = "Statut : Rev B";
};

/**
 * Classeur de liste E/S au format de DEMO1_AUT_009 (en-tête en ligne 6, données à partir de la ligne 7) :
 * deux départs batterie (feuille TYPE BATTERIE), deux relais HTB à associer à la main, dont un qui partage la feuille
 * HTB_TR1 avec un autre équipement (colonne TAG).
 */
export async function classeurEs(affaire = "A00001"): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const rev = wb.addWorksheet("REV");
  rev.getCell("F1").value = "LISTE ENTREES / SORTIES \nRPN";
  rev.getCell("U1").value = "N° Document\nDEMO1_AUT_009";
  rev.getCell("U4").value = `N° AFF : ${affaire}`;
  rev.getCell("U5").value = "Statut : Rev B";

  const eq = wb.addWorksheet("LISTE DES EQUIPEMENTS");
  eq.getCell("B1").value = "LISTE DES EQUIPEMENTS";
  eq.getCell("I1").value = "N° Document\nDEMO1_AUT_009";
  eq.getCell("I4").value = `N° AFF : ${affaire}`;
  eq.getCell("I5").value = "Statut : Rev B";
  eq.getRow(6).values = [
    "LIBELLE",
    "TYPE",
    "TYPE CELLULE",
    "TAG",
    "EQUIPEMENT",
    "MODELE",
    "LOCAL",
    "TAG ARMOIRE",
    "REFERENCE CONSTRUCTEUR",
  ];
  const equipements = [
    [
      "RELAIS DE PROTECTION NUMERIQUE DEPART F1",
      "HTA",
      "TYPE BATTERIE",
      "RPN_HTA_F1",
      "RELAIS SIPROTEC 5",
      "COMPACT - 7SX8000",
      "LOCAL HTA - ZONE NORD",
      "ZN_HTA_1ESS01_C03",
    ],
    [
      "RELAIS DE PROTECTION NUMERIQUE DEPART F2",
      "HTA",
      "TYPE BATTERIE",
      "RPN_HTA_F2",
      "RELAIS SIPROTEC 5",
      "COMPACT - 7SX8000",
      "LOCAL HTA - ZONE NORD",
      "ZN_HTA_1ESS01_C04",
    ],
    [
      "RELAIS PROTECTION NUMERIQUE PROTECTION DIFFERENTIELLE TR",
      "HTB",
      "HTB",
      "RPN_HTB_DIFF_TR",
      "RELAIS SIPROTEC 5",
      "7UT85",
      "LOCAL HTA - ZONE NORD",
      "ZN_HTB_1G02",
    ],
    [
      "RELAIS PROTECTION NUMERIQUE PROTECTION BOBINE POINT NEUTRE",
      "HTB",
      "HTB",
      "RPN_HTB_MCN_TR",
      "RELAIS SIPROTEC 5",
      "COMPACT - 7SX8000",
      "LOCAL HTA - ZONE NORD",
      "ZN_HTB_1G02",
    ],
  ];
  equipements.forEach((e, i) => (eq.getRow(7 + i).values = e));

  const bat = wb.addWorksheet("TYPE BATTERIE");
  CARTOUCHE(bat, "LISTE DES ENTREES / SORTIES \nRELAIS PROTECTION NUMERIQUE\nTYPE DEPART BATTERIE", affaire);
  bat.getRow(6).values = ["CARTES", "TAG CELLULE / EQUIPEMENT", "TYPE", "COMMENTAIRE", "ADRESSE"];
  [
    ["RPN_HTA / PS050_1", "-", "ENTREE TOR", "SURVEILLANCE CIRCUIT DECLENCHEMENT", "BI 1.01"],
    ["RPN_HTA / IO60_1", "-", "ENTREE TOR", "RESERVE", "BI 2.11"],
    ["RPN_HTA / PS050_1", "-", "SORTIE TOR", "DÉCLENCHEMENT DISJ. MBO1", "BO 1.01"],
    ["RPN_HTA / PS050_1", "-", "ENTREE ANALOGIQUE", "COURANT PHASE 1", "I1"],
  ].forEach((r, i) => (bat.getRow(7 + i).values = r));

  const tr = wb.addWorksheet("HTB_TR1");
  CARTOUCHE(tr, "LISTE DES ENTREES / SORTIES \nRELAIS PROTECTION NUMERIQUE TRANCHE TR1 - HTB-TTR", affaire);
  tr.getRow(6).values = ["CARTES", "TAG CELLULE / EQUIPEMENT", "TYPE", "COMMENTAIRE", "ADRESSE"];
  [
    ["RPN_HTB / IO203", "PROTECTION TRANSFO DIF.", "E TOR", "BUCHHOLZ ALARME", "BI 1.01"],
    ["RPN_HTB / IO203", "PROTECTION TRANSFO DIF.", "S TOR", "DECLENCHEMENT DISJ. HTB", "BO 1.01"],
    ["RPN_HTB / IO203", "PROTECTION TRANSFO DIF.", "E ANA", "RESERVE CABLEE", "I1"],
    ["RPN_HTB / PS050", "PROTECTION TRANSFO BOBINE POINT NEUTRE", "E TOR", "DEFAUT BOBINE", "BI 1.01"],
    ["RPN_HTB / PS050", "PROTECTION TRANSFO BOBINE POINT NEUTRE", "E ANA", "COURANT MASSE GRILLE HTA", "I2"],
  ].forEach((r, i) => (tr.getRow(7 + i).values = r));

  return Buffer.from(await wb.xlsx.writeBuffer()).toString("base64");
}

export interface Scenario {
  adminToken: string;
  prepToken: string;
  techToken: string;
  autreTechToken: string;
  adminId: string;
  prepId: string;
  techId: string;
  autreTechId: string;
  affaire: AffaireDetailDto;
}

export const as = (t: TestApp, token: string) => ({
  get: (url: string) => t.app.inject({ method: "GET", url, headers: bearer(token) }),
  post: (url: string, payload?: object) => t.app.inject({ method: "POST", url, headers: bearer(token), payload }),
  put: (url: string, payload: object) => t.app.inject({ method: "PUT", url, headers: bearer(token), payload }),
  del: (url: string) => t.app.inject({ method: "DELETE", url, headers: bearer(token) }),
});

/**
 * Comptes (admin, préparateur, deux techniciens), affaire A00001 dont le dossier SharePoint est celui de l'arborescence
 * d'exemple du SharePoint simulé ; préparateur et premier technicien affectés.
 */
export async function scenario(t: TestApp, numero = "A00001"): Promise<Scenario> {
  const adminId = (await seedUser(t.db, { email: "admin@spie.test", nom: "Alice Admin", role: "admin" })).id;
  const prepId = (await seedUser(t.db, { email: "prep@spie.test", nom: "Paul Préparateur", role: "preparateur" })).id;
  const techId = (await seedUser(t.db, { email: "tech@spie.test", nom: "Théo Technicien", role: "technicien" })).id;
  const autreTechId = (await seedUser(t.db, { email: "autre@spie.test", nom: "Agathe Autre", role: "technicien" })).id;
  const adminToken = (await login(t.app, "admin@spie.test")).accessToken;
  const prepToken = (await login(t.app, "prep@spie.test")).accessToken;
  const techToken = (await login(t.app, "tech@spie.test")).accessToken;
  const autreTechToken = (await login(t.app, "autre@spie.test")).accessToken;

  const admin = as(t, adminToken);
  const drives = (await admin.get("/api/admin/sharepoint/browse")).json<SharePointBrowseResponse>();
  const driveId = drives.items[0]!.driveId;
  const racine = (await admin.get(`/api/admin/sharepoint/browse?driveId=${driveId}`)).json<SharePointBrowseResponse>();
  const dossierAffaires = racine.items.find((i) => i.name === "Affaires")!;
  const affairesDir = (
    await admin.get(`/api/admin/sharepoint/browse?driveId=${driveId}&itemId=${dossierAffaires.id}`)
  ).json<SharePointBrowseResponse>();
  const dossier = affairesDir.items[0]!;
  const res = await admin.post("/api/admin/affaires", {
    numero,
    client: "CLIENT DEMO INDUSTRIES SAS",
    projet: "Stockage batteries – DEMO1",
    site: "DEMO1",
    valideParDefaut: "V. VALIDEUR",
    approuveParDefaut: "A. APPROBATEUR",
    dossierSharePoint: { driveId, itemId: dossier.id, path: dossier.name, webUrl: null },
  });
  if (res.statusCode !== 201) throw new Error(`affaire : ${res.body}`);
  const affaire = res.json<AffaireDetailDto>();
  await admin.put(`/api/admin/affaires/${affaire.id}/affectations`, { userIds: [prepId, techId] });
  return { adminToken, prepToken, techToken, autreTechToken, adminId, prepId, techId, autreTechId, affaire };
}

/** Complète un PV comme le ferait le technicien : relevés, jugements, conclusion, statut et signatures. */
export function completer(d: PvRelaisData, signataire: string): PvRelaisData {
  const c = structuredClone(d);
  const juge = <T extends { jugement: unknown }>(x: T) => ({ ...x, jugement: "C" as const });
  c.generalites.lieu = "Poste DEMO1";
  c.generalites.dates = "Semaine 47 (19/11/2026)";
  c.identification = c.identification.map((f) => (f.id === "numero-serie" ? { ...f, valeur: "BF2511000123" } : f));
  c.testsPreliminaires = c.testsPreliminaires.map((x) => ({ ...juge(x), valeur: "125 V" }));
  c.configuration = { nomFichier: "DEMO1_RPN_HTA_F1.dex5", jugement: "C" };
  const cm = c.circuitsMesure;
  cm.transformateurs = cm.transformateurs.map(juge);
  cm.champTournant = { valeur: "Direct", jugement: "C" };
  cm.sensCablage = cm.sensCablage.map(juge);
  cm.systemeEquilibre.lignes = cm.systemeEquilibre.lignes.map(juge);
  cm.systemeDesequilibre.lignes = cm.systemeDesequilibre.lignes.map(juge);
  cm.defautTerre = cm.defautTerre.map(juge);
  cm.controleTresse = juge(cm.controleTresse);
  c.es.points = c.es.points.map((p) =>
    p.reserve
      ? p
      : {
          ...p,
          teste: "C",
          leds: "OK",
          relais: "OK",
          scada: "C",
          saisie: { par: signataire, le: "2026-11-19T14:00:00.000Z" },
        },
  );
  c.conclusion = { materiel: "accepte" };
  c.entete.statutDocument = "CMS";
  c.signatures = {
    spie: { nom: signataire, date: "2026-11-19", signature: PNG, commentaires: "" },
    client: { nom: "M. Client", date: "2026-11-19", signature: PNG, commentaires: "RAS", refus: null },
  };
  return c;
}

/** Requête d'envoi d'un PV signé, avec l'empreinte SHA-256 calculée comme sur la tablette. */
export async function envoiSigne(
  args: Pick<UploadPvVersionRequest, "pvId" | "affaireId" | "equipementId" | "numero" | "indice" | "donnees"> & {
    versionId: string;
    donneesPreparees?: PvRelaisData | null;
    creeLe?: string;
    signeLe?: string;
  },
): Promise<UploadPvVersionRequest> {
  const signeLe = args.signeLe ?? "2026-11-19T15:00:00.000Z";
  return {
    pvId: args.pvId,
    affaireId: args.affaireId,
    equipementId: args.equipementId,
    numero: args.numero,
    indice: args.indice,
    modele: "relais",
    modeleVersion: "1.0.0",
    donnees: args.donnees,
    donneesPreparees: args.donneesPreparees ?? null,
    modifications: [],
    creeLe: args.creeLe ?? "2026-11-19T13:32:05.000Z",
    signeLe,
    tabletteId: "tablette-test",
    empreinte: await empreintePv({
      pvId: args.pvId,
      versionId: args.versionId,
      numero: args.numero,
      indice: args.indice,
      signeLe,
      donnees: args.donnees,
    }),
  };
}

/** Envoi d'un PV préparé, complété et signé par `signataire`. */
export async function envoiDuPrepare(pv: PvDetailDto, signataire: string, modifier?: (d: PvRelaisData) => void) {
  const donnees = completer(pv.donnees, signataire);
  modifier?.(donnees);
  return envoiSigne({
    versionId: pv.versionId,
    pvId: pv.pvId,
    affaireId: pv.affaireId,
    equipementId: pv.equipementId,
    numero: pv.numero,
    indice: pv.indice,
    donnees,
    donneesPreparees: pv.donnees,
  });
}
