import {
  createAffaireRequestSchema,
  setAffectationsRequestSchema,
  updateAffaireRequestSchema,
  type AffaireDetailDto,
  type AffaireDto,
  type AffaireListItemDto,
  type DossierSharePoint,
} from "@spie/shared";
import { and, asc, count, eq, inArray, ne } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { currentUser } from "../context.js";
import type { Db } from "../db/client.js";
import { affaires, affectations, utilisateurs } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { requireAuth } from "../plugins/auth.js";

type AffaireRow = typeof affaires.$inferSelect;

export function toAffaireDto(a: AffaireRow): AffaireDto {
  const dossierSharePoint: DossierSharePoint | null =
    a.sharepointDriveId && a.sharepointItemId
      ? {
          driveId: a.sharepointDriveId,
          itemId: a.sharepointItemId,
          path: a.sharepointPath ?? "",
          webUrl: a.sharepointWebUrl,
        }
      : null;
  return {
    id: a.id,
    numero: a.numero,
    client: a.client,
    projet: a.projet,
    site: a.site,
    valideParDefaut: a.valideParDefaut,
    approuveParDefaut: a.approuveParDefaut,
    dossierSharePoint,
    archivee: a.archivee,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

function dossierColumns(d: DossierSharePoint | null) {
  return {
    sharepointDriveId: d?.driveId ?? null,
    sharepointItemId: d?.itemId ?? null,
    sharepointPath: d?.path ?? null,
    sharepointWebUrl: d?.webUrl ?? null,
  };
}

async function assertNumeroLibre(db: Db, numero: string, exceptId?: string): Promise<void> {
  const where = exceptId ? and(eq(affaires.numero, numero), ne(affaires.id, exceptId)) : eq(affaires.numero, numero);
  const [existing] = await db.select({ id: affaires.id }).from(affaires).where(where);
  if (existing) throw conflict(`L'affaire ${numero} existe déjà.`);
}

async function loadDetail(db: Db, id: string): Promise<AffaireDetailDto> {
  const [a] = await db.select().from(affaires).where(eq(affaires.id, id));
  if (!a) throw notFound("Affaire introuvable.");
  const rows = await db
    .select({ userId: utilisateurs.id, nom: utilisateurs.nom, email: utilisateurs.email, role: utilisateurs.role })
    .from(affectations)
    .innerJoin(utilisateurs, eq(affectations.userId, utilisateurs.id))
    .where(eq(affectations.affaireId, id))
    .orderBy(asc(utilisateurs.nom));
  return { ...toAffaireDto(a), affectations: rows };
}

const idParams = z.object({ id: z.string().uuid() });
const listQuery = z.object({ archivees: z.enum(["non", "oui", "toutes"]).default("non") });

/** Gestion des affaires (spec §3.1, §4.6). Préfixe /api/admin/affaires, réservé aux administrateurs. */
export async function adminAffaireRoutes(app: FastifyInstance): Promise<void> {
  const { ctx } = app;
  const { db } = ctx;

  app.get("/", async (req): Promise<AffaireListItemDto[]> => {
    const { archivees } = listQuery.parse(req.query);
    const nb = db
      .select({ affaireId: affectations.affaireId, n: count().as("n") })
      .from(affectations)
      .groupBy(affectations.affaireId)
      .as("nb");
    const rows = await db
      .select({ affaire: affaires, n: nb.n })
      .from(affaires)
      .leftJoin(nb, eq(nb.affaireId, affaires.id))
      .where(archivees === "toutes" ? undefined : eq(affaires.archivee, archivees === "oui"))
      .orderBy(asc(affaires.numero));
    return rows.map((r) => ({ ...toAffaireDto(r.affaire), nbAffectes: Number(r.n ?? 0) }));
  });

  app.post("/", async (req, reply): Promise<AffaireDetailDto> => {
    const input = createAffaireRequestSchema.parse(req.body);
    await assertNumeroLibre(db, input.numero);
    const { dossierSharePoint, ...rest } = input;
    const [created] = await db
      .insert(affaires)
      .values({ ...rest, ...dossierColumns(dossierSharePoint) })
      .returning();
    await audit(db, {
      action: "affaire.created",
      actorId: currentUser(req).id,
      targetType: "affaire",
      targetId: created!.id,
      details: { numero: created!.numero },
      ip: req.ip,
    });
    reply.status(201);
    return loadDetail(db, created!.id);
  });

  app.get("/:id", async (req): Promise<AffaireDetailDto> => {
    const { id } = idParams.parse(req.params);
    return loadDetail(db, id);
  });

  app.patch("/:id", async (req): Promise<AffaireDetailDto> => {
    const { id } = idParams.parse(req.params);
    const changes = updateAffaireRequestSchema.parse(req.body);
    const [before] = await db.select().from(affaires).where(eq(affaires.id, id));
    if (!before) throw notFound("Affaire introuvable.");
    if (changes.numero !== undefined) await assertNumeroLibre(db, changes.numero, id);

    const { dossierSharePoint, ...rest } = changes;
    await db
      .update(affaires)
      .set({
        ...rest,
        ...(dossierSharePoint !== undefined ? dossierColumns(dossierSharePoint) : {}),
        updatedAt: ctx.now(),
      })
      .where(eq(affaires.id, id));
    await audit(db, {
      action: "affaire.updated",
      actorId: currentUser(req).id,
      targetType: "affaire",
      targetId: id,
      details: { numero: before.numero, champs: Object.keys(changes) },
      ip: req.ip,
    });
    return loadDetail(db, id);
  });

  app.put("/:id/affectations", async (req): Promise<AffaireDetailDto> => {
    const { id } = idParams.parse(req.params);
    const userIds = [...new Set(setAffectationsRequestSchema.parse(req.body).userIds)];
    const [affaire] = await db
      .select({ id: affaires.id, numero: affaires.numero })
      .from(affaires)
      .where(eq(affaires.id, id));
    if (!affaire) throw notFound("Affaire introuvable.");
    if (userIds.length > 0) {
      const found = await db
        .select({ id: utilisateurs.id })
        .from(utilisateurs)
        .where(inArray(utilisateurs.id, userIds));
      if (found.length !== userIds.length) throw badRequest("Un des comptes à affecter n'existe pas.");
    }

    const before = await db
      .select({ userId: affectations.userId })
      .from(affectations)
      .where(eq(affectations.affaireId, id));
    const beforeIds = new Set(before.map((r) => r.userId));
    const added = userIds.filter((u) => !beforeIds.has(u));
    const removed = [...beforeIds].filter((u) => !userIds.includes(u));

    await db.transaction(async (tx) => {
      if (removed.length > 0) {
        await tx.delete(affectations).where(and(eq(affectations.affaireId, id), inArray(affectations.userId, removed)));
      }
      if (added.length > 0) {
        await tx.insert(affectations).values(added.map((userId) => ({ affaireId: id, userId })));
      }
    });
    if (added.length > 0 || removed.length > 0) {
      // Le journal est lu par des humains : on y met les adresses plutôt que les identifiants.
      const people = await db
        .select({ id: utilisateurs.id, email: utilisateurs.email })
        .from(utilisateurs)
        .where(inArray(utilisateurs.id, [...added, ...removed]));
      const email = (uid: string) => people.find((p) => p.id === uid)?.email ?? uid;
      await audit(db, {
        action: "affaire.affectations",
        actorId: currentUser(req).id,
        targetType: "affaire",
        targetId: id,
        details: { numero: affaire.numero, ajoutes: added.map(email), retires: removed.map(email) },
        ip: req.ip,
      });
    }
    return loadDetail(db, id);
  });
}

/**
 * Affaires visibles par l'utilisateur connecté (spec §7.3) : toutes pour l'administrateur,
 * celles qui lui sont affectées pour les techniciens et préparateurs. Préfixe /api/affaires.
 */
export async function affaireRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.ctx;

  app.get("/", { preHandler: requireAuth() }, async (req): Promise<AffaireDto[]> => {
    const user = currentUser(req);
    const rows =
      user.role === "admin"
        ? await db.select().from(affaires).where(eq(affaires.archivee, false)).orderBy(asc(affaires.numero))
        : (
            await db
              .select({ affaire: affaires })
              .from(affaires)
              .innerJoin(affectations, eq(affectations.affaireId, affaires.id))
              .where(and(eq(affectations.userId, user.id), eq(affaires.archivee, false)))
              .orderBy(asc(affaires.numero))
          ).map((r) => r.affaire);
    return rows.map(toAffaireDto);
  });
}
