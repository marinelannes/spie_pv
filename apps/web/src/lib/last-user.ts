import { authUserSchema, type AuthUser } from "@spie/shared";

/**
 * Dernier utilisateur connecté sur ce poste. Hors ligne, l'application reste utilisable même si les jetons ont expiré
 * (spec §7.2) : on rouvre alors la base locale de cet utilisateur. Effacé à la déconnexion volontaire.
 */
const KEY = "spie-pv:dernier-utilisateur";

export function saveLastUser(user: AuthUser): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(user));
  } catch {
    // stockage indisponible (navigation privée) : pas de mode hors ligne sans session
  }
}

export function loadLastUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = authUserSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function clearLastUser(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignoré
  }
}
