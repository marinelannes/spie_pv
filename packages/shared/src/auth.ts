import { z } from "zod";
import { roleSchema } from "./roles.js";

/** Politique de mot de passe (spec §7.1) : 12 caractères minimum. */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.`)
  .max(PASSWORD_MAX_LENGTH, `Le mot de passe ne doit pas dépasser ${PASSWORD_MAX_LENGTH} caractères.`)
  .refine((v) => v.trim().length === v.length, "Le mot de passe ne doit pas commencer ni finir par un espace.");

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Adresse e-mail requise.")
  .email("Adresse e-mail invalide.")
  .max(254);

export const loginRequestSchema = z.object({
  email: emailSchema,
  // Pas de contrôle de longueur ici : un mauvais mot de passe doit être compté comme un échec.
  password: z.string().min(1, "Mot de passe requis.").max(PASSWORD_MAX_LENGTH),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const changePasswordRequestSchema = z
  .object({
    currentPassword: z.string().min(1, "Mot de passe actuel requis."),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: "Le nouveau mot de passe doit être différent de l'actuel.",
    path: ["newPassword"],
  });
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export const authUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  nom: z.string(),
  role: roleSchema,
  mustChangePassword: z.boolean(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

/** Réponse de /api/auth/login et /api/auth/refresh. Le jeton de rafraîchissement est dans un cookie HttpOnly. */
export interface SessionResponse {
  accessToken: string;
  /** Durée de validité du jeton d'accès, en secondes. */
  expiresIn: number;
  user: AuthUser;
}
