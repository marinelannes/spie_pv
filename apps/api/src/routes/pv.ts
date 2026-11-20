import { createRevisionRequestSchema, type SyncPvDto } from "@spie/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { currentUser } from "../context.js";
import { requireAuth } from "../plugins/auth.js";
import { creerRevision } from "../services/revisions.js";

const pvParams = z.object({ pvId: z.string().uuid() });

/**
 * Révisions d'un PV (spec §3.4, §8.5). Préfixe /api/pv. Ouvert aux techniciens, préparateurs et administrateurs
 * affectés à l'affaire : la réouverture se fait sur la tablette ou se prépare au bureau.
 */
export async function pvRoutes(app: FastifyInstance): Promise<void> {
  const { ctx } = app;
  app.addHook("preHandler", requireAuth());

  app.post("/:pvId/revisions", async (req, reply): Promise<SyncPvDto> => {
    const { pvId } = pvParams.parse(req.params);
    const { modifications, affecter } = createRevisionRequestSchema.parse(req.body);
    const revision = await creerRevision(ctx.db, {
      user: currentUser(req),
      pvId,
      modifications,
      affecter,
      now: ctx.now(),
      ip: req.ip,
    });
    reply.status(201);
    return revision;
  });
}
