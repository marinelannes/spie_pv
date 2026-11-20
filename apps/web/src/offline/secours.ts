import type { PvRelaisData } from "@spie/shared";
import type { UserDb } from "./db";
import { enregistrerDonnees } from "./pv-local";

/**
 * Copie de secours de la saisie en cours (spec §6.1 : ne rien perdre en cas de fermeture brutale).
 *
 * L'enregistrement local (IndexedDB) est asynchrone : si la page est rechargée ou fermée dans l'instant qui suit une
 * frappe, il n'a pas le temps d'aboutir. À la fermeture, la saisie pas encore enregistrée est donc aussi écrite dans
 * `localStorage`, qui est synchrone ; elle est reprise à la prochaine ouverture du PV.
 */

interface Secours {
  /** Date de la copie : elle n'est reprise que si elle est plus récente que le PV enregistré. */
  le: string;
  donnees: PvRelaisData;
}

const cle = (userId: string, versionId: string) => `spie-pv:secours:${userId}:${versionId}`;

export function ecrireSecours(userId: string, versionId: string, donnees: PvRelaisData, now = new Date()): void {
  try {
    const secours: Secours = { le: now.toISOString(), donnees };
    localStorage.setItem(cle(userId, versionId), JSON.stringify(secours));
  } catch {
    // Stockage plein ou indisponible : l'enregistrement normal reste tenté.
  }
}

export function effacerSecours(userId: string, versionId: string): void {
  try {
    localStorage.removeItem(cle(userId, versionId));
  } catch {
    // Rien à effacer.
  }
}

/**
 * Reprend la copie de secours d'un PV si elle est plus récente que ce qui est enregistré, puis l'efface.
 * Renvoie true si une saisie a été récupérée. Un PV signé entre-temps (figé) n'est jamais modifié.
 */
export async function restaurerSecours(
  db: UserDb,
  userId: string,
  versionId: string,
  auteur: string,
): Promise<boolean> {
  let secours: Secours | null = null;
  try {
    secours = JSON.parse(localStorage.getItem(cle(userId, versionId)) ?? "null") as Secours | null;
  } catch {
    secours = null;
  }
  if (!secours) return false;
  try {
    const pv = await db.pvs.get(versionId);
    if (!pv || secours.le < pv.modifieLe) return false;
    await enregistrerDonnees(db, versionId, secours.donnees, { par: auteur, le: secours.le });
    return true;
  } catch {
    // PV signé, clos ou retiré depuis : la copie ne sert plus.
    return false;
  } finally {
    effacerSecours(userId, versionId);
  }
}

/** À la fermeture de la page, écrit la saisie pas encore enregistrée. Renvoie la fonction de désinscription. */
export function secoursALaFermeture(
  userId: string,
  versionId: string,
  nonEnregistree: () => PvRelaisData | undefined,
  win: Pick<Window, "addEventListener" | "removeEventListener"> = window,
): () => void {
  const onHide = () => {
    const donnees = nonEnregistree();
    if (donnees !== undefined) ecrireSecours(userId, versionId, donnees);
  };
  win.addEventListener("pagehide", onHide);
  return () => win.removeEventListener("pagehide", onHide);
}
