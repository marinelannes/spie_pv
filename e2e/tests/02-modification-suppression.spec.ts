import { allerASection, attendreEnregistrement, creerPvSurSite, expect, ouvrirAffaire, test } from "../outils";

test.describe("Modification et suppression", () => {
  test("modifier un PV existant : la nouvelle valeur remplace l'ancienne", async ({ page, affaire }) => {
    const numero = await creerPvSurSite(page, affaire);
    await page.getByLabel("Lieu des tests").fill("Première saisie");
    await attendreEnregistrement(page);

    // On quitte le PV, on y revient, on corrige
    await ouvrirAffaire(page, affaire);
    await page.getByRole("link", { name: new RegExp(numero) }).tap();
    await expect(page.getByLabel("Lieu des tests")).toHaveValue("Première saisie");
    await page.getByLabel("Lieu des tests").fill("Saisie corrigée");
    await attendreEnregistrement(page);

    // Après rechargement complet de la page, c'est bien la correction qui est conservée
    await page.reload();
    await expect(page.getByLabel("Lieu des tests")).toHaveValue("Saisie corrigée");
  });

  test("ajouter puis supprimer une observation", async ({ page, affaire }) => {
    await creerPvSurSite(page, affaire);
    await allerASection(page, "Observations");
    await page.getByRole("button", { name: "Ajouter une observation" }).tap();
    await page.getByLabel("Observation 1 — texte").fill("Observation à retirer");
    await page.getByRole("button", { name: "Supprimer", exact: true }).tap();
    await expect(page.getByText("Aucune observation.")).toBeVisible();
  });

  test("supprimer un brouillon créé sur site : il disparaît de la liste", async ({ page, affaire }) => {
    const numero = await creerPvSurSite(page, affaire);
    await page.getByRole("button", { name: "Supprimer ce brouillon" }).tap();

    await expect(page.getByRole("heading", { name: new RegExp(affaire.numero) })).toBeVisible();
    await expect(page.getByText(numero)).toHaveCount(0);
    // L'équipement est de nouveau disponible pour un PV
    await expect(page.getByRole("button", { name: "Créer un PV sur site" })).toBeVisible();
  });
});
