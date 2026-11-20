import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { exemplePvDocument, renderPvRelaisHtml } from "@spie/templates";
import { afterAll, describe, expect, it } from "vitest";
import { createChromiumPdfRenderer, findChromiumExecutable, pagedPolyfillPath } from "../src/pdf/renderer.js";

/** Nombre de pages d'un PDF (objets /Type /Page, hors /Pages). */
function nbPages(pdf: Uint8Array): number {
  return (
    Buffer.from(pdf)
      .toString("latin1")
      .match(/\/Type\s*\/Page(?![a-z])/g) ?? []
  ).length;
}

/** Dossier où enregistrer les PDF produits pour un contrôle visuel (facultatif). */
const SORTIE = process.env.SPIE_PDF_OUT;

describe("findChromiumExecutable", () => {
  const existe = (chemins: string[]) => (p: string) => chemins.includes(p);

  it("prend CHROMIUM_EXECUTABLE_PATH en priorité, s'il existe", () => {
    expect(
      findChromiumExecutable(
        { CHROMIUM_EXECUTABLE_PATH: "/opt/chrome" },
        existe(["/opt/chrome", "/usr/bin/chromium"]),
        "linux",
      ),
    ).toBe("/opt/chrome");
  });

  it("renvoie null si CHROMIUM_EXECUTABLE_PATH pointe un fichier absent (pas de repli silencieux)", () => {
    expect(
      findChromiumExecutable({ CHROMIUM_EXECUTABLE_PATH: "/absent" }, existe(["/usr/bin/chromium"]), "linux"),
    ).toBeNull();
  });

  it("cherche les emplacements usuels sous Linux", () => {
    expect(findChromiumExecutable({}, existe(["/usr/bin/google-chrome"]), "linux")).toBe("/usr/bin/google-chrome");
    expect(findChromiumExecutable({}, existe(["/usr/bin/chromium", "/usr/bin/google-chrome"]), "linux")).toBe(
      "/usr/bin/chromium",
    );
  });

  it("cherche Chrome puis Edge sous Windows", () => {
    const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
    const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    expect(findChromiumExecutable({}, existe([edge]), "win32")).toBe(edge);
    expect(findChromiumExecutable({}, existe([edge, chrome]), "win32")).toBe(chrome);
  });

  it("renvoie null quand aucun navigateur n'est trouvé", () => {
    expect(findChromiumExecutable({}, () => false, "linux")).toBeNull();
  });
});

describe("pagedPolyfillPath", () => {
  it("trouve la polyfill Paged.js malgré le champ exports du paquet", () => {
    expect(pagedPolyfillPath()).toMatch(/paged\.polyfill\.js$/);
  });
});

const navigateur = findChromiumExecutable();

describe.skipIf(!navigateur)("rendu PDF Chromium + Paged.js", () => {
  const renderer = createChromiumPdfRenderer({ executablePath: navigateur, timeoutMs: 60_000 });
  afterAll(() => renderer.close());

  async function rendre(nom: string, html: string) {
    const debut = performance.now();
    const pdf = await renderer.render(html);
    const duree = performance.now() - debut;
    if (SORTIE) await writeFile(join(SORTIE, nom), pdf);
    return { pdf, duree, pages: nbPages(pdf) };
  }

  it("rend un PV réaliste (33 E/S, 3 fonctions, observations, signatures) en moins de 30 s", async () => {
    const { pdf, duree, pages } = await rendre("pv-relais-33es.pdf", renderPvRelaisHtml(exemplePvDocument()));
    expect(Buffer.from(pdf.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
    expect(pages).toBeGreaterThanOrEqual(10);
    expect(pages).toBeLessThanOrEqual(20);
    expect(duree).toBeLessThan(30_000);
  }, 90_000);

  it("rend un PV à 128 E/S (feuille HTB_TR1) en moins de 30 s, le tableau des E/S sur plusieurs pages", async () => {
    const court = nbPages(await renderer.render(renderPvRelaisHtml(exemplePvDocument())));
    const { duree, pages } = await rendre("pv-relais-128es.pdf", renderPvRelaisHtml(exemplePvDocument({ nbEs: 128 })));
    expect(pages).toBeGreaterThan(court + 1);
    expect(duree).toBeLessThan(30_000);
  }, 120_000);

  it("rend un aperçu non signé et un refus de signer, et réutilise le navigateur entre deux rendus", async () => {
    const a = await rendre(
      "pv-relais-apercu.pdf",
      renderPvRelaisHtml(exemplePvDocument({ signe: false }), { apercu: true }),
    );
    const b = await rendre(
      "pv-relais-refus-annexe.pdf",
      renderPvRelaisHtml(exemplePvDocument({ refusClient: true }), { signalerModifications: true }),
    );
    expect(a.pages).toBeGreaterThanOrEqual(10);
    expect(b.pages).toBe(a.pages + 1); // annexe des modifications sur une page de plus
  }, 120_000);

  it("refuse toute requête réseau : une image externe n'est pas chargée mais le rendu aboutit", async () => {
    const html = renderPvRelaisHtml(exemplePvDocument()).replace(
      "</body>",
      '<img src="https://exemple.invalid/traceur.png" alt=""></body>',
    );
    const { pdf } = await rendre("pv-relais-reseau.pdf", html);
    expect(Buffer.from(pdf.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
  }, 90_000);

  it("interrompt un rendu trop long", async () => {
    const lent = createChromiumPdfRenderer({ executablePath: navigateur, timeoutMs: 50 });
    try {
      await expect(lent.render(renderPvRelaisHtml(exemplePvDocument()))).rejects.toThrow(/interrompu/);
    } finally {
      await lent.close();
    }
  }, 60_000);
});
