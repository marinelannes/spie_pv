import { STATUT_DEPOT_LABELS, STATUT_PV_LABELS, type DepotDto, type StatutPv } from "@spie/shared";
import { lienSharePoint } from "../lib/sharepoint";
import { Badge } from "./ui";

const TONS: Record<StatutPv, "neutral" | "blue" | "green" | "red" | "amber"> = {
  prepare: "neutral",
  brouillon: "blue",
  signe: "amber",
  recu: "blue",
  depose: "green",
  erreur: "red",
};

export function BadgeStatutPv({ statut }: { statut: StatutPv }) {
  return <Badge tone={TONS[statut]}>{STATUT_PV_LABELS[statut]}</Badge>;
}

/** Statut d'un PV de la tablette : un brouillon signé depuis une autre tablette n'est plus « en cours de saisie ». */
export function BadgePvLocal({ pv }: { pv: { statut: StatutPv; clotAilleurs?: { signePar: string | null } | null } }) {
  if (pv.clotAilleurs) {
    return (
      <Badge tone="amber">
        {pv.clotAilleurs.signePar ? `Signé par ${pv.clotAilleurs.signePar}` : "Signé sur une autre tablette"}
      </Badge>
    );
  }
  return <BadgeStatutPv statut={pv.statut} />;
}

export function BadgesDepots({ depots }: { depots: readonly DepotDto[] }) {
  if (depots.length === 0) return <span className="text-slate-500">—</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {depots.map((d) => {
        const badge = (
          <Badge tone={d.statut === "depose" ? "green" : d.statut === "erreur" ? "red" : "amber"}>
            {d.fichier.toUpperCase()} : {STATUT_DEPOT_LABELS[d.statut]}
          </Badge>
        );
        const lien = d.statut === "depose" ? lienSharePoint(d.webUrl) : null;
        return lien ? (
          <a
            key={d.id}
            href={lien}
            target="_blank"
            rel="noreferrer"
            title={d.cheminSharePoint ?? undefined}
            aria-label={`Ouvrir le ${d.fichier.toUpperCase()} dans SharePoint`}
            className="underline-offset-2 hover:underline"
          >
            {badge}
          </a>
        ) : (
          <span key={d.id} title={d.derniereErreur ?? d.cheminSharePoint ?? undefined}>
            {badge}
          </span>
        );
      })}
    </span>
  );
}

/** Liens « Ouvrir le PDF dans SharePoint »… vers les fichiers déposés (spec §3.3). */
export function LiensSharePoint({ depots, className }: { depots: readonly DepotDto[]; className?: string }) {
  const liens = depots
    .filter((d) => d.statut === "depose")
    .map((d) => ({ d, lien: lienSharePoint(d.webUrl) }))
    .filter((x): x is { d: DepotDto; lien: string } => x.lien !== null);
  if (liens.length === 0) return null;
  return (
    <span className={className ?? "inline-flex flex-wrap gap-x-4"}>
      {liens.map(({ d, lien }) => (
        <a
          key={d.id}
          href={lien}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-12 items-center font-semibold underline"
        >
          Ouvrir le {d.fichier.toUpperCase()} dans SharePoint
        </a>
      ))}
    </span>
  );
}
