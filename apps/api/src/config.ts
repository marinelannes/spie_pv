import { z } from "zod";

const bool = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  /**
   * Adresses des proxys de confiance (syntaxe proxy-addr : préréglages `loopback`, `linklocal`, `uniquelocal`
   * ou CIDR, séparés par des virgules ; vide = aucun). L'IP cliente est la première adresse non fiable en
   * remontant X-Forwarded-For depuis la connexion. Faire confiance à toute la chaîne (`true`) laisserait le client
   * choisir son IP : contournement de la limite de débit et IP fausses dans le journal d'audit.
   */
  TRUST_PROXY: z.string().optional(),

  DATABASE_URL: z.string().min(1).optional(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET doit contenir au moins 32 caractères.").optional(),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_SECURE: bool.optional(),
  LOGIN_MAX_FAILURES: z.coerce.number().int().positive().default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
  LOGIN_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(30),

  BOOTSTRAP_ADMIN_EMAIL: z.string().optional(),
  BOOTSTRAP_ADMIN_NAME: z.string().default("Administrateur"),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().optional(),

  /** Dossier du build de la PWA, servi par l'API (même origine que l'API, spec §7.2). */
  WEB_DIST_DIR: z.string().optional(),

  SHAREPOINT_MODE: z.enum(["graph", "fake", "disabled"]).optional(),
  GRAPH_TENANT_ID: z.string().optional(),
  GRAPH_CLIENT_ID: z.string().optional(),
  GRAPH_CERT_PEM: z.string().optional(),
  GRAPH_CERT_PATH: z.string().optional(),
  SHAREPOINT_SITE_ID: z.string().optional(),
  FAKE_SHAREPOINT_DIR: z.string().default(".data/sharepoint"),

  /** Libellé de l'environnement (recette, production…), repris dans le fichier de test SharePoint. */
  APP_ENV_LABEL: z.string().optional(),

  /**
   * Sous-dossier manquant sous le dossier de l'affaire (point ouvert n°13) : créé automatiquement (true, défaut) ou
   * dépôt en erreur (false).
   */
  SHAREPOINT_CREATE_MISSING_FOLDERS: bool.optional(),

  /** Copie des fichiers produits (spec §5.4) : Azure Blob Storage en production, dossier local sinon. */
  ARCHIVE_MODE: z.enum(["azure", "local"]).optional(),
  ARCHIVE_DIR: z.string().default(".data/archive"),
  AZURE_STORAGE_ACCOUNT_URL: z.string().url().optional(),
  AZURE_STORAGE_CONTAINER: z.string().default("pv-files"),
  /** Identité managée affectée par l'utilisateur (Container Apps). */
  AZURE_CLIENT_ID: z.string().optional(),

  /** Chromium pour le rendu PDF (Playwright). Défaut : détection des chemins usuels. */
  CHROMIUM_EXECUTABLE_PATH: z.string().optional(),
  /**
   * Traitement des dépôts dans le processus de l'API (développement, PGlite) plutôt que dans le worker.
   * Défaut : activé avec PGlite, désactivé avec PostgreSQL.
   */
  WORKER_INLINE: bool.optional(),
  /** Intervalle de scrutation de la file des dépôts, en secondes. */
  WORKER_POLL_SECONDS: z.coerce.number().int().positive().default(15),
  /** Exiger une observation sur chaque NC (point ouvert n°9). */
  NC_OBSERVATION_OBLIGATOIRE: bool.optional(),
});

export type SharePointConfig =
  | { mode: "disabled" }
  | {
      mode: "fake";
      rootDir: string;
      /** Hors production : préfixe sous lequel l'API sert le dossier simulé (liens « Ouvrir dans SharePoint »). */
      urlPublique?: string | null;
    }
  | {
      mode: "graph";
      tenantId: string;
      clientId: string;
      certificate: { pem: string } | { path: string };
      siteId: string;
    };

export interface AppConfig {
  env: "development" | "test" | "production";
  envLabel: string;
  host: string;
  port: number;
  logLevel: string;
  /** Proxys de confiance au format proxy-addr, ou null (connexion directe). */
  trustProxy: string | null;
  databaseUrl: string;
  jwtSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlDays: number;
  /** Délai pendant lequel un jeton de rafraîchissement tout juste remplacé reste accepté (onglets concurrents). */
  refreshReuseGraceSeconds: number;
  cookieSecure: boolean;
  loginMaxFailures: number;
  loginLockMinutes: number;
  loginRateLimitPerMinute: number;
  bootstrapAdmin: { email: string; nom: string; password: string } | null;
  webDistDir: string | null;
  sharepoint: SharePointConfig;
  sharepointCreateMissingFolders: boolean;
  archive: ArchiveConfig;
  chromiumExecutablePath: string | null;
  workerInline: boolean;
  workerPollMs: number;
  ncObservationObligatoire: boolean;
}

export type ArchiveConfig =
  | { mode: "local"; dir: string }
  | { mode: "azure"; accountUrl: string; container: string; managedIdentityClientId: string | null };

const PRODUCTION_TRUSTED_PROXIES = "loopback, linklocal, uniquelocal, 100.64.0.0/10";

