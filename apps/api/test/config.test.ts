import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.js";

describe("configuration", () => {
  it("valeurs de développement par défaut : PGlite, SharePoint simulé, cookie non Secure", () => {
    const c = loadConfig({});
    expect(c).toMatchObject({
      env: "development",
      databaseUrl: "pglite://.data/pglite",
      cookieSecure: false,
      sharepoint: { mode: "fake" },
      accessTokenTtlSeconds: 900,
      refreshTokenTtlDays: 30,
      loginMaxFailures: 5,
    });
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
    });
    expect(c.cookieSecure).toBe(true);
    expect(c.trustProxy).toBe(true);
    expect(c.sharepoint).toMatchObject({
      mode: "graph",
      siteId: "host,a,b",
      certificate: { pem: "-----BEGIN PRIVATE KEY-----" },
    });
  });

  it("refuse une clé de signature trop courte", () => {
    expect(() => loadConfig({ JWT_SECRET: "court" })).toThrow(/JWT_SECRET/);
  });
});
