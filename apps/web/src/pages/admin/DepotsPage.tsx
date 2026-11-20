import { STATUT_DEPOT_LABELS, type DepotSuiviDto, type StatutDepot } from "@spie/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { Alert, Badge, Button, Loading, PageHeader, Select, Table, Td } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { lienSharePoint } from "../../lib/sharepoint";

export const depotsQueryKey = (statut: StatutDepot) => ["admin", "depots", statut] as const;

export function useDepotsEnErreur(enabled: boolean) {
  return useQuery({
    queryKey: depotsQueryKey("erreur"),
    queryFn: () => api<DepotSuiviDto[]>("/api/admin/depots?statut=erreur"),
    enabled,
    refetchInterval: 60_000,
  });
}

/** Dépôts SharePoint (spec §3.3, §5.4) : alertes sur les dépôts en erreur et relance par l'administrateur. */
export function DepotsPage() {
  const qc = useQueryClient();
  const [statut, setStatut] = useState<StatutDepot>("erreur");
  const depots = useQuery({
    queryKey: depotsQueryKey(statut),
    queryFn: () => api<DepotSuiviDto[]>(`/api/admin/depots?statut=${statut}`),
  });
  const relancer = useMutation({
    mutationFn: (id: string) => api<DepotSuiviDto>(`/api/admin/depots/${id}/retry`, { method: "POST" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "depots"] }),
  });

  return (
    <>
      <PageHeader
        title="Dépôts SharePoint"
        subtitle="Reprises automatiques à 1 min, 5 min, 30 min, 2 h et 6 h, puis erreur : corrigez la cause et relancez."
      />
      <div className="mb-4 max-w-xs">
        <Select
          aria-label="Statut des dépôts"
          value={statut}
          onChange={(e) => setStatut(e.target.value as StatutDepot)}
        >
          {(["erreur", "en_attente", "depose"] as const).map((s) => (
            <option key={s} value={s}>
              {STATUT_DEPOT_LABELS[s]}
            </option>
          ))}
        </Select>
      </div>
      {relancer.isError && (
        <div className="mb-4">
          <Alert kind="error">{errorMessage(relancer.error)}</Alert>
        </div>
      )}
      {depots.isPending ? (
        <Loading />
      ) : depots.isError ? (
        <Alert kind="error">{errorMessage(depots.error)}</Alert>
      ) : depots.data.length === 0 ? (
        <Alert kind={statut === "erreur" ? "success" : "info"}>
          {statut === "erreur" ? "Aucun dépôt en erreur." : "Aucun dépôt."}
        </Alert>
      ) : (
        <Table head={["PV", "Fichier", "Statut", "Tentatives", "Dernière erreur", ""]}>
          {depots.data.map((d) => (
            <tr key={d.id} className="align-top">
              <Td>
                <Link to={`/preparation/pv/${d.pvId}`} className="font-mono font-bold text-brand-700 underline">
                  {d.numero}
                </Link>
                <div className="text-sm text-slate-600">
                  {d.affaireNumero} — {d.equipementTag ?? "—"} — ind. {d.indice}
                </div>
              </Td>
              <Td className="break-all text-sm">
                {d.nom}
                {d.cheminSharePoint &&
                  (lienSharePoint(d.webUrl) && d.statut === "depose" ? (
                    <a
                      href={lienSharePoint(d.webUrl)!}
                      target="_blank"
                      rel="noreferrer"
                      className="block text-brand-800 underline"
                      title="Ouvrir dans SharePoint"
                    >
                      {d.cheminSharePoint}
                    </a>
                  ) : (
                    <div className="text-slate-500">{d.cheminSharePoint}</div>
                  ))}
              </Td>
              <Td>
                <Badge tone={d.statut === "depose" ? "green" : d.statut === "erreur" ? "red" : "amber"}>
                  {STATUT_DEPOT_LABELS[d.statut]}
                </Badge>
                {d.prochaineTentative && (
                  <div className="text-sm text-slate-600">Prochain essai {formatDateTime(d.prochaineTentative)}</div>
                )}
                {d.deposeLe && <div className="text-sm text-slate-600">{formatDateTime(d.deposeLe)}</div>}
              </Td>
              <Td>{d.tentatives}</Td>
              <Td className="text-sm text-red-900">{d.derniereErreur ?? "—"}</Td>
              <Td>
                {d.statut === "erreur" && (
                  <Button
                    variant="secondary"
                    busy={relancer.isPending && relancer.variables === d.id}
                    onClick={() => relancer.mutate(d.id)}
                  >
                    Relancer
                  </Button>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
