import {
  comparerIndices,
  createRevisionRequestSchema,
  indiceSuivant,
  recapReserves,
  versionCourante,
  type SyncPvDeposeDto,
  type SyncPvDto,
} from "@spie/shared";
import { ApiError } from "../lib/api";
import type { LocalAffaire, LocalPv, UserDb } from "./db";
import { PvLocalError } from "./pv-local";
import { pvDepuisReference, type Fetcher } from "./sync";

/**
 * Révision suivante d'un PV déposé, depuis la tablette (spec §3.4). La création demande du réseau : le serveur
 * réserve l'indice et verrouille le PV. La révision est ensuite sur la tablette et se remplit hors ligne.
 */

/** Révision plus récente du même PV déjà présente sur la tablette (la plus récente), le cas échéant. */
export function revisionLocaleSuivante(
  pv: Pick<LocalPv, "pvId" | "indice">,
  locaux: readonly LocalPv[],
): LocalPv | undefined {
  return versionCourante(locaux.filter((p) => p.pvId === pv.pvId && comparerIndices(p.indice, pv.indice) > 0));
}

/**
 * PV déposés de l'affaire dont la révision courante n'est pas sur la tablette : copie retirée après la durée de
 * conservation (spec §6.3), ou révision plus récente signée depuis une autre tablette. Leur révision suivante peut
 * quand même être créée d'ici.
 */
export function deposesHorsTablette(affaire: LocalAffaire, locaux: readonly LocalPv[]): SyncPvDeposeDto[] {
  return (affaire.deposes ?? []).filter(
    (d) => !locaux.some((p) => p.pvId === d.pvId && comparerIndices(p.indice, d.indice) >= 0),
  );
}

export interface RevisionACreer {
  /** Indice que le serveur attribuera. */
  indice: string;
  /** Indice de la révision déposée dont elle repartira. */
  base: string;
  reservesOuvertes: number;
  /** La révision de départ a été déposée depuis une autre tablette : elle est plus récente que la copie locale. */
  baseAilleurs: boolean;
}

/**
 * Révision qui serait créée à partir d'un PV déposé présent sur la tablette. L'état du serveur (PV déposés reçus à
 * la dernière synchronisation) prime sur la copie locale : si une révision plus récente a été déposée entre-temps,
 * c'est d'elle que la suivante repartira, et c'est son indice qui est annoncé.
 */
export function revisionACreer(pv: LocalPv, affaire: LocalAffaire | null | undefined): RevisionACreer | null {
  const serveur = affaire?.deposes?.find((d) => d.pvId === pv.pvId);
  const ailleurs = serveur !== undefined && comparerIndices(serveur.indice, pv.indice) > 0;
  const base = ailleurs ? serveur.indice : pv.indice;
  const indice = indiceSuivant(base);
  if (!indice) return null;
  return {
    indice,
    base,
    reservesOuvertes: ailleurs ? serveur.reserves.ouvertes : recapReserves(pv.donnees).ouvertes,
    baseAilleurs: ailleurs,
  };
}

export async function creerRevisionSurTablette(
  db: UserDb,
  fetcher: Fetcher,
  args: { pvId: string; modifications: string },
  now: Date,
): Promise<LocalPv> {
  // `affecter` : celui qui crée la révision sur la tablette la complète, il devient technicien du PV.
  const corps = createRevisionRequestSchema.safeParse({ modifications: args.modifications, affecter: true });
  if (!corps.success) throw new PvLocalError("Décrivez la modification apportée par cette révision.");
  let dto: SyncPvDto;
  try {
    dto = await fetcher<SyncPvDto>(`/api/pv/${args.pvId}/revisions`, { method: "POST", body: corps.data });
  } catch (err) {
    if (err instanceof ApiError && err.code === "network") {
      throw new PvLocalError(
        "Serveur injoignable : la création d'une révision demande du réseau, car le serveur réserve l'indice.",
      );
    }
    if (err instanceof ApiError && err.status === 401) {
      throw new PvLocalError("Session expirée : reconnectez-vous pour créer la révision.");
    }
    throw new PvLocalError(err instanceof Error ? err.message : "Création de la révision impossible.");
  }
  const pv = pvDepuisReference(dto, now.toISOString());
  await db.transaction("rw", db.pvs, db.affaires, async () => {
    // La synchronisation a pu l'apporter entre-temps : on ne remplace pas une saisie commencée.
    if (!(await db.pvs.get(pv.versionId))) await db.pvs.add(pv);
    // Le PV n'est plus « déposé, révision possible » : la liste locale est tenue à jour sans attendre la synchro.
    const affaire = await db.affaires.get(pv.affaireId);
    if (affaire?.deposes?.some((d) => d.pvId === pv.pvId)) {
      await db.affaires.put({ ...affaire, deposes: affaire.deposes.filter((d) => d.pvId !== pv.pvId) });
    }
  });
  return (await db.pvs.get(pv.versionId)) ?? pv;
}
