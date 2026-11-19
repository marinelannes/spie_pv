import type { Role, UserDto } from "@spie/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { sessions, utilisateurs } from "../db/schema.js";
import { conflict } from "../lib/errors.js";
import { generateTemporaryPassword, hashPassword } from "../lib/passwords.js";

export type UserRow = typeof utilisateurs.$inferSelect;

export function toUserDto(u: UserRow): UserDto {
  return {
    id: u.id,
    email: u.email,
    nom: u.nom,
    role: u.role,
    actif: u.actif,
    mustChangePassword: u.mustChangePassword,
    lockedUntil: u.lockedUntil?.toISOString() ?? null,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}

export async function findUserByEmail(db: Db, email: string): Promise<UserRow | undefined> {
  const [u] = await db.select().from(utilisateurs).where(eq(utilisateurs.email, email.trim().toLowerCase()));
  return u;
}

export async function findUserById(db: Db, id: string): Promise<UserRow | undefined> {
  const [u] = await db.select().from(utilisateurs).where(eq(utilisateurs.id, id));
  return u;
}

/**
 * Crée un compte. Sans mot de passe fourni, un mot de passe provisoire est généré.
 * Dans tous les cas, il devra être changé à la première connexion (spec §7.1).
 */
export async function createUser(
  db: Db,
  input: { email: string; nom: string; role: Role; password?: string },
): Promise<{ user: UserRow; temporaryPassword: string }> {
  const email = input.email.trim().toLowerCase();
  if (await findUserByEmail(db, email)) throw conflict(`Un compte existe déjà pour ${email}.`);
  const temporaryPassword = input.password ?? generateTemporaryPassword();
  const [user] = await db
    .insert(utilisateurs)
    .values({
      email,
      nom: input.nom.trim(),
      role: input.role,
      passwordHash: await hashPassword(temporaryPassword),
      mustChangePassword: true,
    })
    .returning();
  return { user: user!, temporaryPassword };
}

/** Nouveau mot de passe provisoire : déverrouille le compte et révoque ses sessions. */
export async function resetPassword(
  db: Db,
  userId: string,
  now: Date,
): Promise<{ user: UserRow; temporaryPassword: string }> {
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  const [user] = await db
    .update(utilisateurs)
    .set({ passwordHash, mustChangePassword: true, failedLoginCount: 0, lockedUntil: null, updatedAt: now })
    .where(eq(utilisateurs.id, userId))
    .returning();
  if (!user) throw new Error(`Utilisateur ${userId} introuvable.`);
  await revokeUserSessions(db, userId, now);
  return { user, temporaryPassword };
}

export async function revokeUserSessions(db: Db, userId: string, now: Date): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}
