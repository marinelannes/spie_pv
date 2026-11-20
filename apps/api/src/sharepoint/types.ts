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
  /** Élément (fichier ou dossier) nommé `name` directement sous le dossier, ou null s'il n'existe pas. */
  getChild(driveId: string, parentItemId: string, name: string): Promise<ChildItem | null>;
  /** Crée un sous-dossier. Échoue (SharePointConflictError) s'il existe déjà. */
  createFolder(driveId: string, parentItemId: string, name: string): Promise<FolderInfo>;
}

export interface ChildItem {
  id: string;
  name: string;
  isFolder: boolean;
  size: number | null;
  webUrl: string | null;
}

/**
 * Descend (et crée au besoin) un chemin de sous-dossiers sous un dossier : dossier de l'affaire + chemin relatif de la
 * famille (spec §5.2). Sans création autorisée, un sous-dossier manquant est une erreur (point ouvert n°13).
 */
export async function ensureFolderPath(
  sp: SharePointClient,
  driveId: string,
  rootItemId: string,
  segments: readonly string[],
  create: boolean,
): Promise<FolderInfo> {
  let folder = await sp.getFolder(driveId, rootItemId);
  for (const segment of segments) {
    const child = await sp.getChild(driveId, folder.itemId, segment);
    if (child) {
      if (!child.isFolder)
        throw new SharePointError(`« ${segment} » existe mais n'est pas un dossier (${folder.path}).`, 409);
      folder = await sp.getFolder(driveId, child.id);
      continue;
    }
    if (!create) {
      throw new SharePointError(
        `sous-dossier « ${segment} » introuvable dans « ${folder.path} ».`,
        404,
        "itemNotFound",
      );
    }
    try {
      folder = await sp.createFolder(driveId, folder.itemId, segment);
    } catch (err) {
      // Créé entre-temps par un autre traitement : on le relit.
      if (!(err instanceof SharePointConflictError)) throw err;
      const again = await sp.getChild(driveId, folder.itemId, segment);
      if (!again?.isFolder) throw err;
      folder = await sp.getFolder(driveId, again.id);
    }
  }
  return folder;
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
