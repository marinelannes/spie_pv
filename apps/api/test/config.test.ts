import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.js";

describe("configuration", () => {
  it("valeurs de développement par défaut : PGlite, SharePoint simulé, cookie non Secure", () => {
    const c = loadConfig({});
    expect(c).toMatchObject({
      env: "development",
      databaseUrl: "pglite://.data/pglite",
      cookieSecure: false,
      sharepoint: { mode: "fake", urlPublique: "/sharepoint-simule" },
      accessTokenTtlSeconds: 900,
      refreshTokenTtlDays: 30,
      loginMaxFailures: 5,
    });
  });

  it("SharePoint simulé en production : jamais servi par HTTP", () => {
    const c = loadConfig({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://x",
      JWT_SECRET: "x".repeat(40),
      SHAREPOINT_MODE: "fake",
      ARCHIVE_MODE: "local",
    });
    expect(c.sharepoint).toMatchObject({ mode: "fake", urlPublique: null });
  });

  it("production : DATABASE_URL et JWT_SECRET obligatoires, cookie Secure, Graph par défaut", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(ConfigError);
    expect(() =>
      loadConfig({ NODE_ENV: "production", DATABASE_URL: "postgres://x", JWT_SECRET: "x".repeat(40) }),
    ).toThrow(/GRAPH_TENANT_ID/);

    const c = loadConfig({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://x",
      JWT_SECRET: "x".repeat(40),
      GRAPH_TENANT_ID: "t",
      GRAPH_CLIENT_ID: "c",
      GRAPH_CERT_PEM: "-----BEGIN PRIVATE KEY-----",
      SHAREPOINT_SITE_ID: "host,a,b",
      AZURE_STORAGE_ACCOUNT_URL: "https://compte.blob.core.windows.net/",
      AZURE_CLIENT_ID: "id-managee",
    });
    expect(c.cookieSecure).toBe(true);
    expect(c.archive).toEqual({
      mode: "azure",
      accountUrl: "https://compte.blob.core.windows.net/",
      container: "pv-files",
      managedIdentityClientId: "id-managee",
    });
    expect(c.workerInline).toBe(false);
    expect(c.trustProxy).toBe("loopback, linklocal, uniquelocal, 100.64.0.0/10");
    expect(c.sharepoint).toMatchObject({
      mode: "graph",
      siteId: "host,a,b",
      certificate: { pem: "-----BEGIN PRIVATE KEY-----" },
    });
  });

  it("lot 1 : archivage local, traitement des dépôts dans l'API et création des dossiers par défaut hors production", () => {
    const c = loadConfig({});
    expect(c).toMatchObject({
      archive: { mode: "local", dir: ".data/archive" },
      workerInline: true,
      workerPollMs: 15_000,
      sharepointCreateMissingFolders: true,
      ncObservationObligatoire: true,
      chromiumExecutablePath: null,
    });
    const pg = loadConfig({
      DATABASE_URL: "postgres://x",
      WORKER_POLL_SECONDS: "5",
      SHAREPOINT_CREATE_MISSING_FOLDERS: "false",
      NC_OBSERVATION_OBLIGATOIRE: "0",
      CHROMIUM_EXECUTABLE_PATH: "/usr/bin/chromium",
    });
    expect(pg).toMatchObject({
      workerInline: false,
      workerPollMs: 5000,
      sharepointCreateMissingFolders: false,
      ncObservationObligatoire: false,
      chromiumExecutablePath: "/usr/bin/chromium",
    });
    expect(loadConfig({ DATABASE_URL: "postgres://x", WORKER_INLINE: "true" }).workerInline).toBe(true);
  });

  it("production : l'archivage Azure exige l'URL du compte de stockage", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://x",
        JWT_SECRET: "x".repeat(40),
        SHAREPOINT_MODE: "disabled",
      }),
    ).toThrow(/AZURE_STORAGE_ACCOUNT_URL/);
  });

  it("refuse une clé de signature trop courte", () => {
    expect(() => loadConfig({ JWT_SECRET: "court" })).toThrow(/JWT_SECRET/);
  });
});
