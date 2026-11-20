import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AzureBlobArchive,
  LocalFileArchive,
  assertArchiveKey,
  createFileArchive,
  type BlobContainerLike,
} from "../src/storage/archive.js";

describe("assertArchiveKey", () => {
  it("accepte une clé à plusieurs segments", () => {
    expect(() => assertArchiveKey("pv/A00001/A00001-20261119-143205/PV_MES_x_indA.pdf")).not.toThrow();
  });
  it.each(["", "a//b", "../x", "a/./b", "a\\b", "a/\u0001"])("refuse « %s »", (k) => {
    expect(() => assertArchiveKey(k)).toThrow(/Clé d'archive invalide/);
  });
});

describe("LocalFileArchive", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "spie-archive-"));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("écrit, relit et remplace un fichier ; null si absent", async () => {
    const a = new LocalFileArchive(dir);
    await a.put("pv/A1/f.pdf", new Uint8Array([1, 2, 3]));
    expect(Array.from((await a.get("pv/A1/f.pdf"))!)).toEqual([1, 2, 3]);
    await a.put("pv/A1/f.pdf", new Uint8Array([4]));
    expect(Array.from((await a.get("pv/A1/f.pdf"))!)).toEqual([4]);
    expect(await a.get("pv/A1/absent.pdf")).toBeNull();
  });

  it("refuse de sortir du dossier", async () => {
    const a = new LocalFileArchive(dir);
    await expect(a.put("../evasion.txt", new Uint8Array())).rejects.toThrow();
  });

  it("createFileArchive choisit l'implémentation locale", () => {
    expect(createFileArchive({ mode: "local", dir }).mode).toBe("local");
  });
});

describe("AzureBlobArchive", () => {
  function fakeContainer() {
    const blobs = new Map<string, { data: Uint8Array; type: string }>();
    const container: BlobContainerLike = {
      getBlockBlobClient: (name) => ({
        uploadData: async (data, opts) => {
          blobs.set(name, { data, type: opts.blobHTTPHeaders.blobContentType });
        },
        downloadToBuffer: async () => {
          const b = blobs.get(name);
          if (!b) throw Object.assign(new Error("BlobNotFound"), { statusCode: 404 });
          return Buffer.from(b.data);
        },
      }),
    };
    return { container, blobs };
  }

  it("dépose le blob avec son type de contenu et le relit", async () => {
    const { container, blobs } = fakeContainer();
    const a = new AzureBlobArchive(container);
    await a.put("pv/A1/f.json", new TextEncoder().encode("{}"), "application/json");
    expect(blobs.get("pv/A1/f.json")?.type).toBe("application/json");
    expect(new TextDecoder().decode((await a.get("pv/A1/f.json"))!)).toBe("{}");
  });

  it("404 → null, autre erreur → propagée", async () => {
    const { container } = fakeContainer();
    const a = new AzureBlobArchive(container);
    expect(await a.get("absent")).toBeNull();
    const enPanne = new AzureBlobArchive({
      getBlockBlobClient: () => ({
        uploadData: async () => undefined,
        downloadToBuffer: async () => {
          throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
        },
      }),
    });
    await expect(enPanne.get("x")).rejects.toThrow("Forbidden");
  });

  it("createFileArchive (azure) construit le client sans appel réseau", () => {
    const a = createFileArchive({
      mode: "azure",
      accountUrl: "https://compte.blob.core.windows.net/",
      container: "pv-files",
      managedIdentityClientId: "id",
    });
    expect(a.mode).toBe("azure");
  });
});
