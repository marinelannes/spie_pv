import {
  createPvRequestSchema,
  duplicatePvRequestSchema,
  pvListQuerySchema,
  setAssociationRequestSchema,
  setPvAffectationsRequestSchema,
  typeFichierSchema,
  updatePvPrepRequestSchema,
  type AffaireDto,
  type EquipementDto,
  type IoImportAnalyseDto,
  type IoImportResultDto,
  type ListeEsDetailDto,
  type PrepAffaireDto,
  type PvDetailDto,
  type PvResumeDto,
} from "@spie/shared";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { currentUser } from "../context.js";
import { depots, equipements, feuillesEs, listesEs, pvs, versionsPv } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { requireAuth } from "../plugins/auth.js";
import { affairesVisibles, assertAffairePrep } from "../services/acces.js";
import {
  analyserFichier,
  equipementsDeLAffaire,
  importerListe,
  listeDetail,
  listesDeLAffaire,
} from "../services/io-listes.js";
import {
  affecterPv,
  chargerEquipement,
  chargerPv,
  creerPvPrepare,
  detailPv,
  dupliquerPv,
  majPvPrepare,
  resumesPv,
  supprimerPvPrepare,
  techniciensDeLAffaire,
} from "../services/pv.js";
import { CONTENT_TYPES } from "../services/fichiers.js";
import { toAffaireDto } from "./affaires.js";

/** Un classeur de liste E/S de quelques Mo, encodé en base64. */
const IMPORT_BODY_LIMIT = 15 * 1024 * 1024;
const PREP_BODY_LIMIT = 12 * 1024 * 1024;

const idParams = z.object({ id: z.string().uuid() });
const pvParams = z.object({ pvId: z.string().uuid() });
const listeParams = z.object({ listeId: z.string().uuid() });
const fichierParams = z.object({ versionId: z.string().uuid(), type: typeFichierSchema });

/**
 * Back-office de préparation et de suivi (spec §3.1, §4.6) : préparateurs (sur leurs affaires) et administrateurs.
 * Préfixe /api/prep.
 */
