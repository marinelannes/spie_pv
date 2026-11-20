import { mkdir } from "node:fs/promises";
import { join, posix, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import type { AffaireDetailDto, SharePointBrowseResponse, SharePointStatusDto, TestUploadResponse } from "@spie/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeSharePointClient, isPathInside } from "../src/sharepoint/fake.js";
import { SharePointConflictError, SharePointError } from "../src/sharepoint/types.js";
import { bearer, createTestApp, login, seedUser, type TestApp } from "./helpers.js";

let t: TestApp;
let admin: string;

beforeAll(async () => {
  t = await createTestApp();
  await seedUser(t.db, { email: "admin@spie.test", nom: "Alice Admin", role: "admin" });
  admin = (await login(t.app, "admin@spie.test")).accessToken;
});
afterAll(() => t.close());

const get = (url: string) => t.app.inject({ method: "GET", url, headers: bearer(admin) });
const post = (url: string, payload: object) => t.app.inject({ method: "POST", url, headers: bearer(admin), payload });

describe("SharePoint simulé", () => {
  it("indique le mode et le site", async () => {
    const s = (await get("/api/admin/sharepoint/status")).json<SharePointStatusDto>();
    expect(s).toMatchObject({ mode: "fake", configured: true, error: null });
    expect(s.site?.name).toContain("simulé");
  });

  it("parcourt bibliothèques puis dossiers pour choisir le dossier d'une affaire", async () => {
    const drives = (await get("/api/admin/sharepoint/browse")).json<SharePointBrowseResponse>();
    expect(drives.current).toBeNull();
    const driveId = drives.items[0]!.driveId;

    const root = (await get(`/api/admin/sharepoint/browse?driveId=${driveId}`)).json<SharePointBrowseResponse>();
    expect(root.current).toMatchObject({ itemId: "root", path: "Documents partagés" });
    expect(root.parent).toBeNull();
    expect(root.items.map((i) => i.name)).toEqual(["Affaires"]);

    const affaires = (
      await get(`/api/admin/sharepoint/browse?driveId=${driveId}&itemId=${root.items[0]!.id}`)
    ).json<SharePointBrowseResponse>();
    expect(affaires.current?.path).toBe("Documents partagés / Affaires");
    expect(affaires.parent).toEqual({ driveId, itemId: "root" });
    const dossier = affaires.items[0]!;
    expect(dossier.name).toBe("A00001 - Stockage batteries DEMO1");

    const created = await post("/api/admin/affaires", {
      numero: "A00001",
      client: "Client",
      projet: "Stockage batteries – DEMO1",
      dossierSharePoint: {
        driveId,
        itemId: dossier.id,
        path: `${affaires.current!.path} / ${dossier.name}`,
        webUrl: null,
      },
    });
    expect(created.statusCode).toBe(201);
  });

  it("dépose un fichier de test dans le dossier de l'affaire (critère de fin du lot 0)", async () => {
    const list = (await get("/api/admin/affaires")).json<AffaireDetailDto[]>();
    const affaire = list.find((a) => a.numero === "A00001")!;

    const res = await post("/api/admin/sharepoint/test-upload", { affaireId: affaire.id });
    expect(res.statusCode).toBe(201);
    const up = res.json<TestUploadResponse>();
    expect(up.name).toMatch(/^TEST_DEPOT_spie-pv_20261119-143205_[0-9a-f]{4}\.txt$/);
    expect(up.folderPath).toBe("Documents partagés / Affaires / A00001 - Stockage batteries DEMO1");

    // Hors production, le SharePoint simulé sert les fichiers déposés : le lien s'ouvre comme un webUrl SharePoint.
    expect(up.webUrl).toBe(
      `/sharepoint-simule/Documents%20partag%C3%A9s/Affaires/A00001%20-%20Stockage%20batteries%20DEMO1/${up.name}`,
    );
    const servi = await t.app.inject({ method: "GET", url: up.webUrl! });
    expect(servi.statusCode).toBe(200);
    const content = servi.body;
    expect(content).toContain("Demandé par : Alice Admin <admin@spie.test>");
    expect(content).toContain("Affaire : A00001");
    expect((await t.app.inject({ method: "GET", url: "/sharepoint-simule/../../package.json" })).statusCode).not.toBe(
      200,
    );

    // Un second dépôt crée un autre fichier, sans écraser le premier.
    const second = (
      await post("/api/admin/sharepoint/test-upload", { affaireId: affaire.id })
    ).json<TestUploadResponse>();
    expect(second.name).not.toBe(up.name);

    const audit = (await get("/api/admin/audit")).json<{ action: string }[]>();
    expect(audit.some((e) => e.action === "sharepoint.test_upload")).toBe(true);
  });

  it("dépose aussi dans un dossier choisi directement", async () => {
    const drives = (await get("/api/admin/sharepoint/browse")).json<SharePointBrowseResponse>();
    const res = await post("/api/admin/sharepoint/test-upload", { driveId: drives.items[0]!.driveId, itemId: "root" });
    expect(res.statusCode).toBe(201);
    expect(res.json<TestUploadResponse>().folderPath).toBe("Documents partagés");
  });

  it("refuse le dépôt pour une affaire sans dossier cible", async () => {
    const a = (
      await post("/api/admin/affaires", { numero: "SANSDOSSIER", client: "X", projet: "Y" })
    ).json<AffaireDetailDto>();
    const res = await post("/api/admin/sharepoint/test-upload", { affaireId: a.id });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain("pas de dossier SharePoint");
  });

  it("dossier introuvable : 502 avec un message explicite", async () => {
    const drives = (await get("/api/admin/sharepoint/browse")).json<SharePointBrowseResponse>();
    const res = await post("/api/admin/sharepoint/test-upload", {
      driveId: drives.items[0]!.driveId,
      itemId: Buffer.from("Nexiste/Pas").toString("base64url"),
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe("sharepoint_error");
  });
});

describe("FakeSharePointClient", () => {
  it("n'écrase jamais un fichier existant", async () => {
    const sp = new FakeSharePointClient(`${t.dir}/autre`);
    const [drive] = await sp.listDrives();
    const args = { driveId: drive!.driveId, parentItemId: "root", fileName: "a.txt", content: new Uint8Array([1]) };
    await sp.uploadFile(args);
    await expect(sp.uploadFile(args)).rejects.toBeInstanceOf(SharePointConflictError);
  });

  it("refuse de sortir de la bibliothèque", async () => {
    const sp = new FakeSharePointClient(`${t.dir}/autre`);
    const [drive] = await sp.listDrives();
    await expect(sp.getFolder(drive!.driveId, Buffer.from("../..").toString("base64url"))).rejects.toBeInstanceOf(
      SharePointError,
    );
  });

  it("accepte un dossier dont le nom commence par « .. »", async () => {
    const sp = new FakeSharePointClient(`${t.dir}/points`);
    const [drive] = await sp.listDrives();
    const site = await sp.getSite();
    await mkdir(join(fileURLToPath(site.webUrl!), drive!.name, "..notes"), { recursive: true });
    const child = (await sp.listChildFolders(drive!.driveId, "root")).find((f) => f.name === "..notes")!;
    await expect(sp.getFolder(drive!.driveId, child.id)).resolves.toMatchObject({
      path: "Documents partagés / ..notes",
    });
  });
});

describe("isPathInside", () => {
  it("Windows : refuse un autre lecteur et la remontée, accepte les descendants", () => {
    expect(isPathInside("C:\\data\\sp", "D:\\autre", win32)).toBe(false);
    expect(isPathInside("C:\\data\\sp", "C:\\data", win32)).toBe(false);
    expect(isPathInside("C:\\data\\sp", "C:\\data\\sp\\A00001", win32)).toBe(true);
    expect(isPathInside("C:\\data\\sp", "C:\\data\\sp\\..notes", win32)).toBe(true);
  });

  it("POSIX : refuse la remontée, accepte la racine et les descendants", () => {
    expect(isPathInside("/data/sp", "/etc", posix)).toBe(false);
    expect(isPathInside("/data/sp", "/data/sp", posix)).toBe(true);
    expect(isPathInside("/data/sp", "/data/sp/a/b", posix)).toBe(true);
  });
});

describe("SharePoint désactivé", () => {
  it("répond 503 sur la navigation et le dépôt", async () => {
    const off = await createTestApp({ SHAREPOINT_MODE: "disabled" });
    try {
      await seedUser(off.db, { email: "admin@spie.test", role: "admin" });
      const token = (await login(off.app, "admin@spie.test")).accessToken;
      const status = await off.app.inject({
        method: "GET",
        url: "/api/admin/sharepoint/status",
        headers: bearer(token),
      });
      expect(status.json()).toMatchObject({ mode: "disabled", configured: false });
      const browse = await off.app.inject({
        method: "GET",
        url: "/api/admin/sharepoint/browse",
        headers: bearer(token),
      });
      expect(browse.statusCode).toBe(503);
      expect(browse.json().error.code).toBe("sharepoint_not_configured");
    } finally {
      await off.close();
    }
  });
});
