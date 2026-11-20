import { sanitizeSharePointFileName } from "./sharepoint.js";
import { parisDateTimeParts } from "./time.js";

/**
 * Numéro du PV = n° d'affaire + date et heure de création, heure de Paris (spec §4.1) :
 * `<n° affaire>-<AAAAMMJJ>-<HHMMSS>`, ex. `A00001-20261119-143205`. Attribué sans réseau par la tablette.
 */
export function numeroPv(numeroAffaire: string, creeLe: Date): string {
  const { date, time } = parisDateTimeParts(creeLe);
  return `${numeroAffaire}-${date}-${time}`;
}

const NUMERO_RE = /^([A-Z0-9][A-Z0-9_-]{1,31})-(\d{8})-(\d{6})$/;

/** Décompose un numéro de PV ; null s'il n'a pas le format attendu. */
export function parseNumeroPv(numero: string): { affaire: string; date: string; heure: string } | null {
  const m = NUMERO_RE.exec(numero);
  if (!m) return null;
  return { affaire: m[1]!, date: m[2]!, heure: m[3]! };
}

/**
 * Instant de création à retenir pour un nouveau PV sur un poste : une même tablette ne peut pas créer deux PV
 * dans la même seconde, l'application attend la seconde suivante (spec §4.1). Renvoie le délai à attendre (ms)
 * avant de relire l'horloge, ou 0 si `maintenant` peut servir tel quel.
 */
export function delaiAvantNumero(dernierNumeroLe: Date | null, maintenant: Date): number {
  if (!dernierNumeroLe) return 0;
  const derniereSeconde = Math.floor(dernierNumeroLe.getTime() / 1000);
  const seconde = Math.floor(maintenant.getTime() / 1000);
  if (seconde > derniereSeconde) return 0;
  // Même seconde (ou horloge revenue en arrière) : on attend le début de la seconde qui suit la dernière utilisée.
  return (derniereSeconde + 1) * 1000 - maintenant.getTime();
}

/**
 * Attribue un numéro en respectant la règle « une seconde par PV » pour ce poste.
 * `horloge` et `attendre` sont injectés (tests, tablette).
 */
export async function attribuerNumeroPv(
  numeroAffaire: string,
  dernierNumeroLe: Date | null,
  horloge: () => Date,
  attendre: (ms: number) => Promise<void>,
): Promise<{ numero: string; creeLe: Date }> {
  let maintenant = horloge();
  for (let i = 0; i < 5; i++) {
    const delai = delaiAvantNumero(dernierNumeroLe, maintenant);
    if (delai <= 0) return { numero: numeroPv(numeroAffaire, maintenant), creeLe: maintenant };
    await attendre(delai);
    maintenant = horloge();
  }
  // Horloge bloquée ou très en retard : on prend la seconde suivant le dernier numéro plutôt que de boucler.
  const creeLe = new Date((Math.floor(dernierNumeroLe!.getTime() / 1000) + 1) * 1000);
  return { numero: numeroPv(numeroAffaire, creeLe), creeLe };
}

export type ExtensionFichierPv = "pdf" | "json" | "xlsx";

/**
 * Nom de fichier d'un PV (spec §5.3, proposition à valider) : `PV_<famille>_<tag>_<numéro>_ind<indice>.<ext>`,
 * ex. `PV_MES_RPN_HTA_F1_A00001-20261119-143205_indA.pdf`. Caractères interdits par SharePoint remplacés.
 */
export function nomFichierPv(args: {
  famille: string;
  tag: string | null;
  numero: string;
  indice: string;
  extension: ExtensionFichierPv;
}): string {
  const tag = (args.tag ?? "").trim().replace(/\s+/g, "_");
  const parts = ["PV", args.famille, ...(tag ? [tag] : []), args.numero, `ind${args.indice}`];
  return sanitizeSharePointFileName(`${parts.join("_")}.${args.extension}`);
}
