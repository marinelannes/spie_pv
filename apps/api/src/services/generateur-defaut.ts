import type { AppConfig } from "../config.js";
import { createChromiumPdfRenderer, findChromiumExecutable } from "../pdf/renderer.js";
import { createGenerateurFichiers, type GenerateurFichiers } from "./fichiers.js";

/** Générateur de production : PDF par Chromium (lancé à la première demande), JSON, XLSX. */
export function generateurParDefaut(config: AppConfig): GenerateurFichiers {
  return createGenerateurFichiers(
    createChromiumPdfRenderer({ executablePath: config.chromiumExecutablePath ?? findChromiumExecutable() }),
  );
}
