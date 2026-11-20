import { TYPE_ES_COURTS, type ListeEsDetailDto } from "@spie/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { Alert, Badge, Card, Loading, PageHeader, Table, Td } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { RapportAnomalies } from "./IoImportPage";

/**
 * Une version de la liste E/S (spec §4.6) : fichier source, rapport d'anomalies de son import, et contenu
 * (feuilles et E/S), consultable même après des imports plus récents.
 */
export function IoListePage() {
  const { listeId = "" } = useParams();
  const liste = useQuery({
    queryKey: ["prep", "io-list", listeId],
    queryFn: () => api<ListeEsDetailDto & { affaireId: string }>(`/api/prep/io-lists/${listeId}`),
  });
  if (liste.isPending) return <Loading />;
  if (liste.isError) return <Alert kind="error">{errorMessage(liste.error)}</Alert>;
  const l = liste.data;
  return (
    <>
      <PageHeader
        title={`Liste E/S — version ${l.version}`}
        subtitle={
          <Link to={`/preparation/affaires/${l.affaireId}`} className="underline">
            Retour à l'affaire
          </Link>
        }
      />
      <div className="space-y-6">
        <Card>
          <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[max-content_1fr]">
            <dt className="text-slate-600">Fichier</dt>
            <dd className="break-all">{l.fichierSource}</dd>
            <dt className="text-slate-600">Référence</dt>
            <dd>
              {l.referenceDocument || "—"} rév. {l.revision || "—"}
            </dd>
            <dt className="text-slate-600">Importée</dt>
            <dd>
              {formatDateTime(l.importeLe)}
              {l.importePar && ` par ${l.importePar}`}
            </dd>
            <dt className="text-slate-600">Contenu</dt>
            <dd>
              {l.nbFeuilles} feuille(s), {l.nbPoints} E/S
            </dd>
          </dl>
        </Card>
        <section>
          <h2 className="mb-3 text-xl font-bold">Rapport d'anomalies de l'import</h2>
          <RapportAnomalies anomalies={l.anomalies} />
        </section>
        <section>
          <h2 className="mb-3 text-xl font-bold">Feuilles d'E/S</h2>
          <div className="space-y-3">
            {l.feuilles.map((f) => (
              <Feuille key={f.id} feuille={f} />
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

function Feuille({ feuille: f }: { feuille: ListeEsDetailDto["feuilles"][number] }) {
  const [ouverte, setOuverte] = useState(false);
  const reserves = f.points.filter((p) => p.reserve).length;
  return (
    <Card>
      <button
        type="button"
        aria-expanded={ouverte}
        onClick={() => setOuverte((o) => !o)}
        className="flex min-h-12 w-full flex-wrap items-center justify-between gap-2 text-left"
      >
        <span>
          <span className="text-lg font-bold">{f.nom}</span>
          {f.titre && <span className="block text-sm text-slate-600">{f.titre}</span>}
        </span>
        <span className="flex flex-wrap items-center gap-2 text-sm">
          {f.points.length} E/S
          {reserves > 0 && <Badge tone="neutral">{reserves} réserve(s)</Badge>}
          {f.groupesTag.length > 1 && <Badge tone="blue">{f.groupesTag.length} groupes TAG</Badge>}
          <span className="font-semibold text-brand-800">{ouverte ? "Masquer" : "Voir les E/S"}</span>
        </span>
      </button>
      {ouverte && (
        <div className="mt-3">
          <Table head={["Carte", "TAG", "Adresse", "Type", "Désignation"]}>
            {f.points.map((p) => (
              <tr key={p.id} className={p.reserve ? "text-slate-500" : undefined}>
                <Td className="text-sm">{p.carte}</Td>
                <Td className="text-sm">{p.tag}</Td>
                <Td className="font-mono">{p.adresse}</Td>
                <Td className="text-sm">{TYPE_ES_COURTS[p.type]}</Td>
                <Td className="text-sm">
                  {p.designation}
                  {p.reserve && <span className="ml-2 rounded bg-slate-200 px-2 text-xs">Réserve</span>}
                </Td>
              </tr>
            ))}
          </Table>
        </div>
      )}
    </Card>
  );
}
