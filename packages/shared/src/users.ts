import { z } from "zod";
import { emailSchema } from "./auth.js";
import { roleSchema, type Role } from "./roles.js";

const nomSchema = z.string().trim().min(1, "Nom requis.").max(120);

export const createUserRequestSchema = z.object({
  email: emailSchema,
  nom: nomSchema,
  role: roleSchema,
});
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;

export const updateUserRequestSchema = z
  .object({
    nom: nomSchema,
    role: roleSchema,
    actif: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Aucune modification.");
export type UpdateUserRequest = z.infer<typeof updateUserRequestSchema>;

export interface UserDto {
  id: string;
  email: string;
  nom: string;
  role: Role;
  actif: boolean;
  mustChangePassword: boolean;
  /** Fin du verrouillage temporaire après échecs de connexion, ISO 8601. */
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

/** Réponse de création de compte et de réinitialisation : le mot de passe provisoire n'est montré qu'une fois. */
export interface TemporaryPasswordResponse {
  user: UserDto;
  temporaryPassword: string;
}
