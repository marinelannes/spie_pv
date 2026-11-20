import { STATUTS_DEPOT, type DepotSuiviDto } from "@spie/shared";
import { desc, eq, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { currentUser } from "../context.js";
import type { Db } from "../db/client.js";
import { affaires, depots, equipements, pvs, versionsPv } from "../db/schema.js";

const query = z.object({ statut: z.enum(STATUTS_DEPOT).optional() });
const idParams = z.object({ id: z.string().uuid() });

async function depotsSuivis(db: Db, where: SQL | undefined): Promise<DepotSuiviDto[]> {
  const rows = await db
    .select({ d: depots, v: versionsPv, pv: pvs, affaireNumero: affaires.numero, tag: equipements.tag })
    .from(depots)
    .innerJoin(versionsPv, eq(depots.versionId, versionsPv.id))
    .innerJoin(pvs, eq(versionsPv.pvId, pvs.id))
    .innerJoin(affaires, eq(pvs.affaireId, affaires.id))
    .leftJoin(equipements, eq(pvs.equipementId, equipements.id))
    .where(where)
    .orderBy(desc(depots.updatedAt))
    .limit(500);
  return rows.map(({ d, v, pv, affaireNumero, tag }) => ({
    id: d.id,
    fichier: d.fichier,
    nom: d.nom,
    statut: d.statut,
    tentatives: d.tentatives,
    derniereErreur: d.derniereErreur,
    prochaineTentative: d.statut === "en_attente" ? (d.prochaineTentative?.toISOString() ?? null) : null,
    webUrl: d.webUrl,
    cheminSharePoint: d.cheminSharePoint,
    deposeLe: d.deposeLe?.toISOString() ?? null,
    versionId: v.id,
    pvId: pv.id,
    numero: pv.numero,
    indice: v.indice,
    affaireId: pv.affaireId,
    affaireNumero,
    equipementTag: tag,
  }));
}

/**
 * Suivi des dépôts SharePoint (spec §3.3 étape 4, §4.6) : alerte sur les dépôts en erreur et relance par
 * l'administrateur. Préfixe /api/admin/depots.
 */
export async function adminDepotRoutes(app: FastifyInstance): Promise<void> {
  const { ctx } = app;

  app.get("/", async (req): Promise<DepotSuiviDto[]> => {
    const { statut } = query.parse(req.query);
    return depotsSuivis(ctx.db, statut ? eq(depots.statut, statut) : undefined);
  });

  app.post("/:id/retry", async (req): Promise<DepotSuiviDto> => {
    const { id } = idParams.parse(req.params);
    await ctx.traitement.relancer(id, currentUser(req).id, req.ip);
    const [d] = await depotsSuivis(ctx.db, eq(depots.id, id));
    return d!;
  });
}
