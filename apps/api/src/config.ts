import { z } from "zod";

const bool = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  /** Derrière l'ingress Azure Container Apps : l'IP cliente est dans X-Forwarded-For. */
  TRUST_PROXY: bool.optional(),

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
});

export type SharePointConfig =
  | { mode: "disabled" }
  | { mode: "fake"; rootDir: string }
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
  trustProxy: boolean;
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
}

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
    sharepoint = { mode: "fake", rootDir: e.FAKE_SHAREPOINT_DIR };
  } else {
    sharepoint = { mode: "disabled" };
  }

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
    trustProxy: e.TRUST_PROXY ?? prod,
    databaseUrl: e.DATABASE_URL ?? "pglite://.data/pglite",
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
