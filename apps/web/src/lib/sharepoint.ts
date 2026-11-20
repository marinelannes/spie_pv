/** Préfixe du SharePoint simulé servi par l'API hors production (même valeur que côté API). */
export const URL_SHAREPOINT_SIMULE = "/sharepoint-simule/";

/**
 * Lien ouvrable vers un fichier déposé (spec §3.3) : `webUrl` SharePoint (https), ou fichier du SharePoint simulé
 * servi par l'API en développement. Toute autre valeur (file://, vide) n'est pas un lien utilisable.
 */
export function lienSharePoint(webUrl: string | null | undefined): string | null {
  if (!webUrl) return null;
  return webUrl.startsWith("https://") || webUrl.startsWith(URL_SHAREPOINT_SIMULE) ? webUrl : null;
}
