import type { AuthUser, LoginRequest, SessionResponse } from "@spie/shared";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, onSessionChange, refreshSession, setSession } from "./api";

type AuthState =
  | { status: "loading"; user: null }
  | { status: "anonymous"; user: null }
  | { status: "offline"; user: null }
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading", user: null });
  const queryClient = useQueryClient();

  const restore = useCallback(() => {
    setState({ status: "loading", user: null });
    refreshSession().catch(() => setState({ status: "offline", user: null }));
  }, []);

  useEffect(() => {
    const unsubscribe = onSessionChange((s: SessionResponse | null) =>
      setState(s ? { status: "authenticated", user: s.user } : { status: "anonymous", user: null }),
    );
    // Au démarrage, la session est restaurée depuis le cookie de rafraîchissement.
    restore();
    return unsubscribe;
  }, [restore]);

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
        setSession(null);
        queryClient.clear();
      },
      updateUser(user) {
        setState({ status: "authenticated", user });
      },
      retry: restore,
    }),
    [state, queryClient, restore],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const ctx = use(AuthContext);
  if (!ctx) throw new Error("useAuth hors de AuthProvider");
  return ctx;
}

/** Utilisateur connecté (à utiliser sous RequireAuth). */
export function useUser(): AuthUser {
  const { state } = useAuth();
  if (state.status !== "authenticated") throw new Error("useUser sans utilisateur connecté");
  return state.user;
}
