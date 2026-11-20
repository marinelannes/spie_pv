import { z } from "zod";
import type { AffaireDto } from "./affaires.js";
import type { FeuilleEsDto, ListeEsDto } from "./io-listes.js";
import type { StatutDocument } from "./jugements.js";
import type { ModificationTracee } from "./pv-modifications.js";
import { pvRelaisDataSchema, type PvRelaisData } from "./pv-relais.js";
import type { StatutDepot, StatutPv, TypeFichier } from "./pv-statuts.js";

/** DTO et requêtes des routes PV : préparation (§4.6), synchronisation (§6.5), envoi (§6.3), suivi et dépôts (§5.4). */

const uuid = z.string().uuid();

export interface EquipementDto {
  id: string;
  affaireId: string;
  tag: string;
  libelle: string;
  niveauTension: string;
  typeCellule: string;
  equipement: string;
  modele: string;
  local: string;
  tagArmoire: string;
  referenceConstructeur: string;
  /** Feuille d'E/S associée (dans la dernière version de la liste), et filtre facultatif sur la colonne TAG. */
  feuilleEsId: string | null;
  feuilleNom: string | null;
  filtreTag: string | null;
  nbPointsEs: number;
  /** Avancement des tests (back-office, spec §4.6). */
  avancement: { nbPv: number; deposes: number; enCours: number };
}

export const setAssociationRequestSchema = z.object({
  feuilleEsId: uuid.nullable(),
  filtreTag: z.string().max(200).nullable().default(null),
});
export type SetAssociationRequest = z.input<typeof setAssociationRequestSchema>;

export interface DepotDto {
  id: string;
  fichier: TypeFichier;
  nom: string;
  statut: StatutDepot;
  tentatives: number;
  derniereErreur: string | null;
  prochaineTentative: string | null;
  webUrl: string | null;
  cheminSharePoint: string | null;
  deposeLe: string | null;
}

export interface TechnicienDto {
  id: string;
  nom: string;
}

export interface PvResumeDto {
  pvId: string;
  versionId: string;
  numero: string;
  indice: string;
  modele: string;
  affaireId: string;
  affaireNumero: string;
  equipementId: string | null;
  equipementTag: string | null;
  equipementLibelle: string | null;
  statut: StatutPv;
  statutDocument: StatutDocument | null;
  techniciens: TechnicienDto[];
  /** La tablette a commencé la saisie : sa version fait foi (spec §6.5). */
  saisieCommenceeLe: string | null;
  signeLe: string | null;
  recuLe: string | null;
  creeLe: string;
  misAJourLe: string;
  /** Valeurs préparées modifiées sur site (spec §4.6, suivi des PV). */
  nbModifications: number;
  avancementEs: { total: number; testees: number; nc: number };
  /** Numéro identique à celui d'un autre PV de l'affaire (spec §4.1 : alerte administrateur). */
  alerteDoublon: boolean;
  depots: DepotDto[];
  /** Nombre de révisions du PV (1 : seule la révision d'origine existe). */
  nbVersions: number;
  /** Récapitulatif des réserves de la version courante (spec §4.3). */
  reserves: RecapReserves;
  /** Indice de la révision qui peut être créée (PV déposé, spec §3.4), null sinon. */
  revisionSuivante: string | null;
}

export interface RecapReserves {
  ouvertes: number;
  levees: number;
}

/** Une révision du PV dans l'historique (spec §3.4 : les révisions précédentes restent, inchangées). */
export interface VersionHistoriqueDto {
  versionId: string;
  indice: string;
  statut: StatutPv;
  statutDocument: StatutDocument | null;
  /** Date et description reprises du tableau des révisions. */
  date: string;
  modifications: string;
  signeLe: string | null;
  signePar: string | null;
  reserves: RecapReserves;
  depots: DepotDto[];
}

export interface PvDetailDto extends PvResumeDto {
  donnees: PvRelaisData;
  donneesPreparees: PvRelaisData | null;
  modifications: ModificationTracee[];
  empreinte: string | null;
  /** Toutes les révisions, de la plus ancienne à la plus récente. */
  historique: VersionHistoriqueDto[];
}

// --- Révisions et réserves (spec §3.4, §4.3, lot 2) ---------------------------------------------------------------

/** Création de la révision suivante : la description alimente le tableau des révisions. */
export const createRevisionRequestSchema = z.object({
  modifications: z.string().trim().min(1, "Décrivez la modification.").max(500),
  /**
   * Le demandeur complétera lui-même la révision (création depuis la tablette) : il devient l'un des techniciens
   * du PV, quel que soit son rôle, comme pour un PV créé sur site. Faux quand le bureau prépare la réouverture.
   */
  affecter: z.boolean().default(false),
});
export type CreateRevisionRequest = z.input<typeof createRevisionRequestSchema>;

