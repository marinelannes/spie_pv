import {
  TENSION_MESUREE,
  allerASection,
  attendreEnregistrement,
  boutonValider,
  creerPvSurSite,
  expect,
  remplirPvComplet,
  remplirSignatures,
  test,
} from "../outils";

test.describe("Validation des saisies", () => {
  test("champs obligatoires vides : « Ce qui manque » les nomme et la signature est bloquée", async ({
    page,
    affaire,
  }) => {
    await creerPvSurSite(page, affaire);

    await page.getByRole("button", { name: /Ce qui manque/ }).tap();
    await expect(page.getByText("Lieu des tests non renseigné.")).toBeVisible();
    await expect(page.getByText("Dates des tests non renseignées.")).toBeVisible();
    await expect(page.getByText("Conclusion générale (matériel accepté / refusé) absente.")).toBeVisible();

    await page.getByRole("button", { name: "Signer", exact: true }).tap();
    await expect(boutonValider(page)).toBeDisabled();
  });

  test("un champ rempli d'espaces compte comme vide", async ({ page, affaire }) => {
    await creerPvSurSite(page, affaire);
    await page.getByLabel("Lieu des tests").fill("   ");
    await page.getByRole("button", { name: /Ce qui manque/ }).tap();
    await expect(page.getByText("Lieu des tests non renseigné.")).toBeVisible();
  });

  test("valeur numérique invalide : signalée, jamais enregistrée ni effacée en silence", async ({ page, affaire }) => {
    await creerPvSurSite(page, affaire);
    await allerASection(page, "Vérification des circuits de mesures");
    const tension = page.getByLabel(TENSION_MESUREE);

    await tension.fill("57,7");
    await tension.fill("abc");
    await tension.blur();

    await expect(tension).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("Nombre attendu (ex. 57,7) : valeur enregistrée « 57,7 ».")).toBeVisible();
    await expect(tension).toHaveValue("abc");
  });

  test("nombre décimal : le point est accepté et réaffiché avec une virgule", async ({ page, affaire }) => {
    await creerPvSurSite(page, affaire);
    await allerASection(page, "Vérification des circuits de mesures");
    const tension = page.getByLabel(TENSION_MESUREE);

    await tension.fill("57.74");
    await tension.blur();
    await expect(tension).toHaveValue("57,74");
    await expect(tension).toHaveAttribute("aria-invalid", "false");
  });

  test("une non-conformité (NC) exige une observation", async ({ page, affaire }) => {
    await creerPvSurSite(page, affaire);
    await allerASection(page, "Identification de la configuration");
    await page.getByRole("radio", { name: "NC", exact: true }).tap();

    await page.getByRole("button", { name: /Ce qui manque/ }).tap();
    await expect(page.getByText("NC sans observation : Identification de la configuration")).toBeVisible();

    await page.getByLabel("Observation pour Identification de la configuration").fill("Fichier non conforme au plan.");
    await page.getByRole("button", { name: "Ajouter l'observation" }).tap();
    await expect(page.getByText("NC sans observation : Identification de la configuration")).toHaveCount(0);
  });

  test("accents, caractères spéciaux et texte très long sont conservés tels quels", async ({ page, affaire }) => {
    await creerPvSurSite(page, affaire);
    const special = "Poste « Élévation » n°2 — Ø 50 µm ; 20 °C ± 5 % & <test> 'ok' \"oui\" 日本 😀";
    const long = "Constat détaillé. ".repeat(600).trim(); // environ 10 000 caractères

    await page.getByLabel("Lieu des tests").fill(special);
    await allerASection(page, "Observations");
    await page.getByRole("button", { name: "Ajouter une observation" }).tap();
    await page.getByLabel("Observation 1 — texte").fill(long);
    await attendreEnregistrement(page);

    await page.reload();
    await expect(page.getByLabel("Observation 1 — texte")).toHaveValue(long);
    await allerASection(page, "Généralités");
    await expect(page.getByLabel("Lieu des tests")).toHaveValue(special);
  });

  test("signature : refus du client sans motif, ou date vidée, bloquent la validation", async ({ page, affaire }) => {
    await creerPvSurSite(page, affaire);
    await remplirPvComplet(page);
    await remplirSignatures(page);
    await expect(boutonValider(page)).toBeEnabled();

    // Le client refuse de signer : un motif devient obligatoire
    await page.getByLabel("Le client refuse de signer").check();
    await expect(page.getByText("Motif du refus de signer manquant.")).toBeVisible();
    await expect(boutonValider(page)).toBeDisabled();

    await page.getByLabel("Motif du refus de signer").fill("Absent le jour des essais.");
    await expect(boutonValider(page)).toBeEnabled();

    // Une date vidée est refusée
    await page.getByLabel("Date du refus").fill("");
    await expect(page.getByText("Date du refus de signer manquante.")).toBeVisible();
    await expect(boutonValider(page)).toBeDisabled();
  });
});
