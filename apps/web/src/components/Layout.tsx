import { ROLE_LABELS, canUseBackOffice, type Role } from "@spie/shared";
import { Link, NavLink, Navigate, Outlet, useLocation } from "react-router";
import { useAuth, useUser } from "../lib/auth";
import { useOnline } from "../lib/online";
import { useLive } from "../offline/live";
import { SyncProvider, useDb } from "../offline/SyncProvider";
import { useDepotsEnErreur } from "../pages/admin/DepotsPage";
import { LogoSpie } from "./LogoSpie";
import { Alert, Button, Loading } from "./ui";

/**
 * Garde : session requise, mot de passe provisoire changé, et rôle si précisé. Serveur injoignable au démarrage :
 * le dernier utilisateur connecté garde l'accès aux écrans de saisie (spec §7.2), pas au back-office.
 */
export function RequireAuth({ roles }: { roles?: Role[] }) {
  const { state, retry } = useAuth();
  const location = useLocation();

  if (state.status === "loading") return <Loading label="Ouverture de la session…" />;
  if (state.status === "offline") {
    if (!state.user) {
      return (
        <main className="mx-auto max-w-lg p-6">
          <Alert kind="warning">
            <p className="font-semibold">Serveur injoignable</p>
            <p className="mt-1">
              Vérifiez la connexion réseau puis réessayez. Une première connexion en ligne est nécessaire sur cette
              tablette.
            </p>
            <Button className="mt-3" onClick={retry}>
              Réessayer
            </Button>
          </Alert>
        </main>
      );
    }
    if (roles) {
      return (
        <Alert kind="warning">
          <p className="font-semibold">Indisponible hors ligne</p>
          <p className="mt-1">
            Le back-office nécessite le réseau. La saisie des PV reste disponible depuis « Mes affaires ».
          </p>
          <Button className="mt-3" variant="secondary" onClick={retry}>
            Se reconnecter
          </Button>
        </Alert>
      );
    }
    return <Outlet />;
  }
  if (state.status === "anonymous") return <Navigate to="/connexion" replace state={{ from: location.pathname }} />;
  if (state.user.mustChangePassword && location.pathname !== "/mot-de-passe") {
    return <Navigate to="/mot-de-passe" replace />;
  }
  if (roles && !roles.includes(state.user.role)) return <Navigate to="/" replace />;
  return <Outlet />;
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-12 items-center gap-2 rounded-lg px-3 font-semibold ${
    isActive ? "bg-white text-brand-800" : "text-white hover:bg-brand-800"
  }`;

function BadgeDepots() {
  const { state } = useAuth();
  const depots = useDepotsEnErreur(state.status === "authenticated");
  const n = depots.data?.length ?? 0;
  if (n === 0) return null;
  return (
    <span className="rounded-full bg-red-600 px-2 text-sm text-white" aria-label={`${n} dépôt(s) en erreur`}>
      {n}
    </span>
  );
}

export function Layout() {
  return (
    <SyncProvider>
      <Cadre />
    </SyncProvider>
  );
}

function Cadre() {
  const user = useUser();
  const { state, logout, retry } = useAuth();
  const online = useOnline();
  const isAdmin = user.role === "admin";
  const sessionHorsLigne = state.status === "offline";
  const db = useDb();
  const enAttente = useLive(() => db.outbox.count(), [db]) ?? 0;
  const deconnecter = () => {
    if (
      enAttente > 0 &&
      !window.confirm(
        `${enAttente} PV signé(s) n'ont pas encore été envoyés. Ils restent sur la tablette et partiront à votre prochaine connexion. Se déconnecter ?`,
      )
    ) {
      return;
    }
    void logout();
  };

  return (
    <div className="min-h-dvh">
      <header className="bg-brand-700 text-white">
        {/* Plus large que le contenu : la barre complète de l'administrateur tient sur une ligne dès 1280 px. */}
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
          <Link to="/" className="flex min-h-12 items-center gap-3 text-lg font-bold" aria-label="PV SPIE — accueil">
            <LogoSpie cartouche className="h-6" /> PV
          </Link>
          {!user.mustChangePassword && (
            <nav className="flex flex-wrap gap-1" aria-label="Navigation principale">
              <NavLink to="/" end className={navClass}>
                Mes affaires
              </NavLink>
              {canUseBackOffice(user.role) && !sessionHorsLigne && (
                <>
                  <NavLink to="/preparation" className={navClass}>
                    Préparation
                  </NavLink>
                  <NavLink to="/suivi" className={navClass}>
                    Suivi
                  </NavLink>
                  <NavLink to="/reserves" className={navClass}>
                    Réserves
                  </NavLink>
                </>
              )}
              {isAdmin && !sessionHorsLigne && (
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
                  <NavLink to="/admin/depots" className={navClass}>
                    Dépôts <BadgeDepots />
                  </NavLink>
                  <NavLink to="/admin/journal" className={navClass}>
                    Journal
                  </NavLink>
                </>
              )}
            </nav>
          )}
          <div className="ml-auto flex items-center gap-3">
            {(!online || sessionHorsLigne) && (
              <span className="rounded-full bg-amber-300 px-3 py-1 text-sm font-bold text-amber-950">Hors ligne</span>
            )}
            <div className="text-right text-sm leading-tight">
              <div className="font-semibold">{user.nom}</div>
              <div className="text-brand-100">{ROLE_LABELS[user.role]}</div>
            </div>
            {sessionHorsLigne ? (
              <Button variant="ghost" className="text-white hover:bg-brand-800" onClick={retry}>
                Se reconnecter
              </Button>
            ) : (
              <Button variant="ghost" className="text-white hover:bg-brand-800" onClick={deconnecter}>
                Déconnexion
              </Button>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
