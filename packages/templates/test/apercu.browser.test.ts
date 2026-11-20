import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PAGED_HANDLERS_JS, SCRIPTS_APERCU, exemplePvDocument, renderPvRelaisHtml } from "../src/index.js";

/**
 * Aperçu dans la PWA : le HTML est servi tel quel avec, en fin de body, la polyfill Paged.js puis les gestionnaires
 * (fichiers statiques de même origine). On vérifie dans un vrai Chromium que les gestionnaires sont enregistrés
 * avant le rendu (en-têtes de tableau répétés sur les pages suivantes).
 */
const NAVIGATEURS = [
  process.env.CHROMIUM_EXECUTABLE_PATH ?? "",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
];
const navigateur = NAVIGATEURS.find((p) => p && existsSync(p));

const polyfill = () => {
  const entree = createRequire(import.meta.url).resolve("pagedjs");
  return readFileSync(join(dirname(dirname(entree)), "dist", "paged.polyfill.js"), "utf8");
};

describe.skipIf(!navigateur)("aperçu navigateur (Paged.js + gestionnaires, scripts en fin de body)", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    const { chromium } = await import("playwright-core");
    browser = await chromium.launch({ executablePath: navigateur, headless: true });
    page = await browser.newPage();
    const html = renderPvRelaisHtml(exemplePvDocument({ nbEs: 128, signe: false }), {
      apercu: true,
      scripts: SCRIPTS_APERCU,
    });
    const fichiers: Record<string, string> = {
      "/apercu.html": html,
      "/vendor/paged.polyfill.js": polyfill(),
      "/vendor/paged-handlers.js": PAGED_HANDLERS_JS,
    };
    // Origine fictive : les fichiers sont servis par interception, comme le ferait le service worker de la PWA.
    await page.route("**/*", (route) => {
      const chemin = new URL(route.request().url()).pathname;
      const corps = fichiers[chemin];
      if (corps === undefined) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({
        status: 200,
        body: corps,
        headers: {
          "content-type": chemin.endsWith(".js") ? "text/javascript" : "text/html; charset=utf-8",
          "content-security-policy":
            "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'",
        },
      });
    });
    await page.goto("https://pv.spie.test/apercu.html");
    await page.waitForFunction(
      () => document.querySelectorAll(".pagedjs_page").length > 0 && !!document.querySelector(".pagedjs_pages"),
      null,
      {
        timeout: 30_000,
      },
    );
    // Le rendu est terminé quand le nombre de pages n'augmente plus.
    let avant = -1;
    for (let i = 0; i < 50; i++) {
      const n = await page.evaluate(() => document.querySelectorAll(".pagedjs_page").length);
      if (n === avant) break;
      avant = n;
      await page.waitForTimeout(300);
    }
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  it("les gestionnaires sont chargés après la polyfill et avant le rendu, malgré la CSP script-src 'self'", async () => {
    expect(
      await page.evaluate(() => (window as unknown as { __spiePagedHandlers?: boolean }).__spiePagedHandlers),
    ).toBe(true);
  });

  it("pagine le document et numérote les pages (« Page x sur y » via les compteurs)", async () => {
    const pages = await page.evaluate(() => document.querySelectorAll(".pagedjs_page").length);
    expect(pages).toBeGreaterThanOrEqual(14);
    const total = await page.evaluate(() =>
      getComputedStyle(document.querySelector(".pagedjs_pages")!).getPropertyValue("--pagedjs-page-count").trim(),
    );
    expect(Number(total)).toBe(pages);
  });

  it("répète l'en-tête du tableau des E/S sur chaque page où il continue", async () => {
    const r = await page.evaluate(() => {
      const suites = [...document.querySelectorAll("table.es[data-split-from]")];
      return { suites: suites.length, avecEntete: suites.filter((t) => t.querySelector(":scope > thead")).length };
    });
    expect(r.suites).toBeGreaterThanOrEqual(2);
    expect(r.avecEntete).toBe(r.suites);
  });

  it("place l'en-tête et le pied de page sur chaque page", async () => {
    const r = await page.evaluate(() => {
      const pages = [...document.querySelectorAll(".pagedjs_page")];
      return {
        pages: pages.length,
        entetes: pages.filter((p) => p.querySelector(".pagedjs_margin-top-center .entete")).length,
        pieds: pages.filter((p) => p.querySelector(".pagedjs_margin-bottom-center .pied")).length,
      };
    });
    expect(r.entetes).toBe(r.pages);
    expect(r.pieds).toBe(r.pages);
  });

  it("le sommaire reçoit les numéros de page (target-counter)", async () => {
    // Paged.js remplace target-counter() par un compteur dédié, initialisé au numéro de la page cible.
    const r = await page.evaluate(() =>
      [...document.querySelectorAll(".sommaire a")].map((a) => {
        const apres = getComputedStyle(a, "::after");
        const nom = /counter\((target-counter-[\w-]+)\)/.exec(apres.content)?.[1] ?? null;
        const reset = `${getComputedStyle(a).counterReset} ${apres.counterReset}`;
        const valeur = nom ? new RegExp(`${nom} ([0-9]+)`).exec(reset)?.[1] : undefined;
        return { href: a.getAttribute("href"), valeur: valeur === undefined ? null : Number(valeur) };
      }),
    );
    expect(r.length).toBeGreaterThan(10);
    for (const e of r) expect(e.valeur, e.href ?? "").toBeGreaterThanOrEqual(3);
    const pageDe = (href: string) => r.find((e) => e.href === href)!.valeur!;
    expect(pageDe("#s-introduction")).toBe(3);
    expect(pageDe("#s-conclusion")).toBeGreaterThan(pageDe("#s-es"));
  });
});
