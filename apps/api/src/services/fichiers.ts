import { exporterResultatsEs } from "@spie/io-import";
import type { PvDocument, TypeFichier } from "@spie/shared";
import { renderPvRelaisHtml } from "@spie/templates";

/** Rendu HTML → PDF (Chromium + Paged.js, apps/api/src/pdf). */
export interface PdfRendererLike {
  render(html: string): Promise<Uint8Array>;
  close(): Promise<void>;
}

/** Production des fichiers d'une version (spec §5.1). Injectable pour les tests. */
export interface GenerateurFichiers {
  generer(type: TypeFichier, doc: PvDocument): Promise<Uint8Array>;
  close(): Promise<void>;
}

export const CONTENT_TYPES: Record<TypeFichier, string> = {
  pdf: "application/pdf",
  json: "application/json; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** Le fichier .json : le document complet, lisible (indenté). */
export function documentJson(doc: PvDocument): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(doc, null, 2)}\n`);
}

export function createGenerateurFichiers(
  pdf: PdfRendererLike,
  opts: { signalerModifications?: boolean } = {},
): GenerateurFichiers {
  return {
    async generer(type, doc) {
      switch (type) {
        case "pdf":
          return pdf.render(renderPvRelaisHtml(doc, { signalerModifications: opts.signalerModifications ?? false }));
        case "json":
          return documentJson(doc);
        case "xlsx":
          return exporterResultatsEs(doc);
      }
    },
    close: () => pdf.close(),
  };
}
