import { createUserRequestSchema, updateUserRequestSchema, type TemporaryPasswordResponse } from "@spie/shared";
import { asc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { currentUser } from "../context.js";
import { utilisateurs } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { createUser, findUserById, resetPassword, revokeUserSessions, toUserDto } from "../services/users.js";

const idParams = z.object({ id: z.string().uuid() });

/** Gestion des comptes (spec §4.6). Préfixe /api/admin/users, réservé aux administrateurs. */
export async function adminUserRoutes(app: FastifyInstance): Promise<void> {
  const { ctx } = app;
  const { db } = ctx;

  app.get("/", async () => {
    const rows = await db.select().from(utilisateurs).orderBy(asc(utilisateurs.nom));
    return rows.map(toUserDto);
  });

  app.post("/", async (req, reply): Promise<TemporaryPasswordResponse> => {
    const input = createUserRequestSchema.parse(req.body);
    const { user, temporaryPassword } = await createUser(db, input);
    await audit(db, {
      action: "user.created",
      actorId: currentUser(req).id,
      targetType: "utilisateur",
      targetId: user.id,
      details: { email: user.email, role: user.role },
      ip: req.ip,
    });
    reply.status(201);
    return { user: toUserDto(user), temporaryPassword };
  });

  app.patch("/:id", async (req) => {
    const { id } = idParams.parse(req.params);
    const changes = updateUserRequestSchema.parse(req.body);
    const me = currentUser(req);
    const target = await findUserById(db, id);
    if (!target) throw notFound("Compte introuvable.");
    if (id === me.id && changes.actif === false) throw badRequest("Vous ne pouvez pas désactiver votre propre compte.");
    if (id === me.id && changes.role !== undefined && changes.role !== me.role) {
      throw badRequest("Vous ne pouvez pas changer votre propre rôle.");
    }

    const now = ctx.now();
    const [updated] = await db
      .update(utilisateurs)
      .set({ ...changes, updatedAt: now })
      .where(eq(utilisateurs.id, id))
      .returning();
    // Désactiver un compte révoque ses sessions (spec §7.2).
    if (changes.actif === false) await revokeUserSessions(db, id, now);

    const diff = Object.fromEntries(
      Object.entries(changes).filter(([k, v]) => target[k as keyof typeof changes] !== v),
    );
    await audit(db, {
      action: "user.updated",
      actorId: me.id,
      targetType: "utilisateur",
      targetId: id,
      details: { email: target.email, ...diff },
      ip: req.ip,
    });
    return toUserDto(updated!);
  });

  app.post("/:id/reset-password", async (req): Promise<TemporaryPasswordResponse> => {
    const { id } = idParams.parse(req.params);
    const target = await findUserById(db, id);
    if (!target) throw notFound("Compte introuvable.");
    const { user, temporaryPassword } = await resetPassword(db, id, ctx.now());
    await audit(db, {
      action: "user.password_reset",
      actorId: currentUser(req).id,
      targetType: "utilisateur",
      targetId: id,
      details: { email: target.email },
      ip: req.ip,
    });
    return { user: toUserDto(user), temporaryPassword };
  });
}
