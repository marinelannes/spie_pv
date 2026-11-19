import type { DriveItemDto, UploadedFileDto } from "@spie/shared";

export interface SiteInfo {
  id: string;
  name: string;
  webUrl: string | null;
}

export interface FolderInfo {
  driveId: string;
  /** `DRIVE_ROOT_ITEM_ID` (« root ») pour la racine de la bibliothèque. */
  itemId: string;
  /** Chemin lisible « Bibliothèque / Dossier / Sous-dossier ». */
  path: string;
  /** null à la racine de la bibliothèque (le parent est alors la liste des bibliothèques). */
  parentItemId: string | null;
  webUrl: string | null;
}

export interface UploadArgs {
  driveId: string;
  parentItemId: string;
  fileName: string;
  content: Uint8Array;
  contentType?: string;
}

/**
 * Accès au site SharePoint cible. Implémentations : Microsoft Graph (recette, production)
 * et dossier local (développement, tests).
 */
export interface SharePointClient {
  readonly mode: "graph" | "fake";
  getSite(): Promise<SiteInfo>;
  /** Bibliothèques de documents du site. */
  listDrives(): Promise<DriveItemDto[]>;
  getFolder(driveId: string, itemId: string): Promise<FolderInfo>;
  listChildFolders(driveId: string, itemId: string): Promise<DriveItemDto[]>;
  /** Dépose un fichier. Un fichier existant n'est jamais écrasé (spec §5.4) : SharePointConflictError. */
  uploadFile(args: UploadArgs): Promise<UploadedFileDto>;
}

export class SharePointError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly graphCode?: string,
  ) {
    super(message);
    this.name = "SharePointError";
  }
}

export class SharePointConflictError extends SharePointError {
  constructor(fileName: string) {
    super(`Le fichier « ${fileName} » existe déjà dans ce dossier.`, 409, "nameAlreadyExists");
    this.name = "SharePointConflictError";
  }
}
