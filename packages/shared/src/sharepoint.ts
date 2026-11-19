import { z } from "zod";

/** Élément affiché dans le navigateur de dossiers SharePoint du back-office. */
export interface DriveItemDto {
  id: string;
  driveId: string;
  name: string;
  /** Bibliothèque de documents (niveau racine du site) ou dossier. */
  kind: "drive" | "folder";
  webUrl: string | null;
  childFolderCount: number | null;
}

/** Identifiant Graph de la racine d'une bibliothèque (`/drives/{id}/items/root`). */
export const DRIVE_ROOT_ITEM_ID = "root";

export interface SharePointBrowseResponse {
  /** null quand on liste les bibliothèques du site. */
  current: {
    driveId: string;
    /** `DRIVE_ROOT_ITEM_ID` à la racine de la bibliothèque. */
    itemId: string;
    path: string;
    webUrl: string | null;
  } | null;
  /** Dossier parent ; null = retour à la liste des bibliothèques. */
  parent: { driveId: string; itemId: string } | null;
  items: DriveItemDto[];
}

export interface TestUploadResponse extends UploadedFileDto {
  folderPath: string;
}

export interface SharePointStatusDto {
  mode: "graph" | "fake" | "disabled";
  configured: boolean;
  site: { id: string; name: string; webUrl: string | null } | null;
  error: string | null;
}

export const sharePointBrowseQuerySchema = z.object({
  driveId: z.string().min(1).optional(),
  itemId: z.string().min(1).optional(),
});

export const testUploadRequestSchema = z.union([
  z.object({ affaireId: z.string().uuid() }),
  z.object({ driveId: z.string().min(1), itemId: z.string().min(1) }),
]);
export type TestUploadRequest = z.infer<typeof testUploadRequestSchema>;

export interface UploadedFileDto {
  id: string;
  name: string;
  size: number;
  webUrl: string | null;
}

/**
 * Remplace les caractères interdits par SharePoint (`" * : < > ? / \ |`, spec §5.3) et les
 * caractères de contrôle par « _ ». Supprime aussi les espaces et points en fin de nom, refusés par SharePoint.
 */
export function sanitizeSharePointFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/["*:<>?/\\|\u0000-\u001f]/g, "_").replace(/[\s.]+$/, "");
  return cleaned.length > 0 ? cleaned : "_";
}
