import type { AuthUser, LoginRequest, SessionResponse } from "@spie/shared";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, onSessionChange, refreshSession, setSession } from "./api";
import { clearLastUser, loadLastUser, saveLastUser } from "./last-user";

/**
 * `offline` : serveur injoignable au démarrage. Si un utilisateur s'est déjà connecté sur ce poste, l'application
 * reste utilisable pour la saisie (spec §7.2) avec ses données locales, même si ses jetons ont expiré.
 */
export type AuthState =
  | { status: "loading"; user: null }
  | { status: "anonymous"; user: null }
  | { status: "offline"; user: AuthUser | null }
  | { status: "authenticated"; user: AuthUser };

interface AuthContextValue {
  state: AuthState;
  login(input: LoginRequest): Promise<AuthUser>;
  logout(): Promise<void>;
  /** Après un changement de mot de passe. */
  updateUser(user: AuthUser): void;
  retry(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** État à adopter quand la restauration de session échoue faute de réseau. */
export function offlineState(): AuthState {
  const user = loadLastUser();
  // Un compte qui doit encore changer son mot de passe provisoire n'a jamais eu de session complète.
  return { status: "offline", user: user && !user.mustChangePassword ? user : null };
}

/**
 * Mode hors ligne : la session est retentée sans intervention au retour du réseau (événement `online`) et
 * périodiquement, pour que les PV signés partent d'eux-mêmes (spec §3.3, §6.3). Un échec réseau laisse le mode
 * hors ligne en place ; un succès rétablit la session ; une session expirée renvoie vers la connexion, sans perte.
 */
export function installerReconnexionAuto(
  retenter: () => Promise<unknown>,
  opts: { intervalleMs?: number; win?: Pick<Window, "addEventListener" | "removeEventListener"> } = {},
): () => void {
  const win = opts.win ?? window;
  let enCours = false;
  const lancer = () => {
    if (enCours) return;
    enCours = true;
    void retenter()
      .catch(() => undefined)
      .finally(() => {
        enCours = false;
      });
  };
  win.addEventListener("online", lancer);
  const timer = setInterval(lancer, opts.intervalleMs ?? 60_000);
  return () => {
    win.removeEventListener("online", lancer);
    clearInterval(timer);
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading", user: null });
  const queryClient = useQueryClient();

  const restore = useCallback(() => {
    setState({ status: "loading", user: null });
    refreshSession().catch(() => setState(offlineState()));
  }, []);

  // Hors ligne : reconnexion automatique dès que le serveur répond (sans repasser par l'écran de chargement).
  const horsLigne = state.status === "offline";
  useEffect(() => {
    if (!horsLigne) return;
    return installerReconnexionAuto(() => refreshSession());
  }, [horsLigne]);

  const cacheOwner = useRef<string | null>(null);

  useEffect(() => {
    const unsubscribe = onSessionChange((s: SessionResponse | null) => {
      // Les données en cache appartiennent à un utilisateur : on les vide dès qu'il change ou que la session
      // se termine, quelle qu'en soit la cause (déconnexion, expiration, compte désactivé). Tablettes partagées.
      const owner = s?.user.id ?? null;
      if (owner !== cacheOwner.current) {
        queryClient.clear();
        cacheOwner.current = owner;
      }
      if (s) saveLastUser(s.user);
      setState(s ? { status: "authenticated", user: s.user } : { status: "anonymous", user: null });
    });
    // Au démarrage, la session est restaurée depuis le cookie de rafraîchissement.
    restore();
    return unsubscribe;
  }, [restore, queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      async login(input) {
        const session = await api<SessionResponse>("/api/auth/login", { method: "POST", body: input });
        setSession(session);
        return session.user;
      },
      async logout() {
        await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
        // Déconnexion volontaire : plus de mode hors ligne pour ce compte sur ce poste. Les données locales
        // (PV en cours ou signés non envoyés) restent dans sa base et réapparaissent à la prochaine connexion.
        clearLastUser();
        setSession(null); // vide aussi le cache (écouteur de session)
      },
      updateUser(user) {
        saveLastUser(user);
        setState({ status: "authenticated", user });
      },
      retry: restore,
    }),
    [state, restore],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const ctx = use(AuthContext);
  if (!ctx) throw new Error("useAuth hors de AuthProvider");
  return ctx;
}

/** Utilisateur connecté, ou dernier utilisateur en mode hors ligne (à utiliser sous RequireAuth). */
export function useUser(): AuthUser {
  const { state } = useAuth();
  if (state.status === "authenticated" || (state.status === "offline" && state.user)) return state.user!;
  throw new Error("useUser sans utilisateur connecté");
}

/** Mode hors ligne sans session (jetons inutilisables) : l'envoi et le back-office sont indisponibles. */
export function useSessionHorsLigne(): boolean {
  return useAuth().state.status === "offline";
}
