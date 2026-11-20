import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeSharePointClient } from "../src/sharepoint/fake.js";
import { GraphSharePointClient } from "../src/sharepoint/graph.js";
import {
  SharePointConflictError,
  SharePointError,
  ensureFolderPath,
  type ChildItem,
  type FolderInfo,
  type SharePointClient,
} from "../src/sharepoint/types.js";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function graph(route: (url: string, method: string, body: unknown) => Response) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const client = new GraphSharePointClient({
    siteId: "site",
    getToken: async () => "jeton",
    fetch: (async (input: string | URL, init?: RequestInit) => {
      const c = { url: String(input), method: init?.method ?? "GET", body: init?.body };
      calls.push(c);
      return route(c.url, c.method, c.body);
    }) as typeof fetch,
  });
  return { client, calls };
}

describe("GraphSharePointClient : sous-dossiers et recherche", () => {
  it("getChild adresse l'élément par chemin sous le parent et renvoie null sur 404", async () => {
    const { client, calls } = graph((url) =>
      url.includes("Mise%20en%20service")
        ? json(200, { id: "d1", name: "03 - Mise en service", folder: { childCount: 0 }, webUrl: "https://x/d1" })
        : json(404, { error: { code: "itemNotFound", message: "absent" } }),
    );
    const found = await client.getChild("b!drive", "racine", "03 - Mise en service");
    expect(found).toEqual({
      id: "d1",
      name: "03 - Mise en service",
      isFolder: true,
      size: null,
      webUrl: "https://x/d1",
    });
    expect(calls[0]!.url).toBe(
      "https://graph.microsoft.com/v1.0/drives/b!drive/items/racine:/03%20-%20Mise%20en%20service?$select=id,name,size,webUrl,folder,file",
    );
    expect(await client.getChild("b!drive", "racine", "PV")).toBeNull();
  });

  it("getChild remonte les autres erreurs", async () => {
    const { client } = graph(() => json(403, { error: { code: "accessDenied", message: "non" } }));
    await expect(client.getChild("d", "p", "x")).rejects.toThrow(/Sites.Selected/);
  });

  it("createFolder : POST children avec conflictBehavior=fail, puis relecture du dossier", async () => {
    const { client, calls } = graph((url, method) => {
      if (method === "POST") return json(201, { id: "nouveau", name: "PV", folder: {} });
      if (url.includes("/drives/b!drive?")) return json(200, { id: "b!drive", name: "Documents" });
      return json(200, {
        id: "nouveau",
        name: "PV",
        folder: {},
        webUrl: "https://x/PV",
        parentReference: { id: "parent", path: "/drives/b!drive/root:/Affaires" },
      });
    });
    const f = await client.createFolder("b!drive", "parent", "PV");
    expect(f).toMatchObject({ itemId: "nouveau", path: "Documents / Affaires / PV", parentItemId: "parent" });
    expect(calls[0]!.url).toBe("https://graph.microsoft.com/v1.0/drives/b!drive/items/parent/children");
    expect(JSON.parse(String(calls[0]!.body))).toEqual({
      name: "PV",
      folder: {},
      "@microsoft.graph.conflictBehavior": "fail",
    });
  });

  it("createFolder : 409 → SharePointConflictError", async () => {
    const { client } = graph(() => json(409, { error: { code: "nameAlreadyExists" } }));
    await expect(client.createFolder("d", "p", "PV")).rejects.toBeInstanceOf(SharePointConflictError);
  });
});

