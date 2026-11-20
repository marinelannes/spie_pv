import { randomBytes } from "node:crypto";
import {
  DRIVE_ROOT_ITEM_ID,
  FAMILLE_RELAIS,
  parisDateTimeParts,
  sanitizeSharePointFileName,
  segmentsChemin,
  sharePointBrowseQuerySchema,
  testUploadRequestSchema,
  updateFamillesRequestSchema,
  type FamilleSharePointDto,
  type SharePointBrowseResponse,
  type SharePointStatusDto,
  type TestUploadResponse,
} from "@spie/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { currentUser } from "../context.js";
import type { Db } from "../db/client.js";
import { affaires, famillesSharePoint } from "../db/schema.js";

/** Familles de PV de la V1 (spec §4.5) : seule la mise en service / essais a un modèle. */
export const FAMILLES_PV: Record<string, string> = { [FAMILLE_RELAIS]: "Mise en service / essais (PV de test relais)" };

export async function famillesSharePointDto(db: Db): Promise<FamilleSharePointDto[]> {
  const rows = await db.select().from(famillesSharePoint);
  return Object.entries(FAMILLES_PV).map(([famille, libelle]) => ({
    famille,
    libelle,
    cheminRelatif: rows.find((r) => r.famille === famille)?.cheminRelatif ?? "",
  }));
}
import { audit } from "../lib/audit.js";
import { HttpError, badRequest, notFound } from "../lib/errors.js";
import type { SharePointClient } from "../sharepoint/types.js";

/** Paramétrage et contrôle de SharePoint (spec §4.6, §5). Préfixe /api/admin/sharepoint, administrateurs. */
export async function adminSharePointRoutes(app: FastifyInstance): Promise<void> {
  const { ctx } = app;
  const { db } = ctx;

  function client(): SharePointClient {
    if (!ctx.sharepoint) {
      throw new HttpError(503, "sharepoint_not_configured", "SharePoint n'est pas configuré sur ce serveur.");
    }
    return ctx.sharepoint;
  }

  app.get("/status", async (): Promise<SharePointStatusDto> => {
    const sp = ctx.sharepoint;
    if (!sp) return { mode: "disabled", configured: false, site: null, error: null };
    try {
      return { mode: sp.mode, configured: true, site: await sp.getSite(), error: null };
    } catch (err) {
      return { mode: sp.mode, configured: true, site: null, error: (err as Error).message };
    }
  });

  /** Chemin relatif de chaque famille de PV sous le dossier de l'affaire (spec §4.6, §5.2). */
  app.get("/familles", async (): Promise<FamilleSharePointDto[]> => famillesSharePointDto(db));

  app.put("/familles", async (req): Promise<FamilleSharePointDto[]> => {
    const { familles } = updateFamillesRequestSchema.parse(req.body);
    for (const f of familles) {
      if (!(f.famille in FAMILLES_PV)) throw badRequest(`Famille de PV inconnue : ${f.famille}.`);
      const cheminRelatif = segmentsChemin(f.cheminRelatif).join("/");
      await db
        .insert(famillesSharePoint)
        .values({ famille: f.famille, cheminRelatif, updatedAt: ctx.now() })
        .onConflictDoUpdate({ target: famillesSharePoint.famille, set: { cheminRelatif, updatedAt: ctx.now() } });
    }
    await audit(db, {
      action: "sharepoint.familles",
      actorId: currentUser(req).id,
      targetType: "sharepoint",
      details: {
        familles: familles.map((f) => ({
          famille: f.famille,
          cheminRelatif: segmentsChemin(f.cheminRelatif).join("/"),
        })),
      },
      ip: req.ip,
    });
    return famillesSharePointDto(db);
  });

  /** Navigation dans le site pour choisir le dossier d'une affaire : bibliothèques, puis dossiers. */
  app.get("/browse", async (req): Promise<SharePointBrowseResponse> => {
    const sp = client();
    const { driveId, itemId } = sharePointBrowseQuerySchema.parse(req.query);
    if (!driveId) return { current: null, parent: null, items: await sp.listDrives() };
    const folder = await sp.getFolder(driveId, itemId ?? DRIVE_ROOT_ITEM_ID);
    return {
      current: { driveId, itemId: folder.itemId, path: folder.path, webUrl: folder.webUrl },
      parent: folder.parentItemId === null ? null : { driveId, itemId: folder.parentItemId },
      items: await sp.listChildFolders(driveId, folder.itemId),
    };
  });

  /**
   * Dépôt d'un fichier texte de test (critère de fin du lot 0) dans le dossier d'une affaire
   * ou dans un dossier choisi. Le fichier n'écrase jamais un fichier existant.
   */
  app.post("/test-upload", async (req, reply): Promise<TestUploadResponse> => {
    const sp = client();
    const body = testUploadRequestSchema.parse(req.body);
    let target: { driveId: string; itemId: string; affaire?: string };
    if ("affaireId" in body) {
      const [a] = await db.select().from(affaires).where(eq(affaires.id, body.affaireId));
      if (!a) throw notFound("Affaire introuvable.");
      if (!a.sharepointDriveId || !a.sharepointItemId) {
        throw badRequest(`L'affaire ${a.numero} n'a pas de dossier SharePoint cible.`);
      }
      target = { driveId: a.sharepointDriveId, itemId: a.sharepointItemId, affaire: a.numero };
    } else {
      target = body;
    }

    const folder = await sp.getFolder(target.driveId, target.itemId);
    const now = ctx.now();
    const user = currentUser(req);
    const { date, time } = parisDateTimeParts(now);
    const fileName = sanitizeSharePointFileName(
      `TEST_DEPOT_spie-pv_${date}-${time}_${randomBytes(2).toString("hex")}.txt`,
    );
    const content = [
      "Dépôt de test — plateforme de saisie des PV SPIE",
      "",
      `Environnement : ${ctx.config.envLabel}`,
      `Version : ${ctx.version}`,
      `Date : ${now.toISOString()} (${date} ${time}, heure de Paris)`,
      `Demandé par : ${user.nom} <${user.email}>`,
      `Affaire : ${target.affaire ?? "—"}`,
      `Dossier : ${folder.path}`,
      "",
      "Ce fichier peut être supprimé.",
      "",
    ].join("\r\n");

    const uploaded = await sp.uploadFile({
      driveId: folder.driveId,
      parentItemId: folder.itemId,
      fileName,
      content: new TextEncoder().encode(content),
      contentType: "text/plain; charset=utf-8",
    });
    await audit(db, {
      action: "sharepoint.test_upload",
      actorId: user.id,
      targetType: "sharepoint",
      targetId: uploaded.id,
      details: { fichier: uploaded.name, dossier: folder.path, webUrl: uploaded.webUrl, mode: sp.mode },
      ip: req.ip,
    });
    reply.status(201);
    return { ...uploaded, folderPath: folder.path };
  });
}
