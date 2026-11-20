// Démarre l'application à tester : le build de l'API, qui sert aussi la PWA (voir playwright.config.ts).
// Le dossier du SharePoint simulé est vidé à chaque démarrage : chaque exécution repart de zéro.
import { rmSync } from "node:fs";

rmSync(new URL("./.serveur", import.meta.url), { recursive: true, force: true });
await import("../apps/api/dist/server.js");
