import type {
  AffaireDetailDto,
  AffaireDto,
  AffaireListItemDto,
  AuditEntryDto,
  TemporaryPasswordResponse,
  UserDto,
} from "@spie/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REFRESH_COOKIE } from "../src/routes/auth.js";
import { PASSWORD, bearer, createTestApp, login, seedUser, type TestApp } from "./helpers.js";

let t: TestApp;
let admin: string;
let adminId: string;
let tech: string;
let techId: string;
let prepId: string;

beforeAll(async () => {
  t = await createTestApp();
  adminId = (await seedUser(t.db, { email: "admin@spie.test", nom: "Alice Admin", role: "admin" })).id;
  techId = (await seedUser(t.db, { email: "tech@spie.test", nom: "Théo Technicien", role: "technicien" })).id;
  prepId = (await seedUser(t.db, { email: "prep@spie.test", nom: "Paul Préparateur", role: "preparateur" })).id;
  admin = (await login(t.app, "admin@spie.test")).accessToken;
  tech = (await login(t.app, "tech@spie.test")).accessToken;
});
afterAll(() => t.close());

const as = (token: string) => ({
  get: (url: string) => t.app.inject({ method: "GET", url, headers: bearer(token) }),
  post: (url: string, payload?: object) => t.app.inject({ method: "POST", url, headers: bearer(token), payload }),
  patch: (url: string, payload: object) => t.app.inject({ method: "PATCH", url, headers: bearer(token), payload }),
  put: (url: string, payload: object) => t.app.inject({ method: "PUT", url, headers: bearer(token), payload }),
});

describe("autorisations", () => {
  it("le back-office d'administration est réservé aux administrateurs", async () => {
    for (const url of ["/api/admin/users", "/api/admin/affaires", "/api/admin/audit", "/api/admin/sharepoint/status"]) {
      expect((await as(tech).get(url)).statusCode).toBe(403);
      expect((await t.app.inject({ method: "GET", url })).statusCode).toBe(401);
    }
  });

  it("un jeton falsifié est refusé", async () => {
    const forged = admin.slice(0, -4) + "AAAA";
    expect((await as(forged).get("/api/admin/users")).statusCode).toBe(401);
  });
});

describe("comptes", () => {
  it("crée un compte avec un mot de passe provisoire à changer", async () => {
    const res = await as(admin).post("/api/admin/users", {
      email: "Nina.Nouvelle@SPIE.test",
      nom: "Nina",
      role: "technicien",
    });
    expect(res.statusCode).toBe(201);
    const { user, temporaryPassword } = res.json<TemporaryPasswordResponse>();
    expect(user).toMatchObject({ email: "nina.nouvelle@spie.test", mustChangePassword: true, actif: true });
    expect(temporaryPassword).toMatch(/^[A-Za-z0-9]{4}(-[A-Za-z0-9]{4}){3}$/);

    const session = await login(t.app, "nina.nouvelle@spie.test", temporaryPassword);
    expect(session.body.user.mustChangePassword).toBe(true);
  });

  it("refuse une adresse déjà utilisée", async () => {
    const res = await as(admin).post("/api/admin/users", {
      email: "tech@spie.test",
      nom: "Doublon",
      role: "technicien",
    });
    expect(res.statusCode).toBe(409);
  });

  it("valide les données", async () => {
    const res = await as(admin).post("/api/admin/users", { email: "pas-un-email", nom: "", role: "chef" });
    expect(res.statusCode).toBe(400);
    expect(Object.keys(res.json().error.fields).sort()).toEqual(["email", "nom", "role"]);
  });

  it("liste les comptes sans les empreintes de mots de passe", async () => {
    const res = await as(admin).get("/api/admin/users");
    const users = res.json<UserDto[]>();
    expect(users.map((u) => u.email)).toContain("tech@spie.test");
    expect(res.body).not.toContain("argon2");
  });

  it("un administrateur ne peut ni se désactiver ni changer son propre rôle", async () => {
    expect((await as(admin).patch(`/api/admin/users/${adminId}`, { actif: false })).statusCode).toBe(400);
    expect((await as(admin).patch(`/api/admin/users/${adminId}`, { role: "technicien" })).statusCode).toBe(400);
    expect((await as(admin).patch(`/api/admin/users/${adminId}`, { nom: "Alice A." })).statusCode).toBe(200);
  });

  it("désactiver un compte révoque ses sessions", async () => {
    const u = await seedUser(t.db, { email: "desactive@spie.test", role: "technicien" });
    const { refreshToken } = await login(t.app, "desactive@spie.test");
    const res = await as(admin).patch(`/api/admin/users/${u.id}`, { actif: false });
    expect(res.json<UserDto>().actif).toBe(false);
    const r = await t.app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { [REFRESH_COOKIE]: refreshToken },
    });
    expect(r.statusCode).toBe(401);
  });

  it("la réinitialisation donne un nouveau mot de passe provisoire et déverrouille", async () => {
    const u = await seedUser(t.db, { email: "oubli@spie.test", role: "technicien" });
    for (let i = 0; i < 5; i++) {
      await t.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: "oubli@spie.test", password: "x" },
      });
    }
    const res = await as(admin).post(`/api/admin/users/${u.id}/reset-password`);
    expect(res.statusCode).toBe(200);
    const { user, temporaryPassword } = res.json<TemporaryPasswordResponse>();
    expect(user).toMatchObject({ mustChangePassword: true, lockedUntil: null });

    const old = await t.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "oubli@spie.test", password: PASSWORD },
    });
    expect(old.statusCode).toBe(401);
    await login(t.app, "oubli@spie.test", temporaryPassword);
  });

  it("404 sur un compte inconnu, 400 sur un identifiant mal formé", async () => {
    expect(
      (await as(admin).patch("/api/admin/users/00000000-0000-4000-8000-000000000000", { nom: "X" })).statusCode,
    ).toBe(404);
    expect((await as(admin).patch("/api/admin/users/abc", { nom: "X" })).statusCode).toBe(400);
  });
});