export async function prepRoutes(app: FastifyInstance): Promise<void> {
  const { ctx } = app;
  const { db } = ctx;
  app.addHook("preHandler", requireAuth({ roles: ["preparateur", "admin"] }));

  app.get("/affaires", async (req): Promise<AffaireDto[]> =>
    (await affairesVisibles(db, currentUser(req))).map(toAffaireDto),
  );

  app.get("/affaires/:id", async (req): Promise<PrepAffaireDto> => {
    const { id } = idParams.parse(req.params);
    const affaire = await assertAffairePrep(db, currentUser(req), id);
    return {
      affaire: toAffaireDto(affaire),
      equipements: await equipementsDeLAffaire(db, id),
      listes: await listesDeLAffaire(db, id),
      pvs: await resumesPv(db, { affaireIds: [id] }),
      techniciens: await techniciensDeLAffaire(db, id),
    };
  });

  // --- Listes E/S (spec §4.4) -----------------------------------------------------------------------------------

  app.post(
    "/affaires/:id/io-lists/analyse",
    { bodyLimit: IMPORT_BODY_LIMIT },
    async (req): Promise<IoImportAnalyseDto> => {
      const { id } = idParams.parse(req.params);
      const affaire = await assertAffairePrep(db, currentUser(req), id);
      return analyserFichier(db, affaire, req.body);
    },
  );

  app.post(
    "/affaires/:id/io-lists",
    { bodyLimit: IMPORT_BODY_LIMIT },
    async (req, reply): Promise<IoImportResultDto> => {
      const { id } = idParams.parse(req.params);
      const user = currentUser(req);
      const affaire = await assertAffairePrep(db, user, id);
      const r = await importerListe(db, affaire, req.body, user.id);
      await audit(db, {
        action: "io_liste.importee",
        actorId: user.id,
        targetType: "affaire",
        targetId: id,
        details: {
          numero: affaire.numero,
          fichier: r.liste.fichierSource,
          reference: r.liste.referenceDocument,
          revision: r.liste.revision,
          version: r.liste.version,
          points: r.liste.nbPoints,
          equipementsCrees: r.equipementsCrees,
          equipementsMisAJour: r.equipementsMisAJour,
        },
        ip: req.ip,
      });
      reply.status(201);
      return r;
    },
  );

  app.get("/io-lists/:listeId", async (req): Promise<ListeEsDetailDto> => {
    const { listeId } = listeParams.parse(req.params);
    const liste = await listeDetail(db, listeId);
    await assertAffairePrep(db, currentUser(req), liste.affaireId);
    return liste;
  });

  app.put("/equipements/:id/association", async (req): Promise<EquipementDto> => {
    const { id } = idParams.parse(req.params);
    const body = setAssociationRequestSchema.parse(req.body);
    const user = currentUser(req);
    const [e] = await db.select().from(equipements).where(eq(equipements.id, id));
    if (!e) throw notFound("Équipement introuvable.");
    await assertAffairePrep(db, user, e.affaireId);
    let feuilleNom: string | null = null;
    if (body.feuilleEsId) {
      const [f] = await db
        .select({ nom: feuillesEs.nom, groupesTag: feuillesEs.groupesTag })
        .from(feuillesEs)
        .innerJoin(listesEs, eq(feuillesEs.listeId, listesEs.id))
        .where(and(eq(feuillesEs.id, body.feuilleEsId), eq(listesEs.affaireId, e.affaireId)));
      if (!f) throw badRequest("Feuille introuvable dans les listes E/S de cette affaire.");
      if (body.filtreTag && !f.groupesTag.includes(body.filtreTag)) {
        throw badRequest(`« ${body.filtreTag} » n'est pas une valeur de la colonne TAG de la feuille ${f.nom}.`);
      }
      feuilleNom = f.nom;
    }
    await db
      .update(equipements)
      .set({ feuilleEsId: body.feuilleEsId, filtreTag: body.feuilleEsId ? body.filtreTag : null, updatedAt: ctx.now() })
      .where(eq(equipements.id, id));
    await audit(db, {
      action: "equipement.association",
      actorId: user.id,
      targetType: "equipement",
      targetId: id,
      details: { tag: e.tag, feuille: feuilleNom, filtreTag: body.filtreTag },
      ip: req.ip,
    });
    return (await equipementsDeLAffaire(db, e.affaireId)).find((x) => x.id === id)!;
  });

  // --- PV (spec §3.1, §4.6) ---------------------------------------------------------------------------------------

  /** PV de l'utilisateur pour le back-office : l'affaire doit lui être accessible. */
  async function pvAccessible(req: Parameters<typeof currentUser>[0], pvId: string) {
    const loaded = await chargerPv(db, pvId);
    const affaire = await assertAffairePrep(db, currentUser(req), loaded.pv.affaireId);
    return { ...loaded, affaire };
  }

  app.get("/pv", async (req): Promise<PvResumeDto[]> => {
    const q = pvListQuerySchema.parse(req.query);
    const user = currentUser(req);
    let affaireIds: string[];
    if (q.affaireId) {
      await assertAffairePrep(db, user, q.affaireId);
      affaireIds = [q.affaireId];
    } else {
      affaireIds = (await affairesVisibles(db, user)).map((a) => a.id);
    }
    return resumesPv(db, {
      affaireIds,
      equipementId: q.equipementId,
      statut: q.statut,
      technicienId: q.technicienId,
      modele: q.modele,
    });
  });

  app.post("/pv", async (req, reply): Promise<PvDetailDto> => {
    const body = createPvRequestSchema.parse(req.body);
    const user = currentUser(req);
    const affaire = await assertAffairePrep(db, user, body.affaireId);
    const equipement = await chargerEquipement(db, affaire.id, body.equipementId);
    const pvId = await creerPvPrepare(db, { affaire, equipement, userId: user.id, now: ctx.now() });
    const detail = await detailPv(db, pvId);
    await audit(db, {
      action: "pv.prepare",
      actorId: user.id,
      targetType: "pv",
      targetId: pvId,
      details: { numero: detail.numero, affaire: affaire.numero, equipement: equipement.tag },
      ip: req.ip,
    });
    reply.status(201);
    return detail;
  });

  app.get("/pv/:pvId", async (req): Promise<PvDetailDto> => {
    const { pvId } = pvParams.parse(req.params);
    await pvAccessible(req, pvId);
    return detailPv(db, pvId);
  });

  app.put("/pv/:pvId", { bodyLimit: PREP_BODY_LIMIT }, async (req): Promise<PvDetailDto> => {
    const { pvId } = pvParams.parse(req.params);
    const { donnees } = updatePvPrepRequestSchema.parse(req.body);
    const { pv } = await pvAccessible(req, pvId);
    await majPvPrepare(db, pvId, donnees, ctx.now());
    await audit(db, {
      action: "pv.prepare_modifie",
      actorId: currentUser(req).id,
      targetType: "pv",
      targetId: pvId,
      details: { numero: pv.numero },
      ip: req.ip,
    });
    return detailPv(db, pvId);
  });

  app.delete("/pv/:pvId", async (req, reply) => {
    const { pvId } = pvParams.parse(req.params);
    await pvAccessible(req, pvId);
    const pv = await supprimerPvPrepare(db, pvId);
    await audit(db, {
      action: "pv.supprime",
      actorId: currentUser(req).id,
      targetType: "pv",
      targetId: pvId,
      details: { numero: pv.numero },
      ip: req.ip,
    });
    return reply.status(204).send();
  });

  app.put("/pv/:pvId/affectations", async (req): Promise<PvDetailDto> => {
    const { pvId } = pvParams.parse(req.params);
    const { userIds } = setPvAffectationsRequestSchema.parse(req.body);
    const { pv } = await pvAccessible(req, pvId);
    const { ajoutes, retires } = await affecterPv(db, pv, userIds);
    if (ajoutes.length > 0 || retires.length > 0) {
      await audit(db, {
        action: "pv.affectations",
        actorId: currentUser(req).id,
        targetType: "pv",
        targetId: pvId,
        details: { numero: pv.numero, ajoutes, retires },
        ip: req.ip,
      });
    }
    return detailPv(db, pvId);
  });

  app.post("/pv/:pvId/duplicate", async (req, reply): Promise<PvResumeDto[]> => {
    const { pvId } = pvParams.parse(req.params);
    const { equipementIds } = duplicatePvRequestSchema.parse(req.body);
    const source = await pvAccessible(req, pvId);
    const user = currentUser(req);
    const ids = await dupliquerPv(db, {
      source,
      affaire: source.affaire,
      equipementIds,
      userId: user.id,
      now: ctx.now(),
    });
    const crees = await resumesPv(db, { pvIds: ids });
    await audit(db, {
      action: "pv.duplique",
      actorId: user.id,
      targetType: "pv",
      targetId: pvId,
      details: {
        numero: source.pv.numero,
        vers: crees.map((c) => ({ numero: c.numero, equipement: c.equipementTag })),
      },
      ip: req.ip,
    });
    reply.status(201);
    return crees;
  });

  /** Consultation des fichiers produits (copie d'archive), spec §4.6 « consultation du PDF ». */
  app.get("/versions/:versionId/fichiers/:type", async (req, reply) => {
    const { versionId, type } = fichierParams.parse(req.params);
    const [row] = await db
      .select({ d: depots, affaireId: pvs.affaireId })
      .from(depots)
      .innerJoin(versionsPv, eq(depots.versionId, versionsPv.id))
      .innerJoin(pvs, eq(versionsPv.pvId, pvs.id))
      .where(and(eq(depots.versionId, versionId), eq(depots.fichier, type)));
    if (!row) throw notFound("Fichier introuvable pour cette version.");
    await assertAffairePrep(db, currentUser(req), row.affaireId);
    const contenu = row.d.archiveKey ? await ctx.archive.get(row.d.archiveKey) : null;
    if (!contenu) throw notFound("Le fichier n'a pas encore été produit.");
    return reply
      .header("Content-Type", CONTENT_TYPES[type])
      .header(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(row.d.nom)}"; filename*=UTF-8''${encodeURIComponent(row.d.nom)}`,
      )
      .header("Cache-Control", "no-store")
      .send(Buffer.from(contenu));
  });
}
