import type { AuditEntryDto, SessionResponse } from "@spie/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { utilisateurs } from "../src/db/schema.js";
import { REFRESH_COOKIE } from "../src/routes/auth.js";
import { PASSWORD, bearer, createTestApp, login, refreshCookieOf, seedUser, type TestApp } from "./helpers.js";

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
  await seedUser(t.db, { email: "admin@spie.test", role: "admin" });
  await seedUser(t.db, { email: "tech@spie.test", role: "technicien" });
});
afterAll(() => t.close());

const refresh = (token: string) =>
  t.app.inject({ method: "POST", url: "/api/auth/refresh", cookies: { [REFRESH_COOKIE]: token } });

describe("santé", () => {
  it("GET /api/health interroge la base", async () => {
    const res = await t.app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok", version: "test" });
  });

  it("route API inconnue : 404 JSON", async () => {
    const res = await t.app.inject({ method: "GET", url: "/api/nexiste-pas" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("not_found");
  });
});

describe("connexion", () => {
  it("renvoie un jeton d'accès et pose le jeton de rafraîchissement en cookie HttpOnly SameSite=Strict", async () => {
    const { body, res } = await login(t.app, "ADMIN@spie.test");
    expect(body.user).toMatchObject({ email: "admin@spie.test", role: "admin", mustChangePassword: false });
    expect(body.expiresIn).toBe(900);
    const cookie = res.cookies.find((c) => c.name === REFRESH_COOKIE)!;
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Strict", path: "/api/auth", maxAge: 30 * 24 * 3600 });

    const me = await t.app.inject({ method: "GET", url: "/api/auth/me", headers: bearer(body.accessToken) });
    expect(me.json()).toMatchObject({ email: "admin@spie.test" });
  });

  it("stocke les mots de passe en argon2id", async () => {
    const [u] = await t.db.select().from(utilisateurs).where(eq(utilisateurs.email, "admin@spie.test"));
    expect(u!.passwordHash.startsWith("$argon2id$")).toBe(true);
  });

  it("même réponse pour un mauvais mot de passe et une adresse inconnue", async () => {
    const bad = await t.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "tech@spie.test", password: "mauvais" },
    });
    const unknown = await t.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "inconnu@spie.test", password: "mauvais" },
    });
    expect(bad.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(bad.json()).toEqual(unknown.json());
    await login(t.app, "tech@spie.test"); // remet le compteur d'échecs à zéro
  });

  it("verrouille temporairement le compte après 5 échecs", async () => {
    await seedUser(t.db, { email: "verrou@spie.test", role: "technicien" });
    const attempt = (password: string) =>
      t.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "verrou@spie.test", password } });

    for (let i = 1; i <= 4; i++) expect((await attempt("faux")).statusCode).toBe(401);
    const fifth = await attempt("faux");
    expect(fifth.statusCode).toBe(423);
    expect(fifth.json().error.code).toBe("account_locked");

    // Même le bon mot de passe est refusé pendant le verrouillage.
    expect((await attempt(PASSWORD)).statusCode).toBe(423);
    t.clock.advance(15 * 60_000 + 1000);
    expect((await attempt(PASSWORD)).statusCode).toBe(200);
  });

  it("refuse un compte désactivé, y compris avec un jeton d'accès encore valide", async () => {
    const u = await seedUser(t.db, { email: "parti@spie.test", role: "technicien" });
    const { accessToken } = await login(t.app, "parti@spie.test");
    await t.db.update(utilisateurs).set({ actif: false }).where(eq(utilisateurs.id, u.id));

    const res = await t.app.inject({ method: "GET", url: "/api/auth/me", headers: bearer(accessToken) });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("account_disabled");
    const again = await t.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "parti@spie.test", password: PASSWORD },
    });
    expect(again.statusCode).toBe(403);
  });
});

