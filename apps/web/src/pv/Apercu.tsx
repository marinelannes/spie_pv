import type { PvDocument } from "@spie/shared";
import { SCRIPTS_APERCU, renderPvRelaisHtml } from "@spie/templates";
import { useMemo } from "react";
import { Alert } from "../components/ui";

/** HTML de l'aperçu : même modèle que le PDF final, paginé par Paged.js dans le navigateur (hors ligne). */
export function htmlApercu(doc: PvDocument): string {
  return renderPvRelaisHtml(doc, { apercu: true, scripts: [...SCRIPTS_APERCU] });
}

/** Aperçu du PV dans le format du modèle (spec §3.2 étape 5). */
export function ApercuPv({ doc }: { doc: PvDocument }) {
  const rendu = useMemo(() => {
    try {
      return { html: htmlApercu(doc), erreur: null };
    } catch (err) {
      return { html: null, erreur: err instanceof Error ? err.message : String(err) };
    }
  }, [doc]);
  if (rendu.erreur !== null) return <Alert kind="error">Aperçu impossible : {rendu.erreur}</Alert>;
  return (
    <iframe
      title={`Aperçu du PV ${doc.pv.numero}`}
      srcDoc={rendu.html}
      sandbox="allow-scripts allow-same-origin"
      className="h-[80vh] w-full rounded-xl border border-slate-300 bg-slate-200"
    />
  );
}
