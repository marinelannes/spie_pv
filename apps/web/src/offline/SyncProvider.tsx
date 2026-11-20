import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "../lib/auth";
import { baseUtilisateur, type UserDb } from "./db";
import { SyncEngine, installerDeclencheurs, type SyncResult } from "./sync";

interface SyncContextValue {
  db: UserDb;
  /** null en mode hors ligne sans session : la synchronisation attend une reconnexion. */
  engine: SyncEngine | null;
  enCours: boolean;
  dernier: SyncResult | null;
  synchroniser(): Promise<SyncResult | null>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

/** Base locale et synchronisation de l'utilisateur courant (à placer sous RequireAuth). */
export function SyncProvider({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const user = state.user!;
  const enLigne = state.status === "authenticated" && !state.user.mustChangePassword;
  const db = useMemo(() => baseUtilisateur(user.id), [user.id]);
  const engine = useMemo(() => (enLigne ? new SyncEngine({ db }) : null), [db, enLigne]);
  const [enCours, setEnCours] = useState(false);
  const [dernier, setDernier] = useState<SyncResult | null>(null);

  const synchroniser = useCallback(async () => {
    if (!engine) return null;
    setEnCours(true);
    try {
      const r = await engine.synchroniser();
      setDernier(r);
      return r;
    } finally {
      setEnCours(false);
    }
  }, [engine]);

  useEffect(() => {
    if (!engine) return;
    return installerDeclencheurs({ synchroniser });
  }, [engine, synchroniser]);

  const value = useMemo(
    () => ({ db, engine, enCours, dernier, synchroniser }),
    [db, engine, enCours, dernier, synchroniser],
  );
  return <SyncContext value={value}>{children}</SyncContext>;
}

export function useSync(): SyncContextValue {
  const ctx = use(SyncContext);
  if (!ctx) throw new Error("useSync hors de SyncProvider");
  return ctx;
}

export function useDb(): UserDb {
  return useSync().db;
}
