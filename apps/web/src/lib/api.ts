import type { ApiErrorBody, ApiErrorCode, SessionResponse } from "@spie/shared";

/**
 * Client HTTP de l'API (même origine). Le jeton d'accès reste en mémoire ; le jeton de
 * rafraîchissement est un cookie HttpOnly que JavaScript ne voit jamais (spec §7.2).
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | "network",
    message: string,
    readonly fields?: Record<string, string[]>,
  ) {
    super(message);
  }
}

type SessionListener = (session: SessionResponse | null) => void;

let accessToken: string | null = null;
let refreshInFlight: Promise<SessionResponse | null> | null = null;
const listeners = new Set<SessionListener>();

export function onSessionChange(listener: SessionListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setSession(session: SessionResponse | null): void {
  accessToken = session?.accessToken ?? null;
  for (const l of listeners) l(session);
}

async function toApiError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as ApiErrorBody;
    return new ApiError(res.status, body.error.code, body.error.message, body.error.fields);
  } catch {
    return new ApiError(res.status, "internal", `Erreur ${res.status}`);
  }
}

/**
 * Délai au-delà duquel une requête sans réponse est abandonnée. Sans lui, un réseau qui « pend » (Wi-Fi de chantier,
 * portail captif) bloquerait la synchronisation indéfiniment, sans message. L'envoi d'un PV signé (signatures
 * comprises) a plus de temps qu'une lecture.
 */
export const DELAI_LECTURE_MS = 30_000;
export const DELAI_ENVOI_MS = 120_000;

const SERVEUR_MUET = "Le serveur ne répond pas. Vérifiez la connexion réseau.";

/** `fetch` abandonné après `delaiMs` sans réponse : lève alors ApiError(0, "network"). */
async function fetchAvecDelai(path: string, init: RequestInit, delaiMs: number): Promise<Response> {
  const controleur = new AbortController();
  let expire = false;
  const minuteur = setTimeout(() => {
    expire = true;
    controleur.abort();
  }, delaiMs);
  // Annulation demandée par l'appelant : transmise telle quelle.
  const annuler = () => controleur.abort();
  init.signal?.addEventListener("abort", annuler);
  try {
    return await fetch(path, { ...init, signal: controleur.signal });
  } catch (err) {
    if (expire) throw new ApiError(0, "network", SERVEUR_MUET);
    throw err;
  } finally {
    clearTimeout(minuteur);
    init.signal?.removeEventListener("abort", annuler);
  }
}

/** Rafraîchit la session via le cookie. Une seule requête à la fois, même si plusieurs appels échouent ensemble. */
export function refreshSession(): Promise<SessionResponse | null> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetchAvecDelai(
        "/api/auth/refresh",
        { method: "POST", credentials: "same-origin" },
        DELAI_LECTURE_MS,
      );
      if (!res.ok) {
        setSession(null);
        return null;
      }
      const session = (await res.json()) as SessionResponse;
      setSession(session);
      return session;
    } catch {
      // Hors ligne : on ne déconnecte pas l'utilisateur (spec §7.2).
      throw new ApiError(0, "network", "Serveur injoignable. Vérifiez la connexion réseau.");
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * Requête authentifiée brute (téléchargement de fichiers) : jeton d'accès, puis un rafraîchissement de session
 * et un nouvel essai en cas de 401. Lève ApiError(0, "network") si le serveur est injoignable.
 */
export async function apiFetch(path: string, opts: RequestOptions = {}, retried = false): Promise<Response> {
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetchAvecDelai(
      path,
      {
        method: opts.method ?? "GET",
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        credentials: "same-origin",
        signal: opts.signal,
      },
      opts.body === undefined ? DELAI_LECTURE_MS : DELAI_ENVOI_MS,
    );
  } catch (err) {
    if (err instanceof ApiError || (err as Error).name === "AbortError") throw err;
    throw new ApiError(0, "network", "Serveur injoignable. Vérifiez la connexion réseau.");
  }

  if (res.status === 401 && !retried && !path.startsWith("/api/auth/")) {
    const session = await refreshSession();
    if (session) return apiFetch(path, opts, true);
  }
  return res;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const res = await apiFetch(path, opts);
  if (!res.ok) {
    const err = await toApiError(res);
    if (res.status === 401) setSession(null);
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Chaîne de requête (« ?a=1&b=2 ») à partir de filtres ; les filtres vides sont omis. */
export function queryString(filtres: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filtres)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Message lisible pour une erreur quelconque. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Erreur inattendue.";
}
