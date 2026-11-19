import { ClientCertificateCredential } from "@azure/identity";
import { DRIVE_ROOT_ITEM_ID, type DriveItemDto, type UploadedFileDto } from "@spie/shared";
import {
  SharePointConflictError,
  SharePointError,
  type FolderInfo,
  type SharePointClient,
  type SiteInfo,
  type UploadArgs,
} from "./types.js";

const GRAPH_SCOPE = "https://graph.microsoft.com/.default";
/** En dessous : envoi simple (PUT …/content). Au-delà : session d'envoi (spec §5.4). */
const SIMPLE_UPLOAD_LIMIT = 4 * 1024 * 1024;
/** Les morceaux d'une session d'envoi doivent être des multiples de 320 Kio. */
const CHUNK_SIZE = 10 * 320 * 1024;

interface GraphDriveItem {
  id: string;
  name: string;
  size?: number;
  webUrl?: string;
  folder?: { childCount?: number };
  file?: unknown;
  root?: unknown;
  parentReference?: { id?: string; path?: string; driveId?: string };
}

export interface GraphSharePointOptions {
  siteId: string;
  getToken: () => Promise<string>;
  fetch?: typeof fetch;
  baseUrl?: string;
  simpleUploadLimit?: number;
  chunkSize?: number;
}

/** Client Graph à partir de l'identité applicative (certificat, permission Sites.Selected). */
export function createGraphSharePointClient(cfg: {
  tenantId: string;
  clientId: string;
  certificate: { pem: string } | { path: string };
  siteId: string;
}): GraphSharePointClient {
  const credential =
    "pem" in cfg.certificate
      ? new ClientCertificateCredential(cfg.tenantId, cfg.clientId, { certificate: cfg.certificate.pem })
      : new ClientCertificateCredential(cfg.tenantId, cfg.clientId, { certificatePath: cfg.certificate.path });
  return new GraphSharePointClient({
    siteId: cfg.siteId,
    getToken: async () => {
      try {
        return (await credential.getToken(GRAPH_SCOPE)).token;
      } catch (err) {
        throw new SharePointError(
          `authentification Microsoft Graph impossible (certificat, client id ou consentement administrateur ?) : ${
            (err as Error).message
          }`,
        );
      }
    },
  });
}

export class GraphSharePointClient implements SharePointClient {
  readonly mode = "graph" as const;
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly simpleUploadLimit: number;
  private readonly chunkSize: number;
  private readonly driveNames = new Map<string, string>();

  constructor(private readonly opts: GraphSharePointOptions) {
    this.fetchFn = opts.fetch ?? fetch;
    this.baseUrl = opts.baseUrl ?? "https://graph.microsoft.com/v1.0";
    this.simpleUploadLimit = opts.simpleUploadLimit ?? SIMPLE_UPLOAD_LIMIT;
    this.chunkSize = opts.chunkSize ?? CHUNK_SIZE;
  }

  async getSite(): Promise<SiteInfo> {
    const site = await this.json<{ id: string; displayName?: string; name?: string; webUrl?: string }>(
      "GET",
      `/sites/${this.opts.siteId}?$select=id,displayName,name,webUrl`,
      "lecture du site",
    );
    return { id: site.id, name: site.displayName ?? site.name ?? site.id, webUrl: site.webUrl ?? null };
  }

  async listDrives(): Promise<DriveItemDto[]> {
    const drives = await this.paged<{ id: string; name: string; webUrl?: string; driveType?: string }>(
      `/sites/${this.opts.siteId}/drives?$select=id,name,webUrl,driveType`,
      "liste des bibliothèques",
    );
    return drives
      .filter((d) => d.driveType === undefined || d.driveType === "documentLibrary")
      .map((d) => {
        this.driveNames.set(d.id, d.name);
        return {
          id: d.id,
          driveId: d.id,
          name: d.name,
          kind: "drive",
          webUrl: d.webUrl ?? null,
          childFolderCount: null,
        };
      });
  }

  async getFolder(driveId: string, itemId: string): Promise<FolderInfo> {
    const driveName = await this.driveName(driveId);
    const item = await this.json<GraphDriveItem>(
      "GET",
      `/drives/${enc(driveId)}/items/${enc(itemId)}?$select=id,name,webUrl,folder,root,parentReference`,
      "lecture du dossier",
    );
    if (item.root || itemId === DRIVE_ROOT_ITEM_ID) {
      return { driveId, itemId: DRIVE_ROOT_ITEM_ID, path: driveName, parentItemId: null, webUrl: item.webUrl ?? null };
    }
    if (!item.folder) throw new SharePointError(`« ${item.name} » n'est pas un dossier.`, 400);
    // parentReference.path = "/drives/{id}/root:/Dossier/Sous-dossier" (encodé en pourcentage).
    const parentPath = decodeURIComponent(item.parentReference?.path?.split("root:")[1] ?? "");
    const segments = parentPath.split("/").filter(Boolean);
    return {
      driveId,
      itemId: item.id,
      path: [driveName, ...segments, item.name].join(" / "),
      parentItemId: segments.length === 0 ? DRIVE_ROOT_ITEM_ID : (item.parentReference?.id ?? DRIVE_ROOT_ITEM_ID),
      webUrl: item.webUrl ?? null,
    };
  }