/** Préfixe HTTP du SharePoint simulé (hors production), exclu du repli de navigation de la PWA. */
export const URL_SHAREPOINT_SIMULE = "/sharepoint-simule";

const DEV_JWT_SECRET = "dev-uniquement-ne-jamais-utiliser-en-production-0123456789";

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new ConfigError(`Configuration invalide : ${details}`);
  }
  const e = parsed.data;
  const prod = e.NODE_ENV === "production";

  if (prod && !e.DATABASE_URL) throw new ConfigError("DATABASE_URL est obligatoire en production.");
  if (prod && !e.JWT_SECRET) throw new ConfigError("JWT_SECRET est obligatoire en production.");

  const sharepointMode = e.SHAREPOINT_MODE ?? (prod ? "graph" : "fake");
  let sharepoint: SharePointConfig;
  if (sharepointMode === "graph") {
    const missing: string[] = (["GRAPH_TENANT_ID", "GRAPH_CLIENT_ID", "SHAREPOINT_SITE_ID"] as const).filter(
      (k) => !e[k],
    );
    if (!e.GRAPH_CERT_PEM && !e.GRAPH_CERT_PATH) missing.push("GRAPH_CERT_PEM ou GRAPH_CERT_PATH");
    if (missing.length > 0) {
      throw new ConfigError(`SHAREPOINT_MODE=graph : variables manquantes : ${missing.join(", ")}.`);
    }
    sharepoint = {
      mode: "graph",
      tenantId: e.GRAPH_TENANT_ID!,
      clientId: e.GRAPH_CLIENT_ID!,
      certificate: e.GRAPH_CERT_PEM ? { pem: e.GRAPH_CERT_PEM } : { path: e.GRAPH_CERT_PATH! },
      siteId: e.SHAREPOINT_SITE_ID!,
    };
  } else if (sharepointMode === "fake") {
    sharepoint = { mode: "fake", rootDir: e.FAKE_SHAREPOINT_DIR, urlPublique: prod ? null : URL_SHAREPOINT_SIMULE };
  } else {
    sharepoint = { mode: "disabled" };
  }

  const archiveMode = e.ARCHIVE_MODE ?? (prod ? "azure" : "local");
  let archive: ArchiveConfig;
  if (archiveMode === "azure") {
    if (!e.AZURE_STORAGE_ACCOUNT_URL) {
      throw new ConfigError("ARCHIVE_MODE=azure : AZURE_STORAGE_ACCOUNT_URL est obligatoire.");
    }
    archive = {
      mode: "azure",
      accountUrl: e.AZURE_STORAGE_ACCOUNT_URL,
      container: e.AZURE_STORAGE_CONTAINER,
      managedIdentityClientId: e.AZURE_CLIENT_ID ?? null,
    };
  } else {
    archive = { mode: "local", dir: e.ARCHIVE_DIR };
  }
  const databaseUrl = e.DATABASE_URL ?? "pglite://.data/pglite";

  const bootstrapAdmin =
    e.BOOTSTRAP_ADMIN_EMAIL && e.BOOTSTRAP_ADMIN_PASSWORD
      ? { email: e.BOOTSTRAP_ADMIN_EMAIL, nom: e.BOOTSTRAP_ADMIN_NAME, password: e.BOOTSTRAP_ADMIN_PASSWORD }
      : null;

  return {
    env: e.NODE_ENV,
    envLabel: e.APP_ENV_LABEL ?? e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    // En production, l'ingress Envoy d'Azure Container Apps se connecte depuis le réseau interne de
    // l'environnement (adresses privées ou CGNAT), d'où aucun client Internet ne peut joindre l'API directement.
    trustProxy: (e.TRUST_PROXY ?? (prod ? PRODUCTION_TRUSTED_PROXIES : "")).trim() || null,
    databaseUrl,
    jwtSecret: e.JWT_SECRET ?? DEV_JWT_SECRET,
    accessTokenTtlSeconds: e.ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTtlDays: e.REFRESH_TOKEN_TTL_DAYS,
    refreshReuseGraceSeconds: 10,
    cookieSecure: e.COOKIE_SECURE ?? prod,
    loginMaxFailures: e.LOGIN_MAX_FAILURES,
    loginLockMinutes: e.LOGIN_LOCK_MINUTES,
    loginRateLimitPerMinute: e.LOGIN_RATE_LIMIT_PER_MINUTE,
    bootstrapAdmin,
    webDistDir: e.WEB_DIST_DIR ?? null,
    sharepoint,
    sharepointCreateMissingFolders: e.SHAREPOINT_CREATE_MISSING_FOLDERS ?? true,
    archive,
    chromiumExecutablePath: e.CHROMIUM_EXECUTABLE_PATH ?? null,
    workerInline: e.WORKER_INLINE ?? databaseUrl.startsWith("pglite:"),
    workerPollMs: e.WORKER_POLL_SECONDS * 1000,
    ncObservationObligatoire: e.NC_OBSERVATION_OBLIGATOIRE ?? true,
  };
}

/** Charge apps/api/.env hors production (Node ≥ 20.12). */
export function loadDotEnvForDev(): void {
  if (process.env.NODE_ENV === "production") return;
  try {
    process.loadEnvFile(".env");
  } catch {
    // Pas de fichier .env : valeurs par défaut de développement.
  }
}
