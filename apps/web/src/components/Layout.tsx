import { ROLE_LABELS, type Role } from "@spie/shared";
import { useSyncExternalStore } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation } from "react-router";
import { useAuth, useUser } from "../lib/auth";
import { Alert, Button, Loading } from "./ui";

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine);
}

/** Garde : session requise, mot de passe provisoire changé, et rôle si précisé. */
export function RequireAuth({ roles }: { roles?: Role[] }) {
  const { state, retry } = useAuth();
  const location = useLocation();

  if (state.status === "loading") return <Loading label="Ouverture de la session…" />;
  if (state.status === "offline") {
    return (
      <main className="mx-auto max-w-lg p-6">
        <Alert kind="warning">
          <p className="font-semibold">Serveur injoignable</p>
          <p className="mt-1">Vérifiez la connexion réseau puis réessayez.</p>
          <Button className="mt-3" onClick={retry}>
            Réessayer
          </Button>
        </Alert>
      </main>
    );
  }
  if (state.status === "anonymous") return <Navigate to="/connexion" replace state={{ from: location.pathname }} />;
  if (state.user.mustChangePassword && location.pathname !== "/mot-de-passe") {
    return <Navigate to="/mot-de-passe" replace />;
  }
  if (roles && !roles.includes(state.user.role)) return <Navigate to="/" replace />;
  return <Outlet />;
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-12 items-center rounded-lg px-3 font-semibold ${
    isActive ? "bg-white text-brand-800" : "text-white hover:bg-brand-800"
  }`;

export function Layout() {
  const user = useUser();
  const { logout } = useAuth();
  const online = useOnline();
  const isAdmin = user.role === "admin";

  return (
    <div className="min-h-dvh">
      <header className="bg-brand-700 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2">
          <Link to="/" className="flex min-h-12 items-center gap-2 text-lg font-bold">
            <img src="/favicon.svg" alt="" className="size-8" /> PV SPIE
          </Link>
          {!user.mustChangePassword && (
            <nav className="flex flex-wrap gap-1" aria-label="Navigation principale">
              <NavLink to="/" end className={navClass}>
                Mes affaires
              </NavLink>
              {isAdmin && (
                <>
                  <NavLink to="/admin/affaires" className={navClass}>
                    Affaires
                  </NavLink>
                  <NavLink to="/admin/utilisateurs" className={navClass}>
                    Utilisateurs
                  </NavLink>
                  <NavLink to="/admin/sharepoint" className={navClass}>
                    SharePoint
                  </NavLink>
                  <NavLink to="/admin/journal" className={navClass}>
                    Journal
                  </NavLink>
                </>
              )}
            </nav>
          )}
          <div className="ml-auto flex items-center gap-3">
            {!online && (
              <span className="rounded-full bg-amber-300 px-3 py-1 text-sm font-bold text-amber-950">Hors ligne</span>
            )}
            <div className="text-right text-sm leading-tight">
              <div className="font-semibold">{user.nom}</div>
              <div className="text-brand-100">{ROLE_LABELS[user.role]}</div>
            </div>
            <Button variant="ghost" className="text-white hover:bg-brand-800" onClick={() => void logout()}>
              Déconnexion
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
