import {
  creerPvRelais,
  type AffaireDto,
  type EquipementDto,
  type FeuilleEsDto,
  type PvRelaisData,
  type SyncAffaireDto,
  type SyncPvDto,
} from "@spie/shared";
import type { LocalAffaire } from "../offline/db";

/** Données de test : affaire A35173, deux équipements, liste E/S avec une feuille à deux groupes TAG. */

export const AFFAIRE: AffaireDto = {
  id: "00000000-0000-4000-8000-00000000a001",
  numero: "A35173",
  client: "HUAWEI",
  projet: "Stockage batteries – GAU11",
  site: "Gaudonville",
  valideParDefaut: "F. BUCAU",
  approuveParDefaut: "F. DELORDI",
  dossierSharePoint: null,
  archivee: false,
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
};

const pt = (id: string, adresse: string, designation: string, tag: string, reserve = false) => ({
  id,
  ordre: 0,
  carte: "RPN_HTB / PS050",
  tag,
  type: "entree_tor" as const,
  designation,
  adresse,
  reserve,
});

export const FEUILLE: FeuilleEsDto = {
  id: "00000000-0000-4000-8000-0000000f0001",
  nom: "HTB_TR1",
  titre: "LISTE DES ENTREES / SORTIES",
  groupesTag: ["PROTECTION TRANSFO DIF.", "PROTECTION TRANSFO BOBINE POINT NEUTRE"],
  points: [
    pt("00000000-0000-4000-8000-0000000e0001", "BI 1.01", "DISJ OUVERT", "PROTECTION TRANSFO DIF."),
    pt("00000000-0000-4000-8000-0000000e0002", "BI 1.02", "RESERVE", "PROTECTION TRANSFO DIF.", true),
    pt("00000000-0000-4000-8000-0000000e0003", "BI 1.01", "DEFAUT BOBINE", "PROTECTION TRANSFO BOBINE POINT NEUTRE"),
  ],
};

const eq = (
  id: string,
  tag: string,
  filtreTag: string | null,
  feuilleEsId: string | null = FEUILLE.id,
): EquipementDto => ({
  id,
  affaireId: AFFAIRE.id,
  tag,
  libelle: `RELAIS ${tag}`,
  niveauTension: "HTB",
  typeCellule: "HTB",
  equipement: "RELAIS SIPROTEC 5",
  modele: "7UT85",
  local: "LOCAL HTA",
  tagArmoire: "ZN_HTB_1G02",
  referenceConstructeur: "",
  feuilleEsId,
  feuilleNom: feuilleEsId ? FEUILLE.nom : null,
  filtreTag,
  nbPointsEs: 0,
  avancement: { nbPv: 0, deposes: 0, enCours: 0 },
});

export const EQ_DIFF = eq("00000000-0000-4000-8000-00000000e001", "RPN_HTB_DIFF_TR", "PROTECTION TRANSFO DIF.");
export const EQ_MCN = eq(
  "00000000-0000-4000-8000-00000000e002",
  "RPN_HTB_MCN_TR",
  "PROTECTION TRANSFO BOBINE POINT NEUTRE",
);
/** Relais HTB sans feuille d'E/S associée. */
export const EQ_SANS = eq("00000000-0000-4000-8000-00000000e003", "RPN_HTB_DIFF_TL", null, null);
/** Régulateur de tension : pas de modèle de PV (spec §4.5). */
export const EQ_REGULATEUR = {
  ...eq("00000000-0000-4000-8000-00000000e004", "RGU_HTB_TR", null, null),
  libelle: "REGULATEUR DE TENSION HTB TRANCHE TRANSFO TR1",
};

export const SYNC_AFFAIRE: SyncAffaireDto = {
  affaire: AFFAIRE,
  equipements: [EQ_DIFF, EQ_MCN, EQ_SANS],
  liste: {
    id: "00000000-0000-4000-8000-0000000c0001",
    affaireId: AFFAIRE.id,
    referenceDocument: "GAU11_AUT_009",
    revision: "B",
    version: 2,
    fichierSource: "GAU11.xlsx",
    importeLe: "2026-11-13T10:00:00.000Z",
    importePar: "Paul",
    nbFeuilles: 1,
    nbPoints: 3,
    anomalies: [],
    feuilles: [FEUILLE],
  },
};

