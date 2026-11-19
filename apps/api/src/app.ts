import { existsSync } from "node:fs";
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
import { adminSharePointRoutes } from "./routes/admin-sharepoint.js";
import { adminUserRoutes } from "./routes/admin-users.js";
import { adminAffaireRoutes, affaireRoutes } from "./routes/affaires.js";
import { authRoutes } from "./routes/auth.js";
import type { SharePointClient } from "./sharepoint/types.js";

export interface BuildAppOptions {
  config: AppConfig;
  db: Db;
  sharepoint: SharePointClient | null;
  now?: () => Date;
  version?: string;
  logger?: FastifyServerOptions["logger"];
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const { config } = opts;
  const app = Fastify({
    logger: opts.logger ?? false,
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
  });

  const ctx: AppContext = {
    config,
    db: opts.db,
    sharepoint: opts.sharepoint,
    tokens: new AccessTokens(config.jwtSecret, config.accessTokenTtlSeconds),
    now: opts.now ?? (() => new Date()),
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
  await app.register(
    async (admin) => {
      admin.addHook("preHandler", requireAuth({ roles: ["admin"] }));
      await admin.register(adminUserRoutes, { prefix: "/users" });
      await admin.register(adminAffaireRoutes, { prefix: "/affaires" });
      await admin.register(adminSharePointRoutes, { prefix: "/sharepoint" });
      await admin.register(adminAuditRoutes, { prefix: "/audit" });
    },
    { prefix: "/api/admin" },
  );

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

  app.setNotFoundHandler((req, reply) => {
    if (webDir && req.method === "GET" && !req.url.startsWith("/api/")) {
      // Application monopage : toute route inconnue renvoie index.html.
      return reply.header("Cache-Control", "no-cache").sendFile("index.html");
    }
    const body: ApiErrorBody = { error: { code: "not_found", message: "Route introuvable." } };
    return reply.status(404).send(body);
  });

  return app;
}
