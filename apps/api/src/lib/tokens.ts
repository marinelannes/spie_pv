import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

const ISSUER = "spie-pv";
const AUDIENCE = "spie-pv-api";

export interface AccessTokenClaims {
  /** Identifiant de l'utilisateur. */
  sub: string;
  /** Famille de session (connexion initiale), pour révoquer les autres sessions au changement de mot de passe. */
  sid: string;
}

export class AccessTokens {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly ttlSeconds: number,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  get expiresIn(): number {
    return this.ttlSeconds;
  }

  sign(claims: AccessTokenClaims, now: Date): Promise<string> {
    const iat = Math.floor(now.getTime() / 1000);
    return new SignJWT({ sid: claims.sid })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(claims.sub)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(iat)
      .setExpirationTime(iat + this.ttlSeconds)
      .sign(this.key);
  }

  /** Renvoie null si le jeton est invalide ou expiré. */
  async verify(token: string, now: Date): Promise<AccessTokenClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ["HS256"],
        currentDate: now,
      });
      if (typeof payload.sub !== "string" || typeof payload.sid !== "string") return null;
      return { sub: payload.sub, sid: payload.sid };
    } catch {
      return null;
    }
  }
}

/** Jeton de rafraîchissement opaque (256 bits). Seule son empreinte est stockée en base. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
