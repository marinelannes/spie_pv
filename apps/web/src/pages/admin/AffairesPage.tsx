import type { AffaireListItemDto } from "@spie/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { Alert, Badge, Loading, PageHeader, Select, Table, Td } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";

type Filtre = "non" | "oui" | "toutes";

export function AffairesPage() {
  const [archivees, setArchivees] = useState<Filtre>("non");
  const affaires = useQuery({
    queryKey: ["admin", "affaires", archivees],
    queryFn: () => api<AffaireListItemDto[]>(`/api/admin/affaires?archivees=${archivees}`),
  });

  return (
    <>
      <PageHeader
        title="Affaires"
        subtitle="Numéro, client, dossier SharePoint cible et techniciens affectés."
        actions={
          <Link
            to="/admin/affaires/nouvelle"
            className="inline-flex min-h-12 items-center rounded-lg bg-brand-700 px-5 font-semibold text-white hover:bg-brand-800"
          >
            Nouvelle affaire
          </Link>
        }
      />
      <div className="mb-4 max-w-xs">
        <Select
          value={archivees}
          onChange={(e) => setArchivees(e.target.value as Filtre)}
          aria-label="Filtre d'archivage"
        >
          <option value="non">Affaires actives</option>
          <option value="oui">Affaires archivées</option>
          <option value="toutes">Toutes les affaires</option>
        </Select>
      </div>
      {affaires.isPending ? (
        <Loading />
      ) : affaires.isError ? (
        <Alert kind="error">{errorMessage(affaires.error)}</Alert>
      ) : affaires.data.length === 0 ? (
        <Alert kind="info">Aucune affaire.</Alert>
      ) : (
        <Table head={["N° affaire", "Projet", "Client / site", "Dossier SharePoint", "Affectés"]}>
          {affaires.data.map((a) => (
            <tr key={a.id} className="hover:bg-slate-50">
              <Td>
                <Link
                  to={`/admin/affaires/${a.id}`}
                  className="font-semibold text-brand-700 underline-offset-4 hover:underline"
                >
                  {a.numero}
                </Link>
                {a.archivee && (
                  <div className="mt-1">
                    <Badge>Archivée</Badge>
                  </div>
                )}
              </Td>
              <Td>{a.projet}</Td>
              <Td>
                {a.client}
                {a.site && <div className="text-sm text-slate-600">{a.site}</div>}
              </Td>
              <Td className="text-sm">
                {a.dossierSharePoint ? a.dossierSharePoint.path : <Badge tone="amber">Non défini</Badge>}
              </Td>
              <Td>{a.nbAffectes}</Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
