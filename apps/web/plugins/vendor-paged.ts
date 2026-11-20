import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Plugin } from "vite";
// Source des gestionnaires Paged.js du modèle (même code que pour le PDF serveur). Import relatif : la configuration
// Vite est exécutée par Node, qui ne charge pas le point d'entrée TypeScript/TSX du paquet @spie/templates.
import { PAGED_HANDLERS_JS } from "../../../packages/templates/src/paged-handlers.js";

const require = createRequire(import.meta.url);

/** `dist/paged.polyfill.js` n'est pas exporté par le paquet : on le retrouve depuis son point d'entrée CommonJS. */
export function cheminPolyfillPaged(): string {
  return join(dirname(require.resolve("pagedjs")), "..", "dist", "paged.polyfill.js");
}

/**
 * Scripts de l'aperçu hors ligne du PV (spec §3.2 étape 5, §6.2) : la polyfill Paged.js et les gestionnaires du
 * modèle, servis sous `/vendor/` (même origine : CSP `script-src 'self'`) et précachés par le service worker.
 */
export const FICHIERS_VENDOR: Record<string, () => string> = {
  "vendor/paged.polyfill.js": () => readFileSync(cheminPolyfillPaged(), "utf8"),
  "vendor/paged-handlers.js": () => PAGED_HANDLERS_JS,
};

export function vendorPaged(fichiers: Record<string, () => string> = FICHIERS_VENDOR): Plugin {
  return {
    name: "spie-vendor-paged",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const chemin = (req.url ?? "").split("?")[0]!.replace(/^\//, "");
        const lire = fichiers[chemin];
        if (!lire) return next();
        res.setHeader("Content-Type", "text/javascript; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache");
        res.end(lire());
      });
    },
    generateBundle() {
      for (const [fileName, lire] of Object.entries(fichiers)) {
        this.emitFile({ type: "asset", fileName, source: lire() });
      }
    },
  };
}
