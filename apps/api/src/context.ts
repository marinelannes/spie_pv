import type { AppConfig } from "./config.js";
import type { Db } from "./db/client.js";
import type { AccessTokens } from "./lib/tokens.js";
import type { UserRow } from "./services/users.js";
import type { SharePointClient } from "./sharepoint/types.js";

/** Dépendances partagées par toutes les routes (injectables pour les tests). */
export interface AppContext {
  config: AppConfig;
  db: Db;
  /** null si SHAREPOINT_MODE=disabled. */
  sharepoint: SharePointClient | null;
  tokens: AccessTokens;
  now: () => Date;
  version: string;
}

declare module "fastify" {
  interface FastifyInstance {
    ctx: AppContext;
  }
  interface FastifyRequest {
    /** Utilisateur authentifié (renseigné par requireAuth). */
    user: UserRow | null;
    /** Famille de session du jeton d'accès. */
    sessionFamilyId: string | null;
  }
}

export function currentUser(req: { user: UserRow | null }): UserRow {
  if (!req.user) throw new Error("requireAuth manquant sur cette route.");
  return req.user;
}
