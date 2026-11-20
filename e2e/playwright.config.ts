import { existsSync } from "node:fs";
import { chromium, defineConfig } from "@playwright/test";
import { ADMIN, PORT } from "./donnees";

/**
 * Tests de bout en bout de la PWA, en viewport tablette avec émulation tactile.
 *
 * Le serveur testé est le vrai build (`pnpm build`) : l'API sert la PWA, sur une base PGlite en mémoire et un
 * SharePoint simulé dans un dossier temporaire. Rien n'est conservé d'une exécution à l'autre.
 */
const tablette = { hasTouch: true, isMobile: true, deviceScaleFactor: 2 };

// Navigateur : le Chromium de Playwright (`pnpm exec playwright install chromium`), ou un navigateur déjà installé
// sur le poste avec E2E_NAVIGATEUR=msedge (ou chrome).
const navigateur = process.env.E2E_NAVIGATEUR;
const chromiumPlaywright = existsSync(chromium.executablePath()) ? chromium.executablePath() : undefined;

export default defineConfig({
  testDir: "./tests",
  outputDir: "./resultats",
  globalSetup: "./preparation.ts",
  // Un seul serveur, une seule base : les tests s'exécutent l'un après l'autre.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { outputFolder: "rapport", open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    trace: "retain-on-failure",
    channel: navigateur,
  },
  projects: [
    { name: "ipad-portrait", use: { ...tablette, viewport: { width: 768, height: 1024 } } },
    { name: "ipad-paysage", use: { ...tablette, viewport: { width: 1024, height: 768 } } },
  ],
  webServer: {
    command: "node serveur.mjs",
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NODE_ENV: "development",
      HOST: "127.0.0.1",
      PORT: String(PORT),
      LOG_LEVEL: "warn",
      DATABASE_URL: "pglite://memory",
      WEB_DIST_DIR: "../apps/web/dist",
      SHAREPOINT_MODE: "fake",
      FAKE_SHAREPOINT_DIR: "./.serveur/sharepoint",
      ARCHIVE_DIR: "./.serveur/archive",
      // Le serveur produit les PDF avec le Chromium de Playwright s'il est installé (sinon Edge ou Chrome du poste).
      ...(chromiumPlaywright ? { CHROMIUM_EXECUTABLE_PATH: chromiumPlaywright } : {}),
      WORKER_POLL_SECONDS: "1",
      LOGIN_RATE_LIMIT_PER_MINUTE: "10000",
      BOOTSTRAP_ADMIN_EMAIL: ADMIN.email,
      BOOTSTRAP_ADMIN_NAME: ADMIN.nom,
      BOOTSTRAP_ADMIN_PASSWORD: ADMIN.motDePasseProvisoire,
    },
  },
});