export const reservesQuerySchema = z.object({
  affaireId: uuid.optional(),
  statut: z.enum(["ouverte", "levee"]).optional(),
  criticite: z.enum(["bloquante", "non_bloquante", "aucune"]).optional(),
});
export type ReservesQuery = z.infer<typeof reservesQuerySchema>;

/** Réserve dans le suivi du back-office : état à la dernière révision signée du PV. */
export interface ReserveSuiviDto {
  id: string;
  pvId: string;
  versionId: string;
  numeroPv: string;
  /** Indice de la dernière révision signée, dont la réserve reflète l'état. */
  indicePv: string;
  affaireId: string;
  affaireNumero: string;
  equipementTag: string | null;
  numero: number;
  controle: string;
  description: string;
  criticite: "bloquante" | "non_bloquante" | null;
  responsable: string;
  /** AAAA-MM-JJ, vide si non renseignée. */
  datePrevue: string;
  statut: "ouverte" | "levee";
  indiceCreation: string;
  levee: { date: string; commentaire: string; indice: string } | null;
  /** Ouverte et date prévue de levée dépassée. */
  enRetard: boolean;
  /** Une révision suivante est en préparation ou en cours de saisie (indice), null sinon. */
  revisionEnCours: string | null;
}

export const createPvRequestSchema = z.object({ affaireId: uuid, equipementId: uuid });
export type CreatePvRequest = z.infer<typeof createPvRequestSchema>;

export const updatePvPrepRequestSchema = z.object({ donnees: pvRelaisDataSchema });
export type UpdatePvPrepRequest = z.infer<typeof updatePvPrepRequestSchema>;

export const setPvAffectationsRequestSchema = z.object({ userIds: z.array(uuid).max(50) });
export type SetPvAffectationsRequest = z.infer<typeof setPvAffectationsRequestSchema>;

export const duplicatePvRequestSchema = z.object({ equipementIds: z.array(uuid).min(1).max(100) });
export type DuplicatePvRequest = z.infer<typeof duplicatePvRequestSchema>;

export const pvListQuerySchema = z.object({
  affaireId: uuid.optional(),
  equipementId: uuid.optional(),
  statut: z.enum(["prepare", "brouillon", "signe", "recu", "depose", "erreur"]).optional(),
  technicienId: uuid.optional(),
  modele: z.string().max(40).optional(),
});
export type PvListQuery = z.infer<typeof pvListQuerySchema>;

/** Détail d'une affaire pour la préparation : équipements, versions de la liste E/S, PV. */
export interface PrepAffaireDto {
  affaire: AffaireDto;
  equipements: EquipementDto[];
  listes: ListeEsDto[];
  pvs: PvResumeDto[];
  techniciens: TechnicienDto[];
}

// --- Synchronisation tablette (spec §3.1 étape 5, §6.5) ---------------------------------------------------------

export interface SyncAffaireDto {
  affaire: AffaireDto;
  equipements: EquipementDto[];
  /** Dernière version de la liste E/S, avec ses points (création d'un PV sur site, spec §3.2). */
  liste: (ListeEsDto & { feuilles: FeuilleEsDto[] }) | null;
}

export interface SyncPvDto {
  pvId: string;
  versionId: string;
  numero: string;
  indice: string;
  modele: string;
  modeleVersion: string;
  affaireId: string;
  equipementId: string | null;
  statut: StatutPv;
  donnees: PvRelaisData;
  /** Création du PV au bureau (date de numérotation). */
  creeLe: string;
  /** Dernière modification au bureau : la tablette remplace sa copie si la saisie n'a pas commencé. */
  misAJourLe: string;
  /**
   * Base de comparaison des valeurs pré-remplies quand elle diffère de `donnees` : pour une révision, la préparation
   * d'origine (null si le PV a été créé sur site). Absent : `donnees` est la préparation.
   */
  donneesPreparees?: PvRelaisData | null;
}

/**
 * PV déposé d'une affaire de l'utilisateur : permet de créer la révision suivante depuis la tablette même quand
 * la copie locale du PV n'y est plus (spec §3.4, §6.3).
 */
export interface SyncPvDeposeDto {
  pvId: string;
  versionId: string;
  numero: string;
  indice: string;
  affaireId: string;
  equipementId: string | null;
  deposeLe: string | null;
  reserves: RecapReserves;
}

