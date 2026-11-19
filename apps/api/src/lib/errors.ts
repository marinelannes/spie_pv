import type { ApiErrorCode } from "@spie/shared";

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string) => new HttpError(400, "validation", message);
export const unauthorized = (message = "Authentification requise.") => new HttpError(401, "unauthorized", message);
export const forbidden = (message = "Accès refusé.") => new HttpError(403, "forbidden", message);
export const notFound = (message = "Ressource introuvable.") => new HttpError(404, "not_found", message);
export const conflict = (message: string) => new HttpError(409, "conflict", message);