describe("FakeSharePointClient : sous-dossiers et recherche", () => {
  let dir: string;
  let sp: FakeSharePointClient;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "spie-sp-"));
    sp = new FakeSharePointClient(dir);
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("crée un sous-dossier, refuse de le recréer, et le retrouve", async () => {
    const [drive] = await sp.listDrives();
    const created = await sp.createFolder(drive!.driveId, "root", "Essais");
    expect(created.path).toBe("Documents partagés / Essais");
    await expect(sp.createFolder(drive!.driveId, "root", "Essais")).rejects.toBeInstanceOf(SharePointConflictError);
    expect(await sp.getChild(drive!.driveId, "root", "Essais")).toMatchObject({ isFolder: true, name: "Essais" });
    expect(await sp.getChild(drive!.driveId, "root", "Absent")).toBeNull();
  });

  it("getChild décrit un fichier ; les noms à plusieurs segments sont refusés", async () => {
    const [drive] = await sp.listDrives();
    await writeFile(join(dir, "Documents partagés", "note.txt"), "abc");
    expect(await sp.getChild(drive!.driveId, "root", "note.txt")).toMatchObject({ isFolder: false, size: 3 });
    await expect(sp.getChild(drive!.driveId, "root", "../x")).rejects.toBeInstanceOf(SharePointError);
    await expect(sp.createFolder(drive!.driveId, "root", "a/b")).rejects.toBeInstanceOf(SharePointError);
    await expect(
      sp.uploadFile({ driveId: drive!.driveId, parentItemId: "root", fileName: "..", content: new Uint8Array() }),
    ).rejects.toBeInstanceOf(SharePointError);
  });
});

describe("ensureFolderPath", () => {
  let dir: string;
  let sp: FakeSharePointClient;
  let driveId: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "spie-sp-"));
    sp = new FakeSharePointClient(dir);
    driveId = (await sp.listDrives())[0]!.driveId;
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("descend dans les dossiers existants", async () => {
    const f = await ensureFolderPath(sp, driveId, "root", ["Affaires", "A00001 - Stockage batteries DEMO1"], false);
    expect(f.path).toBe("Documents partagés / Affaires / A00001 - Stockage batteries DEMO1");
  });

  it("sans chemin relatif, renvoie le dossier racine de l'affaire", async () => {
    expect((await ensureFolderPath(sp, driveId, "root", [], false)).path).toBe("Documents partagés");
  });

  it("crée les sous-dossiers manquants si c'est autorisé", async () => {
    const f = await ensureFolderPath(sp, driveId, "root", ["Nouvelle affaire", "03 - Mise en service", "PV"], true);
    expect(f.path).toBe("Documents partagés / Nouvelle affaire / 03 - Mise en service / PV");
  });

  it("sinon, un sous-dossier manquant est une erreur explicite (point ouvert n°13)", async () => {
    await expect(ensureFolderPath(sp, driveId, "root", ["Inexistant"], false)).rejects.toThrow(
      /sous-dossier « Inexistant » introuvable/,
    );
  });

  it("refuse un fichier à la place d'un dossier", async () => {
    await writeFile(join(dir, "Documents partagés", "Affaires", "fichier.txt"), "x");
    await expect(ensureFolderPath(sp, driveId, "root", ["Affaires", "fichier.txt"], true)).rejects.toThrow(
      /n'est pas un dossier/,
    );
  });

  it("dossier créé entre-temps par un autre traitement : relu au lieu d'échouer", async () => {
    // Client dont createFolder signale un conflit alors que getChild ne voyait rien au premier appel.
    let vu = false;
    const racine: FolderInfo = { driveId: "d", itemId: "root", path: "Racine", parentItemId: null, webUrl: null };
    const enfant: ChildItem = { id: "pv", name: "PV", isFolder: true, size: null, webUrl: null };
    const concurrent = {
      getFolder: async (_d: string, id: string) =>
        id === "pv" ? { ...racine, itemId: "pv", path: "Racine / PV", parentItemId: "root" } : racine,
      getChild: async () => (vu ? enfant : null),
      createFolder: async () => {
        vu = true;
        throw new SharePointConflictError("PV");
      },
    } as unknown as SharePointClient;
    expect((await ensureFolderPath(concurrent, "d", "root", ["PV"], true)).path).toBe("Racine / PV");
  });
});
