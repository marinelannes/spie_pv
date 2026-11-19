import type { AuditAction, AuditEntryDto } from "@spie/shared";
import { desc, eq, lt } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { journalAudit, utilisateurs } from "../db/schema.js";

const query = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** Pagination : id de la dernière entrée de la page précédente. */
  before: z.coerce.number().int().positive().optional(),
});

/** Journal d'audit (spec §4.6). Préfixe /api/admin/audit, réservé aux administrateurs. */
export async function adminAuditRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.ctx;

  app.get("/", async (req): Promise<AuditEntryDto[]> => {
    const { limit, before } = query.parse(req.query);
    const rows = await db
      .select({ entry: journalAudit, actor: { id: utilisateurs.id, email: utilisateurs.email, nom: utilisateurs.nom } })
      .from(journalAudit)
      .leftJoin(utilisateurs, eq(journalAudit.actorId, utilisateurs.id))
      .where(before ? lt(journalAudit.id, before) : undefined)
      .orderBy(desc(journalAudit.id))
      .limit(limit);
    return rows.map(({ entry, actor }) => ({
      id: String(entry.id),
      at: entry.at.toISOString(),
      action: entry.action as AuditAction,
      actor: actor?.id ? { id: actor.id, email: actor.email, nom: actor.nom } : null,
      targetType: entry.targetType,
      targetId: entry.targetId,
      details: entry.details,
      ip: entry.ip,
    }));
  });
}
