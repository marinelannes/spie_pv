import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import fastifyCookie from "@fastify/cookie";
import fastifyHelmet from "@fastify/helmet";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import type { ApiErrorBody } from "@spie/shared";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import type { AppConfig } from "./config.js";
import type { AppContext } from "./context.js";
import type { Db } from "./db/client.js";
import { AccessTokens } from "./lib/tokens.js";
import { requireAuth } from "./plugins/auth.js";
import { registerErrorHandling } from "./plugins/errors.js";
import { adminAuditRoutes } from "./routes/admin-audit.js";
import { adminDepotRoutes } from "./routes/admin-depots.js";
import { adminSharePointRoutes } from "./routes/admin-sharepoint.js";
import { adminUserRoutes } from "./routes/admin-users.js";
import { adminAffaireRoutes, affaireRoutes } from "./routes/affaires.js";
import { authRoutes } from "./routes/auth.js";
import { prepRoutes } from "./routes/prep.js";
import { pvRoutes } from "./routes/pv.js";
import { pvVersionRoutes, syncRoutes } from "./routes/terrain.js";
import type { GenerateurFichiers } from "./services/fichiers.js";
import { generateurParDefaut } from "./services/generateur-defaut.js";
import { TraitementDepots } from "./services/traitement.js";
import type { SharePointClient } from "./sharepoint/types.js";
import { createFileArchive, type FileArchive } from "./storage/archive.js";

export interface BuildAppOptions {
  config: AppConfig;
  db: Db;
  sharepoint: SharePointClient | null;
  now?: () => Date;
  version?: string;
  logger?: FastifyServerOptions["logger"];
  /** Archive des fichiers produits ; défaut : selon la configuration (Blob ou dossier local). */
  archive?: FileArchive;
  /** Production des fichiers ; défaut : PDF par Chromium, JSON, XLSX. */
  fichiers?: GenerateurFichiers;
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const { config } = opts;
  const app = Fastify({
    logger: opts.logger ?? false,
    // Proxys de confiance désignés par adresse, jamais `true` : seul l'ingress est cru sur X-Forwarded-For.
    trustProxy: config.trustProxy ?? undefined,
    bodyLimit: 1024 * 1024,
  });

  const now = opts.now ?? (() => new Date());
  const archive = opts.archive ?? createFileArchive(config.archive);
  const ctx: AppContext = {
    config,
    db: opts.db,
    sharepoint: opts.sharepoint,
    tokens: new AccessTokens(config.jwtSecret, config.accessTokenTtlSeconds),
    archive,
    traitement: new TraitementDepots({
      db: opts.db,
      sharepoint: opts.sharepoint,
      archive,
      fichiers: opts.fichiers ?? generateurParDefaut(config),
      now,
      createMissingFolders: config.sharepointCreateMissingFolders,
      log: app.log,
    }),
    now,
    version: opts.version ?? "dev",
  };
  app.decorate("ctx", ctx);
  app.decorateRequest("user", null);
  app.decorateRequest("sessionFamilyId", null);

  registerErrorHandling(app);

  await app.register(fastifyHelmet, {
    // HSTS (spec §7.4). La CSP autorise uniquement la même origine : la PWA et l'API partagent le domaine.
    hsts: { maxAge: 31_536_000, includeSubDomains: true },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "blob:"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  });
  await app.register(fastifyCookie);
  await app.register(fastifyRateLimit, { global: false });

  app.get("/api/health", async () => {
    await ctx.db.execute(sql`select 1`);
    return { status: "ok", version: ctx.version, env: config.envLabel };
  });

  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(affaireRoutes, { prefix: "/api/affaires" });
  await app.register(syncRoutes, { prefix: "/api/sync" });
  await app.register(pvVersionRoutes, { prefix: "/api/pv-versions" });
  await app.register(pvRoutes, { prefix: "/api/pv" });
  await app.register(prepRoutes, { prefix: "/api/prep" });
  await app.register(
    async (admin) => {
      admin.addHook("preHandler", requireAuth({ roles: ["admin"] }));
      await admin.register(adminUserRoutes, { prefix: "/users" });
      await admin.register(adminAffaireRoutes, { prefix: "/affaires" });
      await admin.register(adminSharePointRoutes, { prefix: "/sharepoint" });
      await admin.register(adminAuditRoutes, { prefix: "/audit" });
      await admin.register(adminDepotRoutes, { prefix: "/depots" });
    },
    { prefix: "/api/admin" },
  );

  // SharePoint simulé (hors production) : les fichiers déposés s'ouvrent depuis leur lien, comme dans SharePoint.
  const sp = config.sharepoint;
  if (sp.mode === "fake" && sp.urlPublique) {
    mkdirSync(sp.rootDir, { recursive: true });
    await app.register(fastifyStatic, {
      root: resolve(sp.rootDir),
      prefix: `${sp.urlPublique}/`,
      decorateReply: false,
      wildcard: true, // fichiers déposés après le démarrage
      index: false,
      list: false,
      setHeaders(res) {
        res.setHeader("Cache-Control", "no-store");
      },
    });
  }

  const webDir =
    config.webDistDir && existsSync(resolve(config.webDistDir, "index.html")) ? resolve(config.webDistDir) : null;
  if (webDir) {
    await app.register(fastifyStatic, {
      root: webDir,
      wildcard: false,
      setHeaders(res, path) {
        // Fichiers versionnés par Vite : cache long. Le reste (index.html, sw.js, manifeste) : toujours revalidé.
        if (/[\\/]assets[\\/]/.test(path)) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        else res.setHeader("Cache-Control", "no-cache");
      },
    });
  }

  // Arrêt propre : on attend la fin du dépôt en cours et on ferme Chromium.
  app.addHook("onClose", async () => {
    await ctx.traitement.arreter();
  });

  app.setNotFoundHandler((req, reply) => {
    const pathname = req.url.split("?")[0] ?? "";
    // Application monopage : une route de l'application (sans extension) renvoie index.html. Un fichier absent
    // (ex. /assets/index-ANCIEN.js demandé par une ancienne version en cache) reçoit un vrai 404, pas du HTML.
    const isAppRoute = !pathname.startsWith("/api/") && !/\.[^/]*$/.test(pathname);
    if (webDir && req.method === "GET" && isAppRoute) {
      return reply.header("Cache-Control", "no-cache").sendFile("index.html");
    }
    const body: ApiErrorBody = { error: { code: "not_found", message: "Route introuvable." } };
    return reply.status(404).send(body);
  });

  return app;
}
