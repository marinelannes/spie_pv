import { z } from "zod";
import type { Role } from "./roles.js";

/**
 * Numéro d'affaire (ex. « A35173 »). Il entre dans le numéro des PV et dans les noms de fichiers
 * (spec §4.1, §5.3) : on n'accepte que lettres, chiffres, tiret et souligné, normalisés en majuscules.
 */
export const numeroAffaireSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^[A-Z0-9][A-Z0-9_-]{1,31}$/,
    "Numéro d'affaire invalide : lettres, chiffres, « - » ou « _ », 2 à 32 caractères.",
  );

const texte = (max = 200) => z.string().trim().max(max);

/** Dossier SharePoint cible de l'affaire, choisi en parcourant le site (spec §3.1, §4.6). */
export const dossierSharePointSchema = z.object({
  driveId: z.string().min(1),
  itemId: z.string().min(1),
  /** Chemin lisible (« Bibliothèque / Dossier / Sous-dossier »), pour l'affichage. */
  path: z.string().min(1).max(1000),
  webUrl: z.string().url().nullable(),
});
export type DossierSharePoint = z.infer<typeof dossierSharePointSchema>;

export const createAffaireRequestSchema = z.object({
  numero: numeroAffaireSchema,
  client: texte().min(1, "Client requis."),
  projet: texte().min(1, "Projet requis."),
  site: texte().default(""),
  valideParDefaut: texte(120).default(""),
  approuveParDefaut: texte(120).default(""),
  dossierSharePoint: dossierSharePointSchema.nullable().default(null),
});
export type CreateAffaireRequest = z.input<typeof createAffaireRequestSchema>;

export const updateAffaireRequestSchema = z
  .object({
    numero: numeroAffaireSchema,
    client: texte().min(1, "Client requis."),
    projet: texte().min(1, "Projet requis."),
    site: texte(),
    valideParDefaut: texte(120),
    approuveParDefaut: texte(120),
    dossierSharePoint: dossierSharePointSchema.nullable(),
    archivee: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Aucune modification.");
export type UpdateAffaireRequest = z.input<typeof updateAffaireRequestSchema>;

export const setAffectationsRequestSchema = z.object({
  userIds: z.array(z.string().uuid()).max(500),
});
export type SetAffectationsRequest = z.infer<typeof setAffectationsRequestSchema>;

export interface AffectationDto {
  userId: string;
  nom: string;
  email: string;
  role: Role;
}

export interface AffaireDto {
  id: string;
  numero: string;
  client: string;
  projet: string;
  site: string;
  valideParDefaut: string;
  approuveParDefaut: string;
  dossierSharePoint: DossierSharePoint | null;
  archivee: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AffaireDetailDto extends AffaireDto {
  affectations: AffectationDto[];
}

export interface AffaireListItemDto extends AffaireDto {
  nbAffectes: number;
}
