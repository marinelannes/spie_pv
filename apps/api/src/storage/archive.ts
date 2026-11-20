import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { DefaultAzureCredential, ManagedIdentityCredential, type TokenCredential } from "@azure/identity";
import { BlobServiceClient } from "@azure/storage-blob";
import type { ArchiveConfig } from "../config.js";
import { isPathInside } from "../sharepoint/fake.js";

/**
 * Copie des fichiers produits (PDF, JSON, XLSX) : secours et redépôt (spec §5.4). Azure Blob Storage en recette et
 * production (identité managée), dossier local en développement et dans les tests.
 */
export interface FileArchive {
  readonly mode: "local" | "azure";
  put(key: string, content: Uint8Array, contentType: string): Promise<void>;
  /** null si la clé n'existe pas. */
  get(key: string): Promise<Uint8Array | null>;
}

/** Clé d'archive : segments séparés par « / », sans segment vide, « . » ni « .. ». */
export function assertArchiveKey(key: string): void {
  const segments = key.split("/");
  // eslint-disable-next-line no-control-regex
  if (!key || segments.some((s) => s === "" || s === "." || s === ".." || /[\\\u0000-\u001f]/.test(s))) {
    throw new Error(`Clé d'archive invalide : « ${key} ».`);
  }
}

export class LocalFileArchive implements FileArchive {
  readonly mode = "local" as const;
  private readonly root: string;

  constructor(dir: string) {
    this.root = resolve(dir);
  }

  private path(key: string): string {
    assertArchiveKey(key);
    const abs = resolve(join(this.root, ...key.split("/")));
    if (!isPathInside(this.root, abs)) throw new Error(`Clé d'archive invalide : « ${key} ».`);
    return abs;
  }

  async put(key: string, content: Uint8Array): Promise<void> {
    const abs = this.path(key);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.path(key)));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }
}

/** Sous-ensemble du ContainerClient d'@azure/storage-blob utilisé ici (remplaçable dans les tests). */
export interface BlobContainerLike {
  getBlockBlobClient(name: string): {
    uploadData(data: Uint8Array, opts: { blobHTTPHeaders: { blobContentType: string } }): Promise<unknown>;
    downloadToBuffer(): Promise<Buffer>;
  };
}

export class AzureBlobArchive implements FileArchive {
  readonly mode = "azure" as const;

  constructor(private readonly container: BlobContainerLike) {}

  async put(key: string, content: Uint8Array, contentType: string): Promise<void> {
    assertArchiveKey(key);
    await this.container
      .getBlockBlobClient(key)
      .uploadData(content, { blobHTTPHeaders: { blobContentType: contentType } });
  }

  async get(key: string): Promise<Uint8Array | null> {
    assertArchiveKey(key);
    try {
      return new Uint8Array(await this.container.getBlockBlobClient(key).downloadToBuffer());
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode === 404) return null;
      throw err;
    }
  }
}

export function createFileArchive(cfg: ArchiveConfig): FileArchive {
  if (cfg.mode === "local") return new LocalFileArchive(cfg.dir);
  const credential: TokenCredential = cfg.managedIdentityClientId
    ? new ManagedIdentityCredential({ clientId: cfg.managedIdentityClientId })
    : new DefaultAzureCredential();
  const container = new BlobServiceClient(cfg.accountUrl, credential).getContainerClient(cfg.container);
  return new AzureBlobArchive(container);
}
