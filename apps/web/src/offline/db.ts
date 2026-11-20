import type {
  AffaireDto,
  DepotDto,
  EquipementDto,
  ModificationTracee,
  PvRelaisData,
  StatutPv,
  SyncAffaireDto,
  SyncPvDeposeDto,
  UploadPvVersionRequest,
} from "@spie/shared";
import Dexie, { type EntityTable } from "dexie";

/**
 * Stockage local de la tablette (spec §6.2) : IndexedDB via Dexie, **une base par utilisateur** (`spie-pv-<id>`)
 * pour cloisonner les données si une tablette est partagée (spec §7.2).
 */

export interface LocalMeta {
  id: "meta";
  /** Identifiant de la tablette, généré au premier lancement (métadonnée du JSON, spec §5.1). */
  tabletteId: string;
  derniereSynchro: string | null;
  /** Instant du dernier numéro de PV attribué sur ce poste (une seconde par PV, spec §4.1). */
  dernierNumeroLe: string | null;
  /** Décalage serveur − tablette constaté à la dernière synchro (ms), pour information. */
  decalageHorlogeMs: number | null;
}

export interface LocalAffaire {
  id: string;
  affaire: AffaireDto;
  equipements: EquipementDto[];
  liste: SyncAffaireDto["liste"];
  /** PV déposés de l'affaire : leur révision suivante peut être créée (spec §3.4). Absent sur les copies anciennes. */
  deposes?: SyncPvDeposeDto[];
  synchroLe: string;
}

export type OriginePv = "prepare" | "site";

export interface LocalPv {
  versionId: string;
  pvId: string;
  numero: string;
  indice: string;
  modele: "relais";
  modeleVersion: string;
  affaireId: string;
  equipementId: string | null;
  origine: OriginePv;
  statut: StatutPv;
  donnees: PvRelaisData;
  /** État issu de la préparation (null pour un PV créé sur site). */
  donneesPreparees: PvRelaisData | null;
  /** Valeurs préparées modifiées sur site, avec auteur et date (spec §4.2). */
  journal: ModificationTracee[];
  creeLe: string;
  modifieLe: string;
  /** `misAJourLe` de la version du bureau dont la tablette détient la copie. */
  bureauMisAJourLe: string | null;
  saisieCommenceeLe: string | null;
  /** La « saisie commencée » a été signalée au serveur (le préparateur en est averti, spec §6.5). */
  saisieSignalee: boolean;
  /** Le bureau a modifié le PV après le début de la saisie : la version de la tablette fait foi (spec §6.5). */
  versionBureauIgnoree: string | null;
  signeLe: string | null;
  signePar: string | null;
  empreinte: string | null;
  envoyeLe: string | null;
  deposeLe: string | null;
  depots: DepotDto[];
  alerteDoublon: boolean;
  /** Dernière erreur d'envoi ou de dépôt, affichée sur la tablette. */
  erreurEnvoi: string | null;
  /**
   * PV préparé dont la saisie avait commencé ici, mais signé et envoyé depuis une autre tablette (PV affecté à
   * plusieurs techniciens) : la copie locale n'est plus modifiable ni signable. Absent sur les copies anciennes.
   */
  clotAilleurs?: PvClotAilleurs | null;
}

export interface PvClotAilleurs {
  /** Statut de la version sur le serveur (reçu, déposé…). */
  statut: StatutPv;
  signePar: string | null;
  signeLe: string | null;
  /** Date à laquelle la tablette l'a constaté (point de départ de la durée de conservation). */
  constateLe: string;
}

/** Élément de la file d'envoi : la requête est figée à la signature (spec §6.3). */
export interface OutboxItem {
  versionId: string;
  ajouteLe: string;
  payload: UploadPvVersionRequest;
  tentatives: number;
  derniereTentative: string | null;
  derniereErreur: string | null;
  /** Refus définitif du serveur (409, 422, 400, 403) : pas de nouvel essai automatique. */
  bloque: boolean;
}

export type UserDb = Dexie & {
  meta: EntityTable<LocalMeta, "id">;
  affaires: EntityTable<LocalAffaire, "id">;
  pvs: EntityTable<LocalPv, "versionId">;
  outbox: EntityTable<OutboxItem, "versionId">;
};

export function nomBaseUtilisateur(userId: string): string {
  return `spie-pv-${userId}`;
}

export function creerBase(name: string): UserDb {
  const db = new Dexie(name) as UserDb;
  db.version(1).stores({
    meta: "id",
    affaires: "id",
    pvs: "versionId, pvId, affaireId, equipementId, statut",
    outbox: "versionId, ajouteLe",
  });
  return db;
}

const ouvertes = new Map<string, UserDb>();

/** Base locale de l'utilisateur (instance partagée par toute l'application). */
export function baseUtilisateur(userId: string): UserDb {
  const name = nomBaseUtilisateur(userId);
  let db = ouvertes.get(name);
  if (!db) {
    db = creerBase(name);
    ouvertes.set(name, db);
  }
  return db;
}

/** Ferme toutes les bases ouvertes (tests). */
export function fermerBases(): void {
  for (const db of ouvertes.values()) db.close();
  ouvertes.clear();
}

/**
 * Métadonnées en lecture seule, utilisables dans une requête live (`useLive`) : Dexie y interdit toute écriture,
 * donc `lireMeta` (qui crée les métadonnées au premier accès) y échouerait. null avant la première création.
 */
export function metaEnLecture(db: UserDb): Promise<LocalMeta | null> {
  return db.meta.get("meta").then((m) => m ?? null);
}

/** Métadonnées de la base, créées au premier accès (identifiant de tablette). Écrit : jamais dans `useLive`. */
export async function lireMeta(db: UserDb): Promise<LocalMeta> {
  return db.transaction("rw", db.meta, async () => {
    const m = await db.meta.get("meta");
    if (m) return m;
    const meta: LocalMeta = {
      id: "meta",
      tabletteId: globalThis.crypto.randomUUID(),
      derniereSynchro: null,
      dernierNumeroLe: null,
      decalageHorlogeMs: null,
    };
    await db.meta.put(meta);
    return meta;
  });
}

export async function majMeta(db: UserDb, changes: Partial<Omit<LocalMeta, "id">>): Promise<LocalMeta> {
  return db.transaction("rw", db.meta, async () => {
    const m = { ...(await lireMeta(db)), ...changes };
    await db.meta.put(m);
    return m;
  });
}