export const LOCAL_AFFAIRE: LocalAffaire = {
  id: AFFAIRE.id,
  affaire: AFFAIRE,
  equipements: SYNC_AFFAIRE.equipements,
  liste: SYNC_AFFAIRE.liste,
  synchroLe: "2026-11-19T08:00:00.000Z",
};

export function donneesPreparees(): PvRelaisData {
  const d = creerPvRelais({
    affaire: AFFAIRE,
    es: {
      listeId: SYNC_AFFAIRE.liste!.id,
      listeVersion: 2,
      referenceDocument: "GAU11_AUT_009",
      revision: "B",
      feuille: "HTB_TR1",
      filtreTag: "PROTECTION TRANSFO DIF.",
      points: FEUILLE.points.slice(0, 2),
    },
    date: "2026-11-18",
    modeleRelais: "7UT85",
  });
  d.generalites.lieu = "Poste GAU11";
  return d;
}

export function syncPv(overrides: Partial<SyncPvDto> = {}): SyncPvDto {
  return {
    pvId: "00000000-0000-4000-8000-0000000b0001",
    versionId: "00000000-0000-4000-8000-0000000d0001",
    numero: "A35173-20261118-090000",
    indice: "A",
    modele: "relais",
    modeleVersion: "1.0.0",
    affaireId: AFFAIRE.id,
    equipementId: EQ_DIFF.id,
    statut: "prepare",
    donnees: donneesPreparees(),
    creeLe: "2026-11-18T08:30:00.000Z",
    misAJourLe: "2026-11-18T09:00:00.000Z",
    ...overrides,
  };
}

/** Complète toutes les rubriques obligatoires d'un PV pour qu'il puisse être signé. */
export function completer(d: PvRelaisData): PvRelaisData {
  const j = <T extends { jugement: unknown }>(x: T) => ({ ...x, jugement: "C" as const });
  const cm = d.circuitsMesure;
  return {
    ...d,
    entete: { ...d.entete, numeroDocument: d.entete.numeroDocument || "GAU11_AUT_009", statutDocument: "CMS" },
    generalites: { ...d.generalites, lieu: d.generalites.lieu || "Poste", dates: "Semaine 47" },
    testsPreliminaires: d.testsPreliminaires.map(j),
    configuration: { nomFichier: "fichier.cfg", jugement: "C" },
    circuitsMesure: {
      ...cm,
      transformateurs: cm.transformateurs.map(j),
      champTournant: { valeur: "Direct", jugement: "C" },
      sensCablage: cm.sensCablage.map(j),
      systemeEquilibre: { ...cm.systemeEquilibre, lignes: cm.systemeEquilibre.lignes.map(j) },
      systemeDesequilibre: { ...cm.systemeDesequilibre, lignes: cm.systemeDesequilibre.lignes.map(j) },
      defautTerre: cm.defautTerre.map(j),
      controleTresse: j(cm.controleTresse),
    },
    es: { ...d.es, points: d.es.points.map((p) => (p.teste ? p : { ...p, teste: "C" as const })) },
    conclusion: { materiel: "accepte" },
    signatures: {
      spie: {
        nom: "Théo Technicien",
        date: "2026-11-19",
        signature: "data:image/png;base64,iVBORw0KGgo=",
        commentaires: "",
      },
      client: {
        nom: "M. Client",
        date: "2026-11-19",
        signature: "data:image/png;base64,iVBORw0KGgo=",
        commentaires: "",
        refus: null,
      },
    },
  };
}

/** Réponse JSON pour un `fetch` simulé. */
export function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function apiErreur(status: number, code: string, message: string): Response {
  return json(status, { error: { code, message } });
}