export interface SyncReferenceDto {
  serverTime: string;
  utilisateur: { id: string; nom: string };
  affaires: SyncAffaireDto[];
  pvs: SyncPvDto[];
  /** PV dont la révision courante est déposée (révision suivante possible). */
  deposes: SyncPvDeposeDto[];
  modeles: { code: string; version: string }[];
}

/** La tablette signale les PV préparés dont la saisie a commencé (le préparateur en est averti, spec §6.5). */
export const syncStartedRequestSchema = z.object({ versionIds: z.array(uuid).max(1000) });
export type SyncStartedRequest = z.infer<typeof syncStartedRequestSchema>;

// --- Envoi d'un PV signé (spec §3.3, §6.3) ------------------------------------------------------------------------

export const modificationTraceeSchema = z.object({
  chemin: z.string().max(500),
  avant: z.unknown(),
  apres: z.unknown(),
  par: z.string().max(120),
  le: z.string().datetime({ offset: true }),
});

export const uploadPvVersionRequestSchema = z.object({
  pvId: uuid,
  affaireId: uuid,
  equipementId: uuid.nullable(),
  numero: z.string().min(1).max(80),
  indice: z.string().min(1).max(4),
  modele: z.literal("relais"),
  modeleVersion: z.string().max(20),
  donnees: pvRelaisDataSchema,
  donneesPreparees: pvRelaisDataSchema.nullable(),
  modifications: z.array(modificationTraceeSchema).max(5000),
  creeLe: z.string().datetime({ offset: true }),
  signeLe: z.string().datetime({ offset: true }),
  tabletteId: z.string().min(1).max(64),
  empreinte: z.string().regex(/^[0-9a-f]{64}$/, "Empreinte SHA-256 invalide."),
});
export type UploadPvVersionRequest = z.infer<typeof uploadPvVersionRequestSchema>;

export interface PvVersionStatusDto {
  versionId: string;
  pvId: string;
  numero: string;
  statut: StatutPv;
  /** Signature reçue par le serveur (null tant que la version n'est pas signée). */
  signeLe: string | null;
  /** Nom du signataire SPIE (compte qui a envoyé la version). */
  signePar: string | null;
  alerteDoublon: boolean;
  depots: DepotDto[];
}

// --- Administration des dépôts et paramétrage SharePoint (spec §4.6, §5.2) ----------------------------------------

export interface DepotSuiviDto extends DepotDto {
  versionId: string;
  pvId: string;
  numero: string;
  indice: string;
  affaireId: string;
  affaireNumero: string;
  equipementTag: string | null;
}

export interface FamilleSharePointDto {
  famille: string;
  libelle: string;
  /** Chemin relatif sous le dossier de l'affaire, ex. « 03 - Mise en service/PV ». */
  cheminRelatif: string;
}

export const cheminRelatifSchema = z
  .string()
  .trim()
  .max(400)
  .refine((v) => !v.split("/").some((s) => s.trim() === ".." || s.trim() === "."), "Chemin relatif invalide.")
  .refine((v) => !/["*:<>?\\|]/.test(v), 'Caractères interdits par SharePoint : " * : < > ? \\ |');

export const updateFamillesRequestSchema = z.object({
  familles: z.array(z.object({ famille: z.string().min(1).max(10), cheminRelatif: cheminRelatifSchema })).max(20),
});
export type UpdateFamillesRequest = z.infer<typeof updateFamillesRequestSchema>;

/** Découpe un chemin relatif « a/b/c » en segments non vides. */
export function segmentsChemin(chemin: string): string[] {
  return chemin
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
}

// --- Document complet (fichier .json déposé, entrée du rendu PDF, spec §5.1) -------------------------------------

export interface PvDocument {
  format: "spie-pv/1";
  pv: { id: string; numero: string; modele: string; modeleVersion: string; famille: string };
  version: {
    id: string;
    indice: string;
    statutDocument: StatutDocument | null;
    signeLe: string | null;
    empreinte: string | null;
  };
  affaire: { numero: string; client: string; projet: string; site: string };
  equipement: {
    tag: string;
    libelle: string;
    typeCellule: string;
    modele: string;
    local: string;
    tagArmoire: string;
  } | null;
  listeEs: { id: string; reference: string; revision: string; version: number } | null;
  meta: {
    creeLe: string;
    tabletteId: string | null;
    signePar: { id: string; nom: string } | null;
    recuLe: string | null;
    genereLe: string;
  };
  donnees: PvRelaisData;
  donneesPreparees: PvRelaisData | null;
  modifications: ModificationTracee[];
}
