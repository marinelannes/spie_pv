import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { PAGED_HANDLERS_JS } from "@spie/templates";
import type { Browser } from "playwright-core";

/**
 * Rendu PDF des PV (spec §8.2) : HTML du modèle (packages/templates) paginé par Paged.js dans Chromium headless,
 * puis imprimé en PDF. Le navigateur est lancé à la première demande et réutilisé ; chaque rendu a son propre
 * contexte (aucun état partagé entre deux PV) et aucune requête réseau n'est autorisée (tout est en ligne).
 */
export interface PdfRenderer {
  render(html: string): Promise<Uint8Array>;
  close(): Promise<void>;
}

export interface ChromiumPdfRendererOptions {
  /** Exécutable Chromium / Chrome / Edge. Par défaut : `findChromiumExecutable()`, sinon le Chromium de Playwright. */
  executablePath?: string | null;
  /** Durée maximale d'un rendu (spec §9 : PV d'environ 15 pages en moins de 30 s). */
  timeoutMs?: number;
}

const CANDIDATS_WINDOWS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const CANDIDATS_UNIX = [
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

/**
 * Exécutable Chromium à utiliser : `CHROMIUM_EXECUTABLE_PATH` s'il est défini (et existe), sinon le premier
 * navigateur trouvé aux emplacements usuels (Windows : Chrome, Edge ; Linux : chromium, google-chrome).
 * Renvoie null si aucun n'est trouvé.
 */
export function findChromiumExecutable(
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const explicite = env.CHROMIUM_EXECUTABLE_PATH?.trim();
  if (explicite) return exists(explicite) ? explicite : null;
  const candidats = platform === "win32" ? CANDIDATS_WINDOWS : CANDIDATS_UNIX;
  return candidats.find((c) => exists(c)) ?? null;
}

/**
 * Chemin de la polyfill Paged.js. Le paquet `pagedjs` n'exporte que sa racine : on part de son point d'entrée
 * CommonJS (`lib/index.cjs`) pour remonter au dossier `dist/`. Fonctionne depuis les sources et depuis le bundle.
 */
export function pagedPolyfillPath(): string {
  const entree = createRequire(import.meta.url).resolve("pagedjs");
  const chemin = join(dirname(dirname(entree)), "dist", "paged.polyfill.js");
  if (!existsSync(chemin)) throw new Error(`Polyfill Paged.js introuvable : ${chemin}`);
  return chemin;
}

class RenduExpireError extends Error {}

function avecDelai<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const delai = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RenduExpireError(message)), ms);
  });
  return Promise.race([p, delai]).finally(() => clearTimeout(timer));
}

export function createChromiumPdfRenderer(opts: ChromiumPdfRendererOptions = {}): PdfRenderer {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const executablePath = opts.executablePath === undefined ? findChromiumExecutable() : opts.executablePath;
  let browser: Promise<Browser> | null = null;
  let polyfill: string | null = null;

  const getBrowser = (): Promise<Browser> => {
    browser ??= (async () => {
      const { chromium } = await import("playwright-core");
      const b = await chromium.launch({
        executablePath: executablePath ?? undefined,
        headless: true,
        // Conteneur sans utilisateur privilégié ni /dev/shm de taille suffisante (Azure Container Apps).
        args: ["--disable-dev-shm-usage", "--no-sandbox", "--font-render-hinting=none"],
      });
      b.on("disconnected", () => {
        browser = null;
      });
      return b;
    })().catch((err: unknown) => {
      browser = null;
      throw err;
    });
    return browser;
  };

  async function renderOnce(html: string): Promise<Uint8Array> {
    polyfill ??= pagedPolyfillPath();
    const b = await getBrowser();
    const context = await b.newContext({ offline: true });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(timeoutMs);
      // Le document est autonome (CSS en ligne, images en data URI) : toute requête réseau est refusée.
      await page.route("**/*", (route) => route.abort());
      await page.setContent(html, { waitUntil: "load" });
      await page.addScriptTag({ content: "window.PagedConfig = { auto: false };" });
      await page.addScriptTag({ path: polyfill });
      await page.addScriptTag({ content: PAGED_HANDLERS_JS });
      await page.evaluate(async () => {
        // Exécuté dans la page : globalThis y est window.
        const w = globalThis as unknown as { PagedPolyfill: { preview(): Promise<unknown> } };
        await w.PagedPolyfill.preview();
      });
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
      return new Uint8Array(pdf);
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  async function close(): Promise<void> {
    const b = browser;
    browser = null;
    if (b) await (await b.catch(() => null))?.close().catch(() => undefined);
  }

  return {
    async render(html) {
      try {
        return await avecDelai(
          renderOnce(html),
          timeoutMs,
          `Rendu PDF interrompu au-delà de ${Math.round(timeoutMs / 1000)} s.`,
        );
      } catch (err) {
        // Rendu bloqué : on ferme le navigateur, le prochain rendu en relancera un neuf.
        if (err instanceof RenduExpireError) await close();
        throw err;
      }
    },
    close,
  };
}
