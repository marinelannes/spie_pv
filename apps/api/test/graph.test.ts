import { describe, expect, it } from "vitest";
import { GraphSharePointClient } from "../src/sharepoint/graph.js";
import { SharePointConflictError, SharePointError } from "../src/sharepoint/types.js";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Faux Graph : chaque réponse est choisie par une fonction selon l'URL et la méthode. */
function fakeGraph(route: (c: Call) => Response) {
  const calls: Call[] = [];
  const fetchFn = (async (input: string | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body,
    };
    calls.push(call);
    return route(call);
  }) as typeof fetch;
  const client = new GraphSharePointClient({
    siteId: "contoso.sharepoint.com,site-guid,web-guid",
    getToken: async () => "jeton-test",
    fetch: fetchFn,
    simpleUploadLimit: 1000,
    chunkSize: 400,
  });
  return { client, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("GraphSharePointClient", () => {
  it("envoi simple : PUT …/content avec conflictBehavior=fail et le jeton applicatif", async () => {
    const { client, calls } = fakeGraph(() =>
      json(201, { id: "f1", name: "test.txt", size: 3, webUrl: "https://x/test.txt" }),
    );
    const res = await client.uploadFile({
      driveId: "b!drive",
      parentItemId: "dossier",
      fileName: "PV_MES_RPN_HTA_F1_A35173-20261119-143205_indA.pdf",
      content: new Uint8Array([1, 2, 3]),
      contentType: "application/pdf",
    });
    expect(res).toEqual({ id: "f1", name: "test.txt", size: 3, webUrl: "https://x/test.txt" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("PUT");
    expect(calls[0]!.url).toBe(
      "https://graph.microsoft.com/v1.0/drives/b!drive/items/dossier:/PV_MES_RPN_HTA_F1_A35173-20261119-143205_indA.pdf:/content" +
        "?@microsoft.graph.conflictBehavior=fail",
    );
    expect(calls[0]!.headers).toMatchObject({ Authorization: "Bearer jeton-test", "Content-Type": "application/pdf" });
  });

  it("encode les noms de fichiers (espaces, accents, apostrophes)", async () => {
    const { client, calls } = fakeGraph(() => json(201, { id: "f", name: "n" }));
    await client.uploadFile({
      driveId: "d",
      parentItemId: "p",
      fileName: "Réserve d'essai 1.txt",
      content: new Uint8Array(1),
    });
    expect(calls[0]!.url).toContain("/items/p:/R%C3%A9serve%20d%27essai%201.txt:/content");
  });

  it("fichier existant : SharePointConflictError (jamais d'écrasement)", async () => {
    const { client } = fakeGraph(() => json(409, { error: { code: "nameAlreadyExists", message: "exists" } }));
    await expect(
      client.uploadFile({ driveId: "d", parentItemId: "p", fileName: "a.txt", content: new Uint8Array(1) }),
    ).rejects.toBeInstanceOf(SharePointConflictError);
  });

  it("gros fichier : session d'envoi par morceaux, sans jeton sur l'URL pré-authentifiée", async () => {
    const total = 1000;
    const { client, calls } = fakeGraph((c) => {
      if (c.url.endsWith(":/createUploadSession")) return json(200, { uploadUrl: "https://upload.example/session/1" });
      const range = c.headers["Content-Range"]!;
      return range.endsWith(`-${total - 1}/${total}`)
        ? json(201, { id: "gros", name: "gros.pdf", size: total })
        : json(202, { nextExpectedRanges: [] });
    });
    const res = await client.uploadFile({
      driveId: "d",
      parentItemId: "p",
      fileName: "gros.pdf",
      content: new Uint8Array(total),
    });
    expect(res.id).toBe("gros");

    const [create, ...chunks] = calls;
    expect(create!.method).toBe("POST");
    expect(JSON.parse(create!.body as string)).toEqual({ item: { "@microsoft.graph.conflictBehavior": "fail" } });
    expect(chunks.map((c) => c.headers["Content-Range"])).toEqual([
      "bytes 0-399/1000",
      "bytes 400-799/1000",
      "bytes 800-999/1000",
    ]);
    for (const c of chunks) {
      expect(c.url).toBe("https://upload.example/session/1");
      expect(c.headers.Authorization).toBeUndefined();
    }
  });

  it("annule la session d'envoi en cas d'échec d'un morceau", async () => {
    const { client, calls } = fakeGraph((c) => {
      if (c.url.endsWith(":/createUploadSession")) return json(200, { uploadUrl: "https://upload.example/s" });
      if (c.method === "DELETE") return new Response(null, { status: 204 });
      return json(500, { error: { code: "generalException", message: "boom" } });
    });
    await expect(
      client.uploadFile({ driveId: "d", parentItemId: "p", fileName: "g.pdf", content: new Uint8Array(1000) }),
    ).rejects.toBeInstanceOf(SharePointError);
    expect(calls.at(-1)).toMatchObject({ method: "DELETE", url: "https://upload.example/s" });
  });

  it("403 : message qui oriente vers la permission Sites.Selected", async () => {
    const { client } = fakeGraph(() => json(403, { error: { code: "accessDenied", message: "Access denied" } }));
    await expect(client.getSite()).rejects.toThrow(/Sites\.Selected/);
  });

  it("liste les bibliothèques en suivant la pagination", async () => {
    const { client, calls } = fakeGraph((c) =>
      c.url.includes("page2")
        ? json(200, { value: [{ id: "d2", name: "Archives", driveType: "documentLibrary" }] })
        : json(200, {
            value: [
              { id: "d1", name: "Documents", driveType: "documentLibrary" },
              { id: "x", name: "Perso", driveType: "personal" },
            ],
            "@odata.nextLink": "https://graph.microsoft.com/v1.0/sites/s/drives?page2",
          }),
    );
    const drives = await client.listDrives();
    expect(drives.map((d) => d.name)).toEqual(["Documents", "Archives"]);
    expect(calls[0]!.url).toContain("/sites/contoso.sharepoint.com,site-guid,web-guid/drives");
  });

  it("reconstitue le chemin lisible d'un dossier", async () => {
    const { client } = fakeGraph((c) => {
      if (c.url.includes("/drives/d1?")) return json(200, { id: "d1", name: "Documents" });
      return json(200, {
        id: "item-pv",
        name: "PV",
        folder: { childCount: 0 },
        parentReference: {
          id: "item-mes",
          path: "/drives/d1/root:/Affaires/A35173%20-%20GAU11/03%20-%20Mise%20en%20service",
        },
      });
    });
    const f = await client.getFolder("d1", "item-pv");
    expect(f).toMatchObject({
      itemId: "item-pv",
      path: "Documents / Affaires / A35173 - GAU11 / 03 - Mise en service / PV",
      parentItemId: "item-mes",
    });
  });

  it("racine de bibliothèque : alias « root », pas de parent", async () => {
    const { client } = fakeGraph((c) =>
      c.url.includes("/drives/d1?")
        ? json(200, { id: "d1", name: "Documents" })
        : json(200, { id: "01ROOT", name: "root", root: {}, folder: {} }),
    );
    expect(await client.getFolder("d1", "root")).toMatchObject({
      itemId: "root",
      path: "Documents",
      parentItemId: null,
    });
  });
});
