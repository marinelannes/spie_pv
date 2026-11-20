import {
  STATUTS_SUIVI,
  STATUT_PV_LABELS,
  type AffaireDto,
  type PrepAffaireDto,
  type PvResumeDto,
  type StatutPv,
} from "@spie/shared";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { Alert, Loading, PageHeader, Select } from "../../components/ui";
import { api, errorMessage, queryString } from "../../lib/api";
import { TablePv } from "./PrepAffairePage";

export interface FiltresSuivi {
  affaireId?: string;
  equipementId?: string;
  statut?: StatutPv;
  technicienId?: string;
}

/** Chaîne de requête de `GET /api/prep/pv` (filtres vides omis). */
export function querySuivi(f: FiltresSuivi): string {
  return queryString({ ...f });
}

/**
 * Choix des filtres équipement et technicien sans affaire sélectionnée : ceux qui figurent dans les PV de toutes les
 * affaires visibles (équipement préfixé par son affaire), sans doublon, triés.
 */
export function optionsSansAffaire(pvs: readonly PvResumeDto[]): {
  equipements: { id: string; label: string }[];
  techniciens: { id: string; nom: string }[];
} {
  const eqs = new Map<string, string>();
  const techs = new Map<string, string>();
  for (const p of pvs) {
    if (p.equipementId) eqs.set(p.equipementId, `${p.affaireNumero} — ${p.equipementTag ?? "?"}`);
    for (const t of p.techniciens) techs.set(t.id, t.nom);
  }
  return {
    equipements: [...eqs].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label, "fr")),
    techniciens: [...techs].map(([id, nom]) => ({ id, nom })).sort((a, b) => a.nom.localeCompare(b.nom, "fr")),
  };
}

/** Suivi des PV (spec §4.6) : liste filtrable par affaire, équipement, statut, technicien. */
export function SuiviPage() {
  const [params, setParams] = useSearchParams();
  const filtres: FiltresSuivi = {
    affaireId: params.get("affaireId") ?? undefined,
    equipementId: params.get("equipementId") ?? undefined,
    statut: (params.get("statut") as StatutPv | null) ?? undefined,
    technicienId: params.get("technicienId") ?? undefined,
  };
  const setFiltre = (k: keyof FiltresSuivi, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    if (k === "affaireId") {
      n.delete("equipementId");
      n.delete("technicienId");
    }
    setParams(n, { replace: true });
  };
  const affaires = useQuery({ queryKey: ["prep", "affaires"], queryFn: () => api<AffaireDto[]>("/api/prep/affaires") });
  const affaire = useQuery({
    queryKey: ["prep", "affaire", filtres.affaireId],
    queryFn: () => api<PrepAffaireDto>(`/api/prep/affaires/${filtres.affaireId}`),
    enabled: Boolean(filtres.affaireId),
  });
  const pvs = useQuery({
    queryKey: ["prep", "pvs", filtres],
    queryFn: () => api<PvResumeDto[]>(`/api/prep/pv${querySuivi(filtres)}`),
  });
  // Sans affaire choisie : les filtres se remplissent avec les PV de toutes les affaires (liste non filtrée).
  const tous = useQuery({
    queryKey: ["prep", "pvs", {}],
    queryFn: () => api<PvResumeDto[]>("/api/prep/pv"),
    enabled: !filtres.affaireId,
  });
  const options = filtres.affaireId
    ? {
        equipements: affaire.data?.equipements.map((e) => ({ id: e.id, label: e.tag })) ?? [],
        techniciens: affaire.data?.techniciens ?? [],
      }
    : optionsSansAffaire(tous.data ?? []);
  const optionsPretes = filtres.affaireId ? Boolean(affaire.data) : Boolean(tous.data);

  return (
    <>
      <PageHeader
        title="Suivi des PV"
        subtitle="Avancement, valeurs préparées modifiées sur site, dépôts SharePoint."
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
        <Select
          aria-label="Équipement"
          value={filtres.equipementId ?? ""}
          disabled={!optionsPretes}
          onChange={(e) => setFiltre("equipementId", e.target.value)}
        >
          <option value="">Tous les équipements</option>
          {options.equipements.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </Select>
        <Select aria-label="Statut" value={filtres.statut ?? ""} onChange={(e) => setFiltre("statut", e.target.value)}>
          <option value="">Tous les statuts</option>
          {STATUTS_SUIVI.map((s) => (
            <option key={s} value={s}>
              {STATUT_PV_LABELS[s]}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Technicien"
          value={filtres.technicienId ?? ""}
          disabled={!optionsPretes}
          onChange={(e) => setFiltre("technicienId", e.target.value)}
        >
          <option value="">Tous les techniciens</option>
          {options.techniciens.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nom}
            </option>
          ))}
        </Select>
      </div>
      {pvs.isPending ? (
        <Loading />
      ) : pvs.isError ? (
        <Alert kind="error">{errorMessage(pvs.error)}</Alert>
      ) : pvs.data.length === 0 ? (
        <Alert kind="info">Aucun PV ne correspond.</Alert>
      ) : (
        <TablePv pvs={pvs.data} />
      )}
    </>
  );
}
