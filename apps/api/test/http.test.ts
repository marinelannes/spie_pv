import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuditEntryDto } from "@spie/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, createTestApp, login, seedUser, type TestApp } from "./helpers.js";

/** IP enregistrée dans le journal pour un échec de connexion avec l'en-tête X-Forwarded-For donné. */
async function auditedIp(t: TestApp, xff: string, email: string): Promise<string | null> {
  await t.app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { "x-forwarded-for": xff },
    payload: { email, password: "x" },
  });
  const { accessToken } = await login(t.app, "admin@spie.test");
  const entries = (
    await t.app.inject({ method: "GET", url: "/api/admin/audit?limit=200", headers: bearer(accessToken) })
  ).json<AuditEntryDto[]>();
  return entries.find((e) => e.action === "auth.login_failed" && e.details?.email === email)?.ip ?? null;
}

// Avec inject(), la connexion vient de 127.0.0.1 : elle joue le rôle de l'ingress.
describe("derrière l'ingress (proxys de confiance par adresse, valeur de production)", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ TRUST_PROXY: "loopback, linklocal, uniquelocal, 100.64.0.0/10" });
    await seedUser(t.db, { email: "admin@spie.test", role: "admin" });
  });
  afterAll(() => t.close());

  it("prend l'adresse ajoutée par l'ingress, pas celle inventée par le client", async () => {
    expect(await auditedIp(t, "6.6.6.6, 203.0.113.7", "a@spie.test")).toBe("203.0.113.7");
  });

  it("ne remonte pas au-delà du client même s'il ajoute une adresse privée", async () => {
    expect(await auditedIp(t, "10.9.9.9, 203.0.113.8", "b@spie.test")).toBe("203.0.113.8");
  });
});

describe("sans proxy de confiance (développement)", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
    await seedUser(t.db, { email: "admin@spie.test", role: "admin" });
  });
  afterAll(() => t.close());

  it("ignore X-Forwarded-For", async () => {
    expect(await auditedIp(t, "6.6.6.6", "c@spie.test")).toBe("127.0.0.1");
  });
});

describe("service de la PWA", () => {
  let t: TestApp;
  let webDir: string;
  beforeAll(async () => {
    webDir = await mkdtemp(join(tmpdir(), "spie-pv-web-"));
    await writeFile(join(webDir, "index.html"), "<!doctype html><title>PV SPIE</title>");
    t = await createTestApp({ WEB_DIST_DIR: webDir });
  });
  afterAll(async () => {
    await t.close();
    await rm(webDir, { recursive: true, force: true });
  });

  it("renvoie index.html pour une route de l'application", async () => {
    const res = await t.app.inject({ method: "GET", url: "/admin/affaires/1234?x=1" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
  });

  it("renvoie un vrai 404 pour un fichier absent (ancienne version en cache)", async () => {
    const res = await t.app.inject({ method: "GET", url: "/assets/index-ANCIEN.js" });
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("application/json");
  });

  it("renvoie un 404 JSON pour une route d'API inconnue", async () => {
    const res = await t.app.inject({ method: "GET", url: "/api/nexiste-pas" });
    expect(res.statusCode).toBe(404);
  });
});
