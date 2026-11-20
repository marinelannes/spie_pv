import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import {
  TENSION_MESUREE,
  allerASection,
  boutonValider,
  creerPvSurSite,
  expect,
  remplirPvComplet,
  remplirSignatures,
  test,
} from "../outils";

/**
 * Ergonomie tablette et accessibilité de base. Le même parcours est contrôlé écran par écran, dans les deux
 * orientations (projets « ipad-portrait » et « ipad-paysage »), avec une capture de chaque écran dans `captures/`.
 *
 * Non vérifiable ici : le clavier virtuel (un navigateur de test n'en affiche pas). À contrôler sur une vraie
 * tablette : aucun champ en cours de saisie ne doit être masqué par le clavier.
 */

/** Taille minimale d'une cible tactile, en pixels CSS. */
const CIBLE_MIN = 44;

/** Liste les éléments à toucher plus petits que 44 × 44 px (une case à cocher compte avec son libellé). */
async function ciblesTropPetites(page: Page): Promise<string[]> {
  return page.evaluate((min) => {
    const trop: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("a, button, input, select, textarea, [role=radio]")) {
      const zone = (
        el instanceof HTMLInputElement && el.type === "checkbox" ? (el.closest("label") ?? el) : el
      ).getBoundingClientRect();
      if (zone.width === 0 || zone.height === 0) continue; // élément masqué
      if (zone.width < min || zone.height < min) {
        const nom = el.getAttribute("aria-label") ?? el.innerText ?? el.getAttribute("name") ?? "";
        trop.push(
          `${el.tagName.toLowerCase()} « ${nom.trim().slice(0, 40)} » ${Math.round(zone.width)}×${Math.round(zone.height)}`,
        );
      }
    }
    return trop;
  }, CIBLE_MIN);
}

/** Champs de saisie sans nom accessible (ni <label>, ni aria-label). */
async function champsSansLibelle(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLInputElement>("input, select, textarea")]
      .filter((el) => !el.labels?.length && !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby"))
      .map((el) => el.outerHTML.slice(0, 80)),
  );
}

/** Contrôles communs à tous les écrans, puis capture d'écran. */
async function controlerEcran(page: Page, nom: string): Promise<void> {
  const projet = test.info().project.name;
  await page.screenshot({ path: `captures/${projet}/${nom}.png` });

  await test.step(`${nom} : pas de défilement horizontal`, async () => {
    const depassement = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect.soft(depassement, "la page dépasse en largeur").toBeLessThanOrEqual(0);
  });
  await test.step(`${nom} : cibles tactiles d'au moins ${CIBLE_MIN} px`, async () => {
    expect.soft(await ciblesTropPetites(page)).toEqual([]);
  });
  await test.step(`${nom} : chaque champ a un libellé`, async () => {
    expect.soft(await champsSansLibelle(page)).toEqual([]);
  });
  await test.step(`${nom} : contrastes et règles d'accessibilité (axe, WCAG A et AA)`, async () => {
    const resultat = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const violations = resultat.violations.map((v) => `${v.id} : ${v.help} (${v.nodes.length} élément(s))`);
    expect.soft(violations).toEqual([]);
  });
}

test.describe("Ergonomie tablette", () => {
  test("écrans principaux : largeur, cibles tactiles, libellés, contrastes — avec captures", async ({
    page,
    affaire,
  }) => {
    test.slow();
    await page.goto("/connexion");
    await controlerEcran(page, "01-connexion");

    await creerPvSurSite(page, affaire);
    await controlerEcran(page, "04-saisie-generalites");

    await page.getByRole("link", { name: "Mes affaires" }).tap();
    await expect(page.getByText("Prêt pour le hors ligne")).toBeVisible();
    await controlerEcran(page, "02-mes-affaires");

    await page.getByRole("link", { name: new RegExp(affaire.numero) }).tap();
    await controlerEcran(page, "03-affaire");

    await page.getByRole("link", { name: new RegExp(`${affaire.numero}-`) }).tap();
    await page.getByRole("button", { name: /Ce qui manque/ }).tap();
    await controlerEcran(page, "05-ce-qui-manque");
    await page.getByRole("button", { name: /Ce qui manque/ }).tap();

    for (const [nom, section] of [
      ["06-saisie-tests", "Tests préliminaires"],
      ["07-saisie-mesures", "Vérification des circuits de mesures"],
      ["08-saisie-entrees-sorties", "Affectation cartes E/S"],
      ["09-saisie-protection", "Plan de protection"],
      ["10-saisie-observations", "Observations"],
    ] as const) {
      await allerASection(page, section);
      await controlerEcran(page, nom);
    }

    await remplirPvComplet(page);
    await remplirSignatures(page);
    await expect(boutonValider(page)).toBeEnabled();
    await controlerEcran(page, "11-signature");

    await page.getByRole("link", { name: "Retour à la saisie" }).tap();
    await page.getByRole("button", { name: "Aperçu" }).tap();
    await expect(page.frameLocator("iframe").getByText("Dominique Client").first()).toBeVisible({ timeout: 30_000 });
    // Les pages de l'aperçu sont des feuilles blanches (elles ne l'étaient pas : styles d'écran ignorés).
    await expect(page.frameLocator("iframe").locator(".pagedjs_page").first()).toHaveCSS(
      "background-color",
      "rgb(255, 255, 255)",
    );
    await controlerEcran(page, "12-apercu");
  });

  test("le bon clavier virtuel selon le champ : e-mail, nombre, date", async ({ page, affaire }) => {
    await page.goto("/connexion");
    await expect(page.getByLabel("Adresse e-mail")).toHaveAttribute("type", "email");

    await creerPvSurSite(page, affaire);
    await allerASection(page, "Vérification des circuits de mesures");
    await expect(page.getByLabel(TENSION_MESUREE)).toHaveAttribute("inputmode", "decimal");

    await page.getByRole("button", { name: "Signer", exact: true }).tap();
    await expect(page.getByLabel("Date", { exact: true }).first()).toHaveAttribute("type", "date");
  });

  test("navigation au clavier : connexion possible sans toucher l'écran", async ({ page }) => {
    await page.goto("/connexion");
    await expect(page.getByLabel("Adresse e-mail")).toBeFocused();
    await page.keyboard.type("technicien@exemple.test");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Mot de passe")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Se connecter" })).toBeFocused();
    // Mot de passe vide : le formulaire explique ce qui manque, sans quitter la page
    await page.keyboard.press("Enter");
    await expect(page.getByText("Mot de passe requis.")).toBeVisible();
  });

  test("les jugements C / NC / NA se choisissent au toucher, sans survol", async ({ page, affaire }) => {
    await creerPvSurSite(page, affaire);
    await allerASection(page, "Identification de la configuration");
    const conforme = page.getByRole("radio", { name: "C", exact: true });
    await conforme.tap();
    await expect(conforme).toBeChecked();
    // Un second appui efface le choix
    await conforme.tap();
    await expect(conforme).not.toBeChecked();
  });
});
