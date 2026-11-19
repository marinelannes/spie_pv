import { z } from "zod";

/** Rôles applicatifs (spec §2). Le signataire client n'a pas de compte. */
export const ROLES = ["technicien", "preparateur", "admin"] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

export const ROLE_LABELS: Record<Role, string> = {
  technicien: "Technicien",
  preparateur: "Préparateur",
  admin: "Administrateur",
};

/** Accès au back-office (/admin) : préparateurs et administrateurs. */
export function canUseBackOffice(role: Role): boolean {
  return role === "admin" || role === "preparateur";
}
