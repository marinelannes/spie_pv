import type { ApiErrorBody, ApiErrorCode } from "@spie/shared";
import type { FastifyError, FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { HttpError } from "../lib/errors.js";
import { SharePointConflictError, SharePointError } from "../sharepoint/types.js";

function body(code: ApiErrorCode, message: string, fields?: Record<string, string[]>): ApiErrorBody {
  return { error: fields ? { code, message, fields } : { code, message } };
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError | Error, req, reply) => {
    if (err instanceof ZodError) {
      const fields: Record<string, string[]> = {};
      for (const issue of err.issues) {
        const key = issue.path.join(".") || "_";
        (fields[key] ??= []).push(issue.message);
      }
      return reply.status(400).send(body("validation", "Données invalides.", fields));
    }
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send(body(err.code, err.message));
    }
    if (err instanceof SharePointConflictError) {
      return reply.status(409).send(body("conflict", err.message));
    }
    if (err instanceof SharePointError) {
      req.log.warn({ err }, "erreur SharePoint");
      return reply.status(502).send(body("sharepoint_error", `SharePoint : ${err.message}`));
    }
    const statusCode = "statusCode" in err && typeof err.statusCode === "number" ? err.statusCode : 500;
    if (statusCode === 429) {
      return reply.status(429).send(body("rate_limited", "Trop de tentatives. Réessayez dans une minute."));
    }
    if (statusCode >= 400 && statusCode < 500) {
      return reply.status(statusCode).send(body("validation", err.message));
    }
    req.log.error({ err }, "erreur interne");
    return reply.status(500).send(body("internal", "Erreur interne du serveur."));
  });
}
