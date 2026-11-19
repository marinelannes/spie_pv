import type { Role } from "@spie/shared";
import type { FastifyRequest } from "fastify";
import { HttpError, forbidden, unauthorized } from "../lib/errors.js";
import { findUserById } from "../services/users.js";

export interface RequireAuthOptions {
  roles?: readonly Role[];
  /** Routes accessibles avant le changement obligatoire du mot de passe provisoire. */
  allowPendingPasswordChange?: boolean;
}

/**
 * preHandler : vérifie le jeton d'accès (Bearer), recharge l'utilisateur en base à chaque requête
 * (un compte désactivé ou un changement de rôle prend effet immédiatement) et contrôle le rôle (spec §7.3).
 */
export function requireAuth(opts: RequireAuthOptions = {}) {
  return async function requireAuthHook(req: FastifyRequest): Promise<void> {
    const { ctx } = req.server;
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw unauthorized();
    const claims = await ctx.tokens.verify(header.slice("Bearer ".length), ctx.now());
    if (!claims) throw unauthorized("Session expirée.");

    const user = await findUserById(ctx.db, claims.sub);
    if (!user) throw unauthorized();
    if (!user.actif) throw new HttpError(401, "account_disabled", "Ce compte est désactivé.");
    if (user.mustChangePassword && !opts.allowPendingPasswordChange) {
      throw new HttpError(403, "password_change_required", "Vous devez changer votre mot de passe provisoire.");
    }
    if (opts.roles && !opts.roles.includes(user.role)) throw forbidden();

    req.user = user;
    req.sessionFamilyId = claims.sid;
  };
}
