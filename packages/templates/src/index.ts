// Modèle « PV de test relais de protection » (spec §4.5, §8.2) : composants React rendus en HTML statique,
// mis en page en CSS d'impression et paginés par Paged.js. Le même code produit l'aperçu hors ligne sur la tablette
// et le PDF côté serveur (Chromium).
import type { PvDocument } from "@spie/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CorpsPvRelais } from "./relais/document.js";
import { CSS_PV_RELAIS } from "./styles.js";

export { PAGED_HANDLERS_JS, SCRIPTS_APERCU } from "./paged-handlers.js";
export { CSS_PV_RELAIS } from "./styles.js";
export { entreesSommaire, type EntreeSommaire } from "./relais/document.js";
export { formatAngle, formatDate, formatDateHeure, formatNombre, formatPhaseur, formatValeur } from "./format.js";

export interface RenderOptions {
  /** Aperçu avant signature : bandeau et filigrane « APERÇU — document non signé ». */
  apercu?: boolean;
  /** Annexe des valeurs pré-remplies modifiées sur site (point ouvert n°8). Désactivée par défaut. */
  signalerModifications?: boolean;
  /** Scripts à charger en fin de document (aperçu navigateur : `SCRIPTS_APERCU`). Aucun par défaut. */
  scripts?: readonly string[];
}

const escapeAttr = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Document HTML complet (CSS en ligne, images en data URI : aucune ressource externe), prêt à être paginé par
 * Paged.js. Sans `scripts`, le HTML est statique : le serveur y injecte la polyfill et les gestionnaires.
 */
export function renderPvRelaisHtml(doc: PvDocument, opts: RenderOptions = {}): string {
  const apercu = opts.apercu ?? false;
  const corps = renderToStaticMarkup(
    createElement(CorpsPvRelais, { doc, apercu, signalerModifications: opts.signalerModifications ?? false }),
  );
  const titre = `PV ${doc.pv.numero} — ind. ${doc.donnees.entete.indice}`;
  const scripts = (opts.scripts ?? []).map((src) => `<script src="${escapeAttr(src)}"></script>`).join("");
  return (
    `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${escapeAttr(titre)}</title><style>${CSS_PV_RELAIS}</style></head>` +
    `<body${apercu ? ' class="apercu"' : ""}>${corps}${scripts}</body></html>`
  );
}
export {
  exemplePvDocument,
  pointsEsExemple,
  SIGNATURE_EXEMPLE_CLIENT,
  SIGNATURE_EXEMPLE_SPIE,
  type OptionsExemple,
} from "./exemple.js";
