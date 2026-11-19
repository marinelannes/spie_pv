import type { AffaireDto } from "@spie/shared";
import { useQuery } from "@tanstack/react-query";
import { Alert, Card, Loading, PageHeader } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { useUser } from "../lib/auth";

/** Accueil technicien / préparateur : affaires affectées. La liste des PV arrive avec le modèle relais (lot 1). */
export function HomePage() {
  const user = useUser();
  const affaires = useQuery({ queryKey: ["mes-affaires"], queryFn: () => api<AffaireDto[]>("/api/affaires") });

  return (
    <>
      <PageHeader
        title="Mes affaires"
        subtitle={user.role === "admin" ? "Toutes les affaires actives." : "Les affaires qui vous sont affectées."}
      />
      {affaires.isPending ? (
        <Loading />
      ) : affaires.isError ? (
        <Alert kind="error">{errorMessage(affaires.error)}</Alert>
      ) : affaires.data.length === 0 ? (
        <Alert kind="info">Aucune affaire ne vous est affectée pour le moment.</Alert>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {affaires.data.map((a) => (
            <li key={a.id}>
              <Card className="h-full">
                <p className="text-sm font-semibold uppercase tracking-wide text-brand-700">{a.numero}</p>
                <h2 className="mt-1 text-xl font-bold">{a.projet}</h2>
                <p className="mt-1 text-slate-700">
                  {a.client}
                  {a.site && ` — ${a.site}`}
                </p>
                <p className="mt-3 text-sm text-slate-500">Les PV de cette affaire apparaîtront ici.</p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
