import { Link } from "react-router";
import { SyncStatus } from "../components/SyncStatus";
import { Alert, Card, Loading, PageHeader } from "../components/ui";
import { useUser } from "../lib/auth";
import { useLive } from "../offline/live";
import { useDb } from "../offline/SyncProvider";

/** Accueil de la tablette : état hors ligne, affaires affectées et leurs PV (données locales). */
export function HomePage() {
  const user = useUser();
  const db = useDb();
  const affaires = useLive(() => db.affaires.toArray(), [db]);
  const pvs = useLive(() => db.pvs.toArray(), [db]);

  return (
    <>
      <PageHeader
        title="Mes affaires"
        subtitle={user.role === "admin" ? "Toutes les affaires actives." : "Les affaires qui vous sont affectées."}
      />
      <div className="space-y-6">
        <SyncStatus />
        {affaires === undefined ? (
          <Loading />
        ) : affaires.length === 0 ? (
          <Alert kind="info">
            Aucune affaire sur cette tablette. Synchronisez avec le réseau pour récupérer vos affaires.
          </Alert>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {[...affaires]
              .sort((a, b) => a.affaire.numero.localeCompare(b.affaire.numero))
              .map(({ affaire: a, equipements }) => {
                const siens = (pvs ?? []).filter((p) => p.affaireId === a.id);
                const aFaire = siens.filter(
                  (p) => (p.statut === "prepare" || p.statut === "brouillon") && !p.clotAilleurs,
                ).length;
                const enAttente = siens.filter((p) => p.statut === "signe").length;
                return (
                  <li key={a.id}>
                    <Link
                      to={`/affaires/${a.id}`}
                      className="block h-full rounded-xl focus-visible:outline-3 focus-visible:outline-brand-500"
                    >
                      <Card className="h-full hover:border-brand-500">
                        <p className="text-sm font-semibold uppercase tracking-wide text-brand-700">{a.numero}</p>
                        <h2 className="mt-1 text-xl font-bold">{a.projet}</h2>
                        <p className="mt-1 text-slate-700">
                          {a.client}
                          {a.site && ` — ${a.site}`}
                        </p>
                        <p className="mt-3 text-slate-700">
                          {equipements.length} équipement(s) — <strong>{aFaire}</strong> PV à compléter
                          {enAttente > 0 && `, ${enAttente} signé(s) en attente d'envoi`}
                        </p>
                      </Card>
                    </Link>
                  </li>
                );
              })}
          </ul>
        )}
      </div>
    </>
  );
}
