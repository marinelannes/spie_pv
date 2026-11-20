import { CRITICITES, CRITICITE_LABELS, type AffaireDto, type ReserveSuiviDto, type ReservesQuery } from "@spie/shared";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { Alert, Badge, Loading, PageHeader, Select, Table, Td } from "../../components/ui";
import { api, errorMessage, queryString } from "../../lib/api";
import { formatDateIso } from "../../lib/format";

/** Compteurs de l'en-tête : réserves ouvertes, dont en retard et bloquantes, et réserves levées. */
export function compterReserves(reserves: readonly ReserveSuiviDto[]) {
  const ouvertes = reserves.filter((r) => r.statut === "ouverte");
  return {
    ouvertes: ouvertes.length,
    enRetard: ouvertes.filter((r) => r.enRetard).length,
    bloquantes: ouvertes.filter((r) => r.criticite === "bloquante").length,
    levees: reserves.length - ouvertes.length,
  };
}

/**
 * Suivi des réserves (spec §4.3, lot 2) : état des réserves à la dernière révision signée de chaque PV. Une réserve
 * se lève sur site, dans la révision suivante du PV ; la levée apparaît ici une fois cette révision signée et reçue.
 */
export function ReservesPage() {
  const [params, setParams] = useSearchParams();
  const filtres: ReservesQuery = {
    affaireId: params.get("affaireId") ?? undefined,
    statut: (params.get("statut") as ReservesQuery["statut"] | null) ?? undefined,
    criticite: (params.get("criticite") as ReservesQuery["criticite"] | null) ?? undefined,
  };
  const setFiltre = (k: keyof ReservesQuery, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n, { replace: true });
  };
  const affaires = useQuery({ queryKey: ["prep", "affaires"], queryFn: () => api<AffaireDto[]>("/api/prep/affaires") });
  const reserves = useQuery({
    queryKey: ["prep", "reserves", filtres],
    queryFn: () => api<ReserveSuiviDto[]>(`/api/prep/reserves${queryString({ ...filtres })}`),
  });
  const n = compterReserves(reserves.data ?? []);

  return (
    <>
      <PageHeader
        title="Suivi des réserves"
        subtitle="État à la dernière révision signée de chaque PV. Une réserve se lève sur site, dans la révision suivante."
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Select
          aria-label="Affaire"
          value={filtres.affaireId ?? ""}
          onChange={(e) => setFiltre("affaireId", e.target.value)}
        >
          <option value="">Toutes les affaires</option>
          {affaires.data?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.numero} — {a.projet}
            </option>
          ))}
        </Select>
        <Select aria-label="Statut" value={filtres.statut ?? ""} onChange={(e) => setFiltre("statut", e.target.value)}>
          <option value="">Ouvertes et levées</option>
          <option value="ouverte">Ouvertes</option>
          <option value="levee">Levées</option>
        </Select>
        <Select
          aria-label="Criticité"
          value={filtres.criticite ?? ""}
          onChange={(e) => setFiltre("criticite", e.target.value)}
        >
          <option value="">Toutes les criticités</option>
          {CRITICITES.map((c) => (
            <option key={c} value={c}>
              {CRITICITE_LABELS[c]}
            </option>
          ))}
          <option value="aucune">Sans criticité</option>
        </Select>
      </div>
      {reserves.isPending ? (
        <Loading />
      ) : reserves.isError ? (
        <Alert kind="error">{errorMessage(reserves.error)}</Alert>
      ) : reserves.data.length === 0 ? (
        <Alert kind="info">Aucune réserve ne correspond.</Alert>
      ) : (
        <>
          <p className="mb-3 flex flex-wrap items-center gap-2" data-testid="recap-reserves">
            <Badge tone={n.ouvertes > 0 ? "amber" : "neutral"}>{n.ouvertes} ouverte(s)</Badge>
            {n.enRetard > 0 && <Badge tone="red">{n.enRetard} en retard</Badge>}
            {n.bloquantes > 0 && <Badge tone="red">{n.bloquantes} bloquante(s)</Badge>}
            <Badge tone="green">{n.levees} levée(s)</Badge>
          </p>
          <Table head={["PV", "N°", "Contrôle et description", "Criticité", "Responsable", "Levée prévue", "Statut"]}>
            {reserves.data.map((r) => (
              <tr key={r.id} className="align-top hover:bg-slate-50">
                <Td>
                  <Link
                    to={`/preparation/pv/${r.pvId}`}
                    className="font-mono font-bold text-brand-700 underline-offset-4 hover:underline"
                  >
                    {r.numeroPv}
                  </Link>
                  <div className="text-sm text-slate-600">
                    {r.affaireNumero} · {r.equipementTag ?? "—"} · ind. {r.indicePv}
                  </div>
                  {r.revisionEnCours && (
                    <div className="mt-1">
                      <Badge tone="blue">Révision {r.revisionEnCours} en cours</Badge>
                    </div>
                  )}
                </Td>
                <Td className="font-bold">{r.numero}</Td>
                <Td>
                  <div className="font-semibold">{r.controle || "—"}</div>
                  <div className="whitespace-pre-line text-sm text-slate-700">{r.description}</div>
                  <div className="text-sm text-slate-500">créée à l'indice {r.indiceCreation}</div>
                </Td>
                <Td>
                  {r.criticite ? (
                    <Badge tone={r.criticite === "bloquante" ? "red" : "neutral"}>
                      {CRITICITE_LABELS[r.criticite]}
                    </Badge>
                  ) : (
                    "—"
                  )}
                </Td>
                <Td className="text-sm">{r.responsable || "—"}</Td>
                <Td className="text-sm">
                  {r.datePrevue ? formatDateIso(r.datePrevue) : "—"}
                  {r.enRetard && (
                    <div className="mt-1">
                      <Badge tone="red">En retard</Badge>
                    </div>
                  )}
                </Td>
                <Td>
                  {r.statut === "ouverte" ? (
                    <Badge tone="amber">Ouverte</Badge>
                  ) : (
                    <>
                      <Badge tone="green">Levée</Badge>
                      {r.levee && (
                        <div className="mt-1 text-sm text-slate-700">
                          le {formatDateIso(r.levee.date) || "—"}, indice {r.levee.indice}
                          {r.levee.commentaire && <div className="text-slate-600">{r.levee.commentaire}</div>}
                        </div>
                      )}
                    </>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </>
  );
}