describe("mot de passe provisoire", () => {
  it("bloque l'application tant que le mot de passe n'est pas changé", async () => {
    await seedUser(t.db, { email: "nouveau@spie.test", role: "admin", mustChangePassword: true });
    const { accessToken, body } = await login(t.app, "nouveau@spie.test");
    expect(body.user.mustChangePassword).toBe(true);

    const blocked = await t.app.inject({ method: "GET", url: "/api/admin/users", headers: bearer(accessToken) });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe("password_change_required");

    const tooShort = await t.app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      headers: bearer(accessToken),
      payload: { currentPassword: PASSWORD, newPassword: "court" },
    });
    expect(tooShort.statusCode).toBe(400);
    expect(tooShort.json().error.fields.newPassword).toBeDefined();

    const wrongCurrent = await t.app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      headers: bearer(accessToken),
      payload: { currentPassword: "pas-le-bon-mot-de-passe", newPassword: "Nouveau-mot-de-passe-2026" },
    });
    expect(wrongCurrent.statusCode).toBe(400);

    const ok = await t.app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      headers: bearer(accessToken),
      payload: { currentPassword: PASSWORD, newPassword: "Nouveau-mot-de-passe-2026" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().mustChangePassword).toBe(false);

    const allowed = await t.app.inject({ method: "GET", url: "/api/admin/users", headers: bearer(accessToken) });
    expect(allowed.statusCode).toBe(200);
    await login(t.app, "nouveau@spie.test", "Nouveau-mot-de-passe-2026");
  });

  it("le changement de mot de passe déconnecte les autres appareils", async () => {
    await seedUser(t.db, { email: "deux@spie.test", role: "technicien" });
    const tablette = await login(t.app, "deux@spie.test");
    const pc = await login(t.app, "deux@spie.test");
    await t.app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      headers: bearer(pc.accessToken),
      payload: { currentPassword: PASSWORD, newPassword: "Autre-mot-de-passe-2026" },
    });
    expect((await refresh(tablette.refreshToken)).statusCode).toBe(401);
    expect((await refresh(pc.refreshToken)).statusCode).toBe(200);
  });
});

describe("rafraîchissement", () => {
  it("le jeton d'accès expire après 15 min ; le rafraîchissement en donne un nouveau", async () => {
    const { accessToken, refreshToken } = await login(t.app, "tech@spie.test");
    t.clock.advance(16 * 60_000);
    const expired = await t.app.inject({ method: "GET", url: "/api/auth/me", headers: bearer(accessToken) });
    expect(expired.statusCode).toBe(401);

    const res = await refresh(refreshToken);
    expect(res.statusCode).toBe(200);
    const next = res.json<SessionResponse>();
    const me = await t.app.inject({ method: "GET", url: "/api/auth/me", headers: bearer(next.accessToken) });
    expect(me.statusCode).toBe(200);
  });

  it("rotation : un ancien jeton réutilisé révoque toute la famille", async () => {
    const { refreshToken: first } = await login(t.app, "tech@spie.test");
    const r1 = await refresh(first);
    const second = refreshCookieOf(r1)!;
    expect(second).not.toBe(first);

    t.clock.advance(60_000); // au-delà du délai de grâce
    const reuse = await refresh(first);
    expect(reuse.statusCode).toBe(401);
    // Le jeton légitime de la même famille est révoqué aussi.
    expect((await refresh(second)).statusCode).toBe(401);
  });

  it("tolère deux rafraîchissements simultanés (délai de grâce)", async () => {
    const { refreshToken } = await login(t.app, "tech@spie.test");
    const [a, b] = await Promise.all([refresh(refreshToken), refresh(refreshToken)]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
  });

  it("le jeton de rafraîchissement expire après 30 jours d'inactivité", async () => {
    const { refreshToken } = await login(t.app, "tech@spie.test");
    t.clock.advance(31 * 24 * 3600 * 1000);
    expect((await refresh(refreshToken)).statusCode).toBe(401);
  });

  it("sans cookie : 401", async () => {
    const res = await t.app.inject({ method: "POST", url: "/api/auth/refresh" });
    expect(res.statusCode).toBe(401);
  });

  it("la déconnexion révoque la session", async () => {
    const { refreshToken } = await login(t.app, "tech@spie.test");
    const out = await t.app.inject({
      method: "POST",
      url: "/api/auth/logout",
      cookies: { [REFRESH_COOKIE]: refreshToken },
    });
    expect(out.statusCode).toBe(204);
    expect((await refresh(refreshToken)).statusCode).toBe(401);
  });
});

describe("journal d'audit", () => {
  it("trace connexions, échecs et verrouillages", async () => {
    const { accessToken } = await login(t.app, "admin@spie.test");
    const res = await t.app.inject({ method: "GET", url: "/api/admin/audit?limit=200", headers: bearer(accessToken) });
    const actions = new Set(res.json<AuditEntryDto[]>().map((e) => e.action));
    for (const a of [
      "auth.login",
      "auth.login_failed",
      "auth.locked",
      "auth.logout",
      "auth.password_changed",
      "auth.refresh_reuse",
    ]) {
      expect(actions).toContain(a);
    }
  });
});