  async listChildFolders(driveId: string, itemId: string): Promise<DriveItemDto[]> {
    const children = await this.paged<GraphDriveItem>(
      `/drives/${enc(driveId)}/items/${enc(itemId)}/children?$select=id,name,webUrl,folder&$top=200`,
      "liste des sous-dossiers",
    );
    return children
      .filter((c) => c.folder)
      .map((c) => ({
        id: c.id,
        driveId,
        name: c.name,
        kind: "folder" as const,
        webUrl: c.webUrl ?? null,
        childFolderCount: null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  }

  async uploadFile(args: UploadArgs): Promise<UploadedFileDto> {
    const item =
      args.content.byteLength < this.simpleUploadLimit ? await this.simpleUpload(args) : await this.sessionUpload(args);
    return { id: item.id, name: item.name, size: item.size ?? args.content.byteLength, webUrl: item.webUrl ?? null };
  }

  private async simpleUpload(args: UploadArgs): Promise<GraphDriveItem> {
    const path =
      `/drives/${enc(args.driveId)}/items/${enc(args.parentItemId)}:/${enc(args.fileName)}:/content` +
      `?@microsoft.graph.conflictBehavior=fail`;
    const res = await this.request("PUT", path, {
      body: args.content,
      headers: { "Content-Type": args.contentType ?? "application/octet-stream" },
    });
    if (res.status === 409) throw new SharePointConflictError(args.fileName);
    if (!res.ok) throw await toError(res, "dépôt du fichier");
    return (await res.json()) as GraphDriveItem;
  }

  private async sessionUpload(args: UploadArgs): Promise<GraphDriveItem> {
    const session = await this.json<{ uploadUrl: string }>(
      "POST",
      `/drives/${enc(args.driveId)}/items/${enc(args.parentItemId)}:/${enc(args.fileName)}:/createUploadSession`,
      "ouverture de la session d'envoi",
      { item: { "@microsoft.graph.conflictBehavior": "fail" } },
    ).catch((err: unknown) => {
      if (err instanceof SharePointError && err.status === 409) throw new SharePointConflictError(args.fileName);
      throw err;
    });

    const total = args.content.byteLength;
    try {
      for (let start = 0; start < total; start += this.chunkSize) {
        const end = Math.min(start + this.chunkSize, total);
        // L'URL de session est pré-authentifiée : pas d'en-tête Authorization (documentation Graph).
        const res = await this.fetchFn(session.uploadUrl, {
          method: "PUT",
          headers: { "Content-Length": String(end - start), "Content-Range": `bytes ${start}-${end - 1}/${total}` },
          body: args.content.subarray(start, end),
        });
        if (res.status === 409) throw new SharePointConflictError(args.fileName);
        if (!res.ok) throw await toError(res, "envoi d'un morceau");
        if (end === total) return (await res.json()) as GraphDriveItem;
      }
    } catch (err) {
      await this.fetchFn(session.uploadUrl, { method: "DELETE" }).catch(() => undefined);
      throw err;
    }
    throw new SharePointError("session d'envoi terminée sans réponse finale.");
  }

  private async driveName(driveId: string): Promise<string> {
    let name = this.driveNames.get(driveId);
    if (!name) {
      const d = await this.json<{ name: string }>(
        "GET",
        `/drives/${enc(driveId)}?$select=id,name`,
        "lecture de la bibliothèque",
      );
      name = d.name;
      this.driveNames.set(driveId, name);
    }
    return name;
  }

  private async paged<T>(path: string, context: string): Promise<T[]> {
    const out: T[] = [];
    let next: string | undefined = path;
    while (next) {
      const page: { value: T[]; "@odata.nextLink"?: string } = await this.json("GET", next, context);
      out.push(...page.value);
      next = page["@odata.nextLink"];
    }
    return out;
  }

  private async json<T>(method: string, path: string, context: string, body?: unknown): Promise<T> {
    const res = await this.request(method, path, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
    });
    if (!res.ok) throw await toError(res, context);
    return (await res.json()) as T;
  }

  private async request(
    method: string,
    pathOrUrl: string,
    init: { body?: RequestInit["body"]; headers?: Record<string, string> },
  ): Promise<Response> {
    const token = await this.opts.getToken();
    const url = pathOrUrl.startsWith("https://") ? pathOrUrl : `${this.baseUrl}${pathOrUrl}`;
    try {
      return await this.fetchFn(url, {
        method,
        body: init.body,
        headers: { Authorization: `Bearer ${token}`, ...init.headers },
      });
    } catch (err) {
      throw new SharePointError(`Microsoft Graph injoignable : ${(err as Error).message}`);
    }
  }
}

/** Encode un segment d'URL Graph ; l'apostrophe est aussi encodée (syntaxe OData). */
function enc(segment: string): string {
  return encodeURIComponent(segment).replace(/'/g, "%27");
}

const HINTS: Record<number, string> = {
  401: "authentification refusée",
  403: "accès refusé : la permission Sites.Selected (écriture) est-elle accordée sur ce site ?",
  404: "élément introuvable : le dossier a-t-il été déplacé ou supprimé ?",
  429: "trop de requêtes, réessayer plus tard",
  503: "SharePoint indisponible, réessayer plus tard",
};

async function toError(res: Response, context: string): Promise<SharePointError> {
  let code: string | undefined;
  let message: string | undefined;
  try {
    const j = (await res.json()) as { error?: { code?: string; message?: string } };
    code = j.error?.code;
    message = j.error?.message;
  } catch {
    // corps non JSON
  }
  const hint = HINTS[res.status];
  const detail = [message, hint].filter(Boolean).join(" — ") || res.statusText;
  return new SharePointError(`${context} : ${detail} (HTTP ${res.status}${code ? `, ${code}` : ""})`, res.status, code);
}
