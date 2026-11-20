import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { affaires, affectations } from "../db/schema.js";
import { forbidden, notFound } from "../lib/errors.js";
import type { UserRow } from "./users.js";

export type AffaireRow = typeof affaires.$inferSelect;

/** L'utilisateur est-il affecté à l'affaire ? (l'administrateur accède à tout, spec §7.3) */
export async function estAffecte(db: Db, user: UserRow, affaireId: string): Promise<boolean> {
  if (user.role === "admin") return true;
  const [row] = await db
    .select({ id: affectations.affaireId })
    .from(affectations)
    .where(and(eq(affectations.affaireId, affaireId), eq(affectations.userId, user.id)));
  return Boolean(row);
}

async function chargerAffaire(db: Db, affaireId: string): Promise<AffaireRow> {
  const [a] = await db.select().from(affaires).where(eq(affaires.id, affaireId));
  if (!a) throw notFound("Affaire introuvable.");
  return a;
}

/**
 * Préparation et suivi (spec §7.3) : l'administrateur accède à tout, le préparateur aux affaires qui lui sont
 * affectées, le technicien n'a pas accès au back-office.
 */
export async function assertAffairePrep(db: Db, user: UserRow, affaireId: string): Promise<AffaireRow> {
  if (user.role === "technicien") throw forbidden();
  const a = await chargerAffaire(db, affaireId);
  if (!(await estAffecte(db, user, affaireId))) throw forbidden("Cette affaire ne vous est pas affectée.");
  return a;
}

/** Saisie terrain : l'utilisateur doit être affecté à l'affaire (ou administrateur). */
export async function assertAffaireTerrain(db: Db, user: UserRow, affaireId: string): Promise<AffaireRow> {
  const a = await chargerAffaire(db, affaireId);
  if (!(await estAffecte(db, user, affaireId))) throw forbidden("Cette affaire ne vous est pas affectée.");
  return a;
}

/** Affaires visibles (non archivées) : toutes pour l'administrateur, celles affectées sinon. */
export async function affairesVisibles(db: Db, user: UserRow): Promise<AffaireRow[]> {
  if (user.role === "admin") {
    return db.select().from(affaires).where(eq(affaires.archivee, false)).orderBy(asc(affaires.numero));
  }
  const rows = await db
    .select({ affaire: affaires })
    .from(affaires)
    .innerJoin(affectations, eq(affectations.affaireId, affaires.id))
    .where(and(eq(affectations.userId, user.id), eq(affaires.archivee, false)))
    .orderBy(asc(affaires.numero));
  return rows.map((r) => r.affaire);
}
