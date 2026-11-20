import { z } from "zod";
import type { TypeEs } from "./io.js";

/**
 * Import des listes d'entrées/sorties (spec §4.4) : résultat de la lecture du fichier Excel, rapport d'anomalies,
 * association équipement ↔ feuille, et DTO des listes enregistrées.
 */

export type SeveriteAnomalie = "erreur" | "avertissement" | "info";

export type CodeAnomalie =
  | "affaire_differente"
  | "reference_introuvable"
  | "feuille_equipements_absente"
  | "aucune_feuille_es"
  | "en_tete_introuvable"
  /** Colonne des types mal intitulée (ex. « TAG RPN ») : déduite de son contenu. */
  | "type_deduit"
  | "colonne_sans_en_tete"
  | "adresse_en_double"
  | "libelle_equipement_en_double"
  | "tag_equipement_en_double"
  | "equipement_sans_feuille"
  /** Filtre TAG choisi absent de la colonne TAG de la feuille : aucune E/S retenue. */
  | "filtre_tag_inconnu"
  /** Feuille choisie à la main pour la version précédente, absente du nouveau fichier : association à refaire. */
  | "feuille_precedente_absente"
  | "feuille_inconnue"
  | "type_inconnu"
  | "ligne_incomplete"
  | "feuille_multi_equipements";

export interface AnomalieImport {
  code: CodeAnomalie;
  severite: SeveriteAnomalie;
  /** Feuille concernée (null : classeur entier). */
  feuille: string | null;
  /** Numéro de ligne Excel (1 = première ligne), null si sans objet. */
  ligne: number | null;
  message: string;
}

export interface EquipementLu {
  ligne: number;
  libelle: string;
  /** HTA / HTB (colonne TYPE). */
  niveauTension: string;
  typeCellule: string;
  tag: string;
  equipement: string;
  modele: string;
  local: string;
  tagArmoire: string;
  referenceConstructeur: string;
}

export interface PointEsLu {
  ligne: number;
  carte: string;
  /** Colonne TAG CELLULE / EQUIPEMENT (ou TAG RPN). */
  tag: string;
  typeBrut: string;
  /** null : type inconnu (signalé dans les anomalies, ligne non importée). */
  type: TypeEs | null;
  designation: string;
  adresse: string;
  reserve: boolean;
}

export interface FeuilleEsLue {
  nom: string;
  /** Titre en tête de feuille (cellule B1), ex. « LISTE DES ENTREES / SORTIES RELAIS PROTECTION NUMERIQUE … ». */
  titre: string;
  points: PointEsLu[];
  /** Valeurs distinctes de la colonne TAG (hors « - » et vide) : une feuille peut décrire plusieurs équipements. */
  groupesTag: string[];
}

export interface ListeEsLue {
  /** Référence du document (ex. GAU11_AUT_009). */
  reference: string;
  /** Révision du fichier (ex. B). */
  revision: string;
  /** N° d'affaire lu dans le fichier (feuille REV ou en-têtes), ex. A35173. */
  numeroAffaire: string;
  equipements: EquipementLu[];
  feuilles: FeuilleEsLue[];
  anomalies: AnomalieImport[];
}

/** Association d'un équipement à sa feuille d'E/S, avec un filtre facultatif sur la colonne TAG de la feuille. */
export const associationEquipementSchema = z.object({
  tag: z.string().trim().min(1).max(120),
  feuille: z.string().max(120).nullable(),
  filtreTag: z.string().max(200).nullable().default(null),
});
export type AssociationEquipementInput = z.input<typeof associationEquipementSchema>;

export interface AssociationEquipement {
  tag: string;
  feuille: string | null;
  filtreTag: string | null;
  /**
   * auto : via TYPE CELLULE ; manuel : choisi par le préparateur pour cet import ; reprise : choix manuel de la
   * version précédente de la liste, repris ; aucune : pas de feuille.
   */
  mode: "auto" | "manuel" | "reprise" | "aucune";
}

/** Fichier Excel envoyé en JSON (base64) : un classeur de liste E/S pèse quelques centaines de Ko. */
export const ioImportRequestSchema = z.object({
  fichier: z.string().trim().min(1).max(255),
  contenuBase64: z.string().min(1).max(14_000_000),
  /** Associations choisies par le préparateur ; absentes : proposition automatique. */
  associations: z.array(associationEquipementSchema).max(1000).optional(),
});
export type IoImportRequest = z.input<typeof ioImportRequestSchema>;

export interface FeuilleResumeDto {
  nom: string;
  titre: string;
  nbPoints: number;
  nbReserves: number;
  groupesTag: string[];
}

/** Réponse de l'analyse (sans enregistrement) et de l'import. */
export interface IoImportAnalyseDto {
  fichier: string;
  reference: string;
  revision: string;
  numeroAffaire: string;
  equipements: (EquipementLu & { association: AssociationEquipement })[];
  feuilles: FeuilleResumeDto[];
  anomalies: AnomalieImport[];
  /** Une anomalie de sévérité « erreur » empêche l'import. */
  bloquant: boolean;
}

export interface ListeEsDto {
  id: string;
  affaireId: string;
  referenceDocument: string;
  revision: string;
  /** Chaque import crée une nouvelle version de la liste (1, 2, 3…). */
  version: number;
  fichierSource: string;
  importeLe: string;
  importePar: string | null;
  nbFeuilles: number;
  nbPoints: number;
  anomalies: AnomalieImport[];
}

export interface PointEsDto {
  id: string;
  ordre: number;
  carte: string;
  tag: string;
  type: TypeEs;
  designation: string;
  adresse: string;
  reserve: boolean;
}

export interface FeuilleEsDto {
  id: string;
  nom: string;
  titre: string;
  groupesTag: string[];
  points: PointEsDto[];
}

export interface ListeEsDetailDto extends ListeEsDto {
  feuilles: FeuilleEsDto[];
}

export interface IoImportResultDto {
  liste: ListeEsDto;
  analyse: IoImportAnalyseDto;
  equipementsCrees: number;
  equipementsMisAJour: number;
}

/** Points d'une feuille retenus pour un équipement (filtre TAG facultatif). */
export function pointsPourEquipement<T extends { tag: string }>(points: readonly T[], filtreTag: string | null): T[] {
  if (!filtreTag) return [...points];
  return points.filter((p) => p.tag === filtreTag);
}
