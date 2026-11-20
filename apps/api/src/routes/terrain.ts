import { syncStartedRequestSchema, type PvVersionStatusDto, type SyncReferenceDto } from "@spie/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { currentUser } from "../context.js";
import { requireAuth } from "../plugins/auth.js";
import { recevoirVersion, statutVersionPourUtilisateur } from "../services/reception.js";
import { referenceSync, signalerSaisieCommencee } from "../services/sync.js";

/** Un PV signé avec deux signatures PNG et plusieurs centaines d'E/S tient largement dans 12 Mo. */
export const PV_BODY_LIMIT = 12 * 1024 * 1024;

const versionParams = z.object({ versionId: z.string().uuid() });

/** Synchronisation de la tablette (spec §6.5). Préfixe /api/sync. */
export async function syncRoutes(app: FastifyInstance): Promise<void> {
  const { ctx } = app;
  app.addHook("preHandler", requireAuth());

  app.get("/reference", async (req): Promise<SyncReferenceDto> => referenceSync(ctx.db, currentUser(req), ctx.now()));

  app.post("/started", async (req, reply) => {
    const { versionIds } = syncStartedRequestSchema.parse(req.body);
    await signalerSaisieCommencee(ctx.db, { user: currentUser(req), versionIds, now: ctx.now(), ip: req.ip });
    return reply.status(204).send();
  });
}

/** Envoi idempotent des PV signés et suivi de leur traitement (spec §6.3, §8.5). Préfixe /api/pv-versions. */
export async function pvVersionRoutes(app: FastifyInstance): Promise<void> {
  const { ctx } = app;
  app.addHook("preHandler", requireAuth());

  app.put("/:versionId", { bodyLimit: PV_BODY_LIMIT }, async (req, reply): Promise<PvVersionStatusDto> => {
    const { versionId } = versionParams.parse(req.params);
    const r = await recevoirVersion(ctx.db, {
      user: currentUser(req),
      versionId,
      body: req.body,
      now: ctx.now(),
      ip: req.ip,
    });
    if (r.cree) ctx.traitement.reveiller();
    reply.status(r.cree ? 201 : 200);
    return r.status;
  });

  app.get("/:versionId/status", async (req): Promise<PvVersionStatusDto> => {
    const { versionId } = versionParams.parse(req.params);
    return statutVersionPourUtilisateur(ctx.db, currentUser(req), versionId);
  });
}
