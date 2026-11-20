import { allerASection, attendreEnregistrement, creerPvSurSite, expect, test } from "../outils";

/** Tentatives d'injection par les champs de saisie : le texte doit rester du texte, partout où il est affiché. */
const INJECTIONS = [
  `<img src=x onerror="window.injection = 'img'">`,
  `<script>window.injection = 'script'</script>`,
  `"><svg onload="window.injection = 'svg'">`,
];

test.describe("Sécurité des saisies", () => {
  test("du HTML saisi dans une observation n'est jamais exécuté (saisie, liste, aperçu du PV)", async ({
    page,
    affaire,
  }) => {
    const texte = INJECTIONS.join(" ");
    await creerPvSurSite(page, affaire);
    await page.getByLabel("Lieu des tests").fill(texte);
    await allerASection(page, "Identification de la configuration");
    await page.getByRole("radio", { name: "NC", exact: true }).tap();
    await page.getByLabel("Observation pour Identification de la configuration").fill(texte);
    await page.getByRole("button", { name: "Ajouter l'observation" }).tap();
    await attendreEnregistrement(page);

    // Écran de saisie : l'observation est réaffichée telle quelle, comme du texte
    await expect(page.getByText(texte)).toBeVisible();
    await page.getByRole("button", { name: /Ce qui manque/ }).tap();

    // Aperçu : le PV mis en page (le même rendu que le PDF) affiche le texte, sans l'interpréter
    await page.getByRole("button", { name: "Aperçu" }).tap();
    const apercu = page.frameLocator("iframe");
    await expect(apercu.getByText(INJECTIONS[1]!, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
    await expect(apercu.locator("img[src='x'], svg[onload]")).toHaveCount(0);

    // Aucun des scripts injectés ne s'est exécuté, ni dans la page ni dans l'aperçu
    for (const cadre of page.frames()) {
      expect(await cadre.evaluate(() => (window as { injection?: string }).injection)).toBeUndefined();
    }
  });

  test("sans connexion, l'API refuse de donner les données", async ({ request }) => {
    for (const url of ["/api/sync/reference", "/api/affaires", "/api/admin/users"]) {
      expect((await request.get(url)).status(), url).toBe(401);
    }
  });

  test("le jeton de session n'est pas lisible par un script (cookie HttpOnly, rien dans le stockage local)", async ({
    page,
    context,
    affaire,
  }) => {
    await creerPvSurSite(page, affaire);
    const session = (await context.cookies()).filter((c) => c.path.startsWith("/api"));
    expect(session.length).toBeGreaterThan(0);
    for (const cookie of session) {
      expect(cookie.httpOnly, cookie.name).toBe(true);
      expect(cookie.sameSite, cookie.name).toBe("Strict");
    }
    const stockage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
    expect(stockage).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./); // forme d'un jeton JWT
  });
});
