import { randomUUID } from "node:crypto";
import { changePasswordRequestSchema, loginRequestSchema, type AuthUser, type SessionResponse } from "@spie/shared";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { currentUser } from "../context.js";
import { sessions, utilisateurs } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { HttpError, unauthorized } from "../lib/errors.js";
import { burnPasswordVerification, hashPassword, verifyPassword } from "../lib/passwords.js";
import { generateRefreshToken, hashRefreshToken } from "../lib/tokens.js";
import { requireAuth } from "../plugins/auth.js";
import { findUserByEmail, findUserById, revokeUserSessions, type UserRow } from "../services/users.js";

export const REFRESH_COOKIE = "spie_rt";
const COOKIE_PATH = "/api/auth";

export function toAuthUser(u: UserRow): AuthUser {
  return { id: u.id, email: u.email, nom: u.nom, role: u.role, mustChangePassword: u.mustChangePassword };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const { ctx } = app;
  const { db, config } = ctx;

  function setRefreshCookie(reply: FastifyReply, token: string): void {
    reply.setCookie(REFRESH_COOKIE, token, {
      path: COOKIE_PATH,
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: "strict",
      maxAge: config.refreshTokenTtlDays * 24 * 3600,
    });
  }

  function clearRefreshCookie(reply: FastifyReply): void {
    reply.clearCookie(REFRESH_COOKIE, {
      path: COOKIE_PATH,
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: "strict",
    });
  }

  /** Crée un jeton de rafraîchissement (nouvelle famille ou rotation) et le jeton d'accès associé. */
  async function issueSession(
    req: FastifyRequest,
    reply: FastifyReply,
    user: UserRow,
    familyId: string = randomUUID(),
    sessionId: string = randomUUID(),
  ): Promise<SessionResponse> {
    const now = ctx.now();
    const refreshToken = generateRefreshToken();
    await db.insert(sessions).values({
      id: sessionId,
      userId: user.id,
      familyId,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: new Date(now.getTime() + config.refreshTokenTtlDays * 24 * 3600 * 1000),
      userAgent: req.headers["user-agent"]?.slice(0, 300) ?? null,
      ip: req.ip,
    });
    setRefreshCookie(reply, refreshToken);
    const accessToken = await ctx.tokens.sign({ sub: user.id, sid: familyId }, now);
    return { accessToken, expiresIn: ctx.tokens.expiresIn, user: toAuthUser(user) };
  }

  async function revokeFamily(familyId: string): Promise<void> {
    await db
      .update(sessions)
      .set({ revokedAt: ctx.now() })
      .where(and(eq(sessions.familyId, familyId), isNull(sessions.revokedAt)));
  }

  app.post(
    "/login",
    { config: { rateLimit: { max: config.loginRateLimitPerMinute, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { email, password } = loginRequestSchema.parse(req.body);
      const now = ctx.now();
      const user = await findUserByEmail(db, email);

      if (!user) {
        await burnPasswordVerification(password);
        await audit(db, { action: "auth.login_failed", details: { email, raison: "compte inconnu" }, ip: req.ip });
        throw new HttpError(401, "invalid_credentials", "Identifiant ou mot de passe incorrect.");
      }

      if (user.lockedUntil && user.lockedUntil > now) {
        const minutes = Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60_000);
        throw new HttpError(
          423,
          "account_locked",
          `Compte temporairement verrouillé après plusieurs échecs. Réessayez dans ${minutes} min.`,
        );
      }

      if (!(await verifyPassword(user.passwordHash, password))) {
        // Incrément atomique en base : des tentatives simultanées ne s'écrasent pas entre elles.
        const [counted] = await db
          .update(utilisateurs)
          .set({ failedLoginCount: sql`${utilisateurs.failedLoginCount} + 1` })
          .where(eq(utilisateurs.id, user.id))
          .returning({ failedLoginCount: utilisateurs.failedLoginCount });
        const failures = counted?.failedLoginCount ?? config.loginMaxFailures;
        const lock = failures >= config.loginMaxFailures;
        if (lock) {
          await db
            .update(utilisateurs)
            .set({ failedLoginCount: 0, lockedUntil: new Date(now.getTime() + config.loginLockMinutes * 60_000) })
            .where(eq(utilisateurs.id, user.id));
        }
        await audit(db, {
          action: lock ? "auth.locked" : "auth.login_failed",
          actorId: user.id,
          targetType: "utilisateur",
          targetId: user.id,
          details: { echecs: failures },
          ip: req.ip,
        });
        if (lock) {
          throw new HttpError(
            423,
            "account_locked",
            `Trop d'échecs : compte verrouillé pendant ${config.loginLockMinutes} min.`,
          );
        }
        throw new HttpError(401, "invalid_credentials", "Identifiant ou mot de passe incorrect.");
      }

      // Contrôlé après le mot de passe : on ne révèle pas l'état du compte à qui ne le connaît pas.
      if (!user.actif) throw new HttpError(403, "account_disabled", "Ce compte est désactivé.");

      const [updated] = await db
        .update(utilisateurs)
        .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: now })
        .where(eq(utilisateurs.id, user.id))
        .returning();
      const response = await issueSession(req, reply, updated!);
      await audit(db, { action: "auth.login", actorId: user.id, ip: req.ip });
      return response;
    },
  );

  app.post("/refresh", async (req, reply) => {
    const token = req.cookies[REFRESH_COOKIE];
    if (!token) throw unauthorized("Session absente.");
    const now = ctx.now();
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, hashRefreshToken(token)));
    if (!session) {
      clearRefreshCookie(reply);
      throw unauthorized("Session inconnue.");
    }

    // Rotation : l'ancien jeton est marqué « remplacé » de façon atomique (une seule requête concurrente gagne).
    const nextSessionId = randomUUID();
    const [rotated] = session.revokedAt
      ? []
      : await db
          .update(sessions)
          .set({ revokedAt: now, replacedById: nextSessionId })
          .where(and(eq(sessions.id, session.id), isNull(sessions.revokedAt)))
          .returning({ id: sessions.id });

    if (!rotated) {
      // Jeton déjà utilisé. Juste après une rotation (deux onglets qui rafraîchissent en même temps),
      // on tolère ; au-delà, c'est probablement un jeton volé : toute la famille est révoquée.
      const [current] = await db.select().from(sessions).where(eq(sessions.id, session.id));
      const revokedAt = current?.revokedAt;
      const withinGrace =
        current?.replacedById != null &&
        revokedAt != null &&
        now.getTime() - revokedAt.getTime() <= config.refreshReuseGraceSeconds * 1000;
      if (!withinGrace) {
        await revokeFamily(session.familyId);
        if (current?.replacedById != null) {
          await audit(db, {
            action: "auth.refresh_reuse",
            actorId: session.userId,
            targetType: "session",
            targetId: session.familyId,
            ip: req.ip,
          });
        }
        clearRefreshCookie(reply);
        throw unauthorized("Session révoquée.");
      }
    }

    if (session.expiresAt <= now) {
      clearRefreshCookie(reply);
      throw unauthorized("Session expirée.");
    }

    const user = await findUserById(db, session.userId);
    if (!user || !user.actif) {
      await revokeFamily(session.familyId);
      clearRefreshCookie(reply);
      throw new HttpError(401, "account_disabled", "Ce compte est désactivé.");
    }

    return issueSession(req, reply, user, session.familyId, rotated ? nextSessionId : randomUUID());
  });

  app.post("/logout", async (req, reply) => {
    const token = req.cookies[REFRESH_COOKIE];
    if (token) {
      const [session] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.tokenHash, hashRefreshToken(token)));
      if (session) {
        await revokeFamily(session.familyId);
        await audit(db, { action: "auth.logout", actorId: session.userId, ip: req.ip });
      }
    }
    clearRefreshCookie(reply);
    return reply.status(204).send();
  });

  app.get("/me", { preHandler: requireAuth({ allowPendingPasswordChange: true }) }, async (req) =>
    toAuthUser(currentUser(req)),
  );

  app.post(
    "/change-password",
    {
      preHandler: requireAuth({ allowPendingPasswordChange: true }),
      config: { rateLimit: { max: config.loginRateLimitPerMinute, timeWindow: "1 minute" } },
    },
    async (req) => {
      const user = currentUser(req);
      const { currentPassword, newPassword } = changePasswordRequestSchema.parse(req.body);
      if (!(await verifyPassword(user.passwordHash, currentPassword))) {
        throw new HttpError(400, "invalid_credentials", "Mot de passe actuel incorrect.");
      }
      const now = ctx.now();
      const [updated] = await db
        .update(utilisateurs)
        .set({
          passwordHash: await hashPassword(newPassword),
          mustChangePassword: false,
          passwordChangedAt: now,
          updatedAt: now,
        })
        .where(eq(utilisateurs.id, user.id))
        .returning();
      // Les autres appareils doivent se reconnecter ; la session courante est conservée.
      await revokeUserSessions(db, user.id, now, { exceptFamilyId: req.sessionFamilyId ?? undefined });
      await audit(db, { action: "auth.password_changed", actorId: user.id, ip: req.ip });
      return toAuthUser(updated!);
    },
  );
}