describe("affaires", () => {
  let affaireId: string;

  it("crée une affaire (numéro normalisé, noms par défaut)", async () => {
    const res = await as(admin).post("/api/admin/affaires", {
      numero: "a35173",
      client: "Client GAU11",
      projet: "Stockage batteries – GAU11",
      site: "GAU11",
      valideParDefaut: "V. Validateur",
      approuveParDefaut: "A. Approbateur",
    });
    expect(res.statusCode).toBe(201);
    const a = res.json<AffaireDetailDto>();
    expect(a).toMatchObject({ numero: "A35173", archivee: false, dossierSharePoint: null, affectations: [] });
    affaireId = a.id;
  });

  it("refuse un numéro déjà utilisé", async () => {
    const res = await as(admin).post("/api/admin/affaires", { numero: "A35173", client: "X", projet: "Y" });
    expect(res.statusCode).toBe(409);
  });

  it("modifie l'affaire et son dossier SharePoint", async () => {
    const res = await as(admin).patch(`/api/admin/affaires/${affaireId}`, {
      approuveParDefaut: "B. Approbateur",
      dossierSharePoint: { driveId: "d1", itemId: "i1", path: "Documents / Affaires / A35173", webUrl: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<AffaireDetailDto>()).toMatchObject({
      approuveParDefaut: "B. Approbateur",
      dossierSharePoint: { driveId: "d1", itemId: "i1", path: "Documents / Affaires / A35173" },
    });
  });

  it("affecte et désaffecte des comptes", async () => {
    let res = await as(admin).put(`/api/admin/affaires/${affaireId}/affectations`, { userIds: [techId, prepId] });
    expect(
      res
        .json<AffaireDetailDto>()
        .affectations.map((a) => a.userId)
        .sort(),
    ).toEqual([techId, prepId].sort());

    res = await as(admin).put(`/api/admin/affaires/${affaireId}/affectations`, { userIds: [techId] });
    expect(res.json<AffaireDetailDto>().affectations).toEqual([
      { userId: techId, nom: "Théo Technicien", email: "tech@spie.test", role: "technicien" },
    ]);

    res = await as(admin).put(`/api/admin/affaires/${affaireId}/affectations`, {
      userIds: ["00000000-0000-4000-8000-000000000000"],
    });
    expect(res.statusCode).toBe(400);
  });

  it("un technicien ne voit que ses affaires non archivées", async () => {
    await as(admin).post("/api/admin/affaires", { numero: "B99999", client: "Autre", projet: "Autre projet" });

    let mine = (await as(tech).get("/api/affaires")).json<AffaireDto[]>();
    expect(mine.map((a) => a.numero)).toEqual(["A35173"]);
    const all = (await as(admin).get("/api/affaires")).json<AffaireDto[]>();
    expect(all.map((a) => a.numero)).toEqual(["A35173", "B99999"]);

    await as(admin).patch(`/api/admin/affaires/${affaireId}`, { archivee: true });
    mine = (await as(tech).get("/api/affaires")).json<AffaireDto[]>();
    expect(mine).toEqual([]);
  });

  it("filtre la liste d'administration par archivage et compte les affectés", async () => {
    const actives = (await as(admin).get("/api/admin/affaires")).json<AffaireListItemDto[]>();
    expect(actives.map((a) => a.numero)).toEqual(["B99999"]);
    const archivees = (await as(admin).get("/api/admin/affaires?archivees=oui")).json<AffaireListItemDto[]>();
    expect(archivees).toMatchObject([{ numero: "A35173", nbAffectes: 1 }]);
    const toutes = (await as(admin).get("/api/admin/affaires?archivees=toutes")).json<AffaireListItemDto[]>();
    expect(toutes).toHaveLength(2);
  });

  it("trace les actions d'administration dans le journal", async () => {
    const entries = (await as(admin).get("/api/admin/audit?limit=200")).json<AuditEntryDto[]>();
    const actions = entries.map((e) => e.action);
    for (const a of [
      "user.created",
      "user.updated",
      "user.password_reset",
      "affaire.created",
      "affaire.updated",
      "affaire.affectations",
    ]) {
      expect(actions).toContain(a);
    }
    const created = entries.filter((e) => e.action === "affaire.created");
    expect(created.map((e) => e.details?.numero)).toEqual(["B99999", "A35173"]); // plus récent d'abord
    expect(created[0]!.actor).toMatchObject({ email: "admin@spie.test" });

    const page2 = (await as(admin).get(`/api/admin/audit?limit=2&before=${entries[1]!.id}`)).json<AuditEntryDto[]>();
    expect(page2[0]!.id).toBe(entries[2]!.id);
  });
});
