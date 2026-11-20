import type { AffaireDto } from "@spie/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { Alert, Loading, PageHeader, Table, Td } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";

/** Préparation (spec §3.1, §4.6) : affaires accessibles au préparateur (toutes pour l'administrateur). */
export function PrepAffairesPage() {
  const affaires = useQuery({ queryKey: ["prep", "affaires"], queryFn: () => api<AffaireDto[]>("/api/prep/affaires") });
  return (
    <>
      <PageHeader
        title="Préparation des PV"
        subtitle="Import des listes E/S, équipements, préparation et affectation des PV."
      />
      {affaires.isPending ? (
        <Loading />
      ) : affaires.isError ? (
        <Alert kind="error">{errorMessage(affaires.error)}</Alert>
      ) : affaires.data.length === 0 ? (
        <Alert kind="info">Aucune affaire ne vous est affectée.</Alert>
      ) : (
        <Table head={["N° affaire", "Projet", "Client / site", "Dossier SharePoint"]}>
          {affaires.data.map((a) => (
            <tr key={a.id} className="hover:bg-slate-50">
              <Td>
                <Link
                  to={`/preparation/affaires/${a.id}`}
                  className="font-bold text-brand-700 underline-offset-4 hover:underline"
                >
                  {a.numero}
                </Link>
              </Td>
              <Td>{a.projet}</Td>
              <Td>
                {a.client}
                {a.site && <div className="text-sm text-slate-600">{a.site}</div>}
              </Td>
              <Td className="text-sm">{a.dossierSharePoint?.path ?? "—"}</Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
