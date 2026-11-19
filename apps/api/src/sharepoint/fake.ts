import { existsSync } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { DRIVE_ROOT_ITEM_ID, type DriveItemDto, type UploadedFileDto } from "@spie/shared";
import {
  SharePointConflictError,
  SharePointError,
  type FolderInfo,
  type SharePointClient,
  type SiteInfo,
  type UploadArgs,
} from "./types.js";

const DRIVES = [{ id: "fake-documents", name: "Documents partagés" }];

/**
 * SharePoint simulé par un dossier local (SHAREPOINT_MODE=fake) : développement et tests sans tenant.
 * Chaque bibliothèque est un sous-dossier ; les identifiants d'éléments encodent le chemin relatif.
 */
export class FakeSharePointClient implements SharePointClient {
  readonly mode = "fake" as const;
  private readonly root: string;
  private ready: Promise<void> | null = null;

  constructor(rootDir: string) {
    this.root = resolve(rootDir);
  }

  async getSite(): Promise<SiteInfo> {
    await this.init();
    return { id: "fake-site", name: "Site SharePoint simulé (dossier local)", webUrl: pathToFileURL(this.root).href };
  }

  async listDrives(): Promise<DriveItemDto[]> {
    await this.init();
    return DRIVES.map((d) => ({
      id: d.id,
      driveId: d.id,
      name: d.name,
      kind: "drive",
      webUrl: pathToFileURL(this.driveDir(d.id)).href,
      childFolderCount: null,
    }));
  }

  async getFolder(driveId: string, itemId: string): Promise<FolderInfo> {
    await this.init();
    const drive = this.drive(driveId);
    const rel = this.decode(itemId);
    const abs = this.resolveIn(driveId, rel);
    if (!existsSync(abs) || !(await stat(abs)).isDirectory()) {
      throw new SharePointError(
        "élément introuvable : le dossier a-t-il été déplacé ou supprimé ?",
        404,
        "itemNotFound",
      );
    }
    const segments = rel.split("/").filter(Boolean);
    return {
      driveId,
      itemId: this.encode(rel),
      path: [drive.name, ...segments].join(" / "),
      parentItemId: segments.length === 0 ? null : this.encode(segments.slice(0, -1).join("/")),
      webUrl: pathToFileURL(abs).href,
    };
  }

  async listChildFolders(driveId: string, itemId: string): Promise<DriveItemDto[]> {
    const folder = await this.getFolder(driveId, itemId);
    const rel = this.decode(folder.itemId);
    const entries = await readdir(this.resolveIn(driveId, rel), { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => {
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        return {
          id: this.encode(childRel),
          driveId,
          name: e.name,
          kind: "folder" as const,
          webUrl: pathToFileURL(this.resolveIn(driveId, childRel)).href,
          childFolderCount: null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  }

  async uploadFile(args: UploadArgs): Promise<UploadedFileDto> {
    const folder = await this.getFolder(args.driveId, args.parentItemId);
    const parentRel = this.decode(folder.itemId);
    const rel = parentRel ? `${parentRel}/${args.fileName}` : args.fileName;
    const abs = this.resolveIn(args.driveId, rel);
    try {
      await writeFile(abs, args.content, { flag: "wx" }); // wx : échoue si le fichier existe
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") throw new SharePointConflictError(args.fileName);
      throw err;
    }
    return {
      id: this.encode(rel),
      name: args.fileName,
      size: args.content.byteLength,
      webUrl: pathToFileURL(abs).href,
    };
  }

  /** Crée les bibliothèques et, au premier lancement, une arborescence d'exemple. */
  private init(): Promise<void> {
    this.ready ??= (async () => {
      for (const d of DRIVES) {
        const dir = this.driveDir(d.id);
        const fresh = !existsSync(dir);
        await mkdir(dir, { recursive: true });
        if (fresh) {
          await mkdir(join(dir, "Affaires", "A35173 - Stockage batteries GAU11", "03 - Mise en service", "PV"), {
            recursive: true,
          });
        }
      }
    })();
    return this.ready;
  }

  private drive(driveId: string) {
    const d = DRIVES.find((x) => x.id === driveId);
    if (!d) throw new SharePointError("bibliothèque introuvable.", 404, "itemNotFound");
    return d;
  }

  private driveDir(driveId: string): string {
    return join(this.root, this.drive(driveId).name);
  }

  /** Résout un chemin relatif dans la bibliothèque en refusant toute sortie (« .. »). */
  private resolveIn(driveId: string, rel: string): string {
    const base = this.driveDir(driveId);
    const abs = resolve(base, rel);
    const r = relative(base, abs);
    if (r.startsWith("..") || r.split(sep).includes("..")) throw new SharePointError("chemin invalide.", 400);
    return abs;
  }

  private encode(rel: string): string {
    return rel === "" ? DRIVE_ROOT_ITEM_ID : Buffer.from(rel, "utf8").toString("base64url");
  }

  private decode(itemId: string): string {
    return itemId === DRIVE_ROOT_ITEM_ID ? "" : Buffer.from(itemId, "base64url").toString("utf8");
  }
}
