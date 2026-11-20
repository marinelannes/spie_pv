import type { Page } from "@playwright/test";
import type { AffaireDeTest } from "../api";
import {
  SAISIE,
  bandeauSigne,
  boutonValider,
  creerPvSurSite,
  expect,
  ouvrirAffaire,
  remplirPvComplet,
  remplirSignatures,
  seConnecter,
  test,
} from "../outils";

/**
 * Envoi du PV signé au serveur (« enregistrement cloud »). Le cas du succès est le parcours nominal (01).
 * Ici on simule les pannes : dans tous les cas l'utilisateur est prévenu et le PV signé reste sur la tablette.
 */

/** Adresse appelée par la tablette pour envoyer un PV signé. */
const ENVOI_PV = "**/api/pv-versions/*";

async function signerUnPv(page: Page, affaire: AffaireDeTest): Promise<string> {
  const numero = await creerPvSurSite(page, affaire);
  await remplirPvComplet(page);
  await remplirSignatures(page);
  await boutonValider(page).tap();
  await expect(bandeauSigne(page)).toBeVisible();
  return numero;
}

async function synchroniser(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Mes affaires" }).tap();
  await page.getByRole("button", { name: "Synchroniser" }).tap();
}

/** Après la panne : le PV est toujours là, intact, et part au prochain essai. */
async function verifierRienDePerduPuisRenvoyer(page: Page, affaire: AffaireDeTest, numero: string): Promise<void> {
  await page.unroute(ENVOI_PV);
  await synchroniser(page);
  await expect(page.getByText("PV en attente d'envoi : 0")).toBeVisible();
  await ouvrirAffaire(page, affaire);
  await page.getByRole("link", { name: new RegExp(numero) }).tap();
  await expect(page.getByText(/Reçu par le serveur|Déposé dans SharePoint/).first()).toBeVisible();
  await expect(page.getByLabel("Lieu des tests")).toHaveValue(SAISIE.lieu);
}

test.describe("Envoi au serveur : pannes", () => {
  test("échec réseau : le PV reste « en attente d'envoi », puis part au retour du réseau", async ({
    page,
    affaire,
  }) => {
    await page.route(ENVOI_PV, (requete) => requete.abort("connectionfailed"));
    const numero = await signerUnPv(page, affaire);

    await expect(page.getByText("Signé, en attente d'envoi")).toBeVisible();
    await synchroniser(page);
    await expect(page.getByText("PV en attente d'envoi : 1")).toBeVisible();
    await expect(page.getByText(/Serveur injoignable : les PV restent sur la tablette/)).toBeVisible();

    await verifierRienDePerduPuisRenvoyer(page, affaire, numero);
  });

  test("erreur du serveur (500) : l'erreur est affichée sur le PV, qui sera renvoyé", async ({ page, affaire }) => {
    await page.route(ENVOI_PV, (requete) =>
      requete.fulfill({
        status: 500,
        json: { error: { code: "internal", message: "Erreur interne du serveur." } },
      }),
    );
    const numero = await signerUnPv(page, affaire);

    await expect(page.getByRole("alert").filter({ hasText: "Erreur interne du serveur." })).toBeVisible();
    await expect(page.getByText("Signé, en attente d'envoi")).toBeVisible();

    await verifierRienDePerduPuisRenvoyer(page, affaire, numero);
  });

  test("refus du serveur (409) : le PV est marqué refusé, avec un bouton « Réessayer l'envoi »", async ({
    page,
    affaire,
  }) => {
    await page.route(ENVOI_PV, (requete) =>
      requete.fulfill({ status: 409, json: { error: { code: "conflict", message: "Numéro de PV déjà utilisé." } } }),
    );
    const numero = await signerUnPv(page, affaire);

    await expect(page.getByText("Conflit : Numéro de PV déjà utilisé.")).toBeVisible();
    await synchroniser(page);
    await expect(page.getByText("(1 refusé(s))")).toBeVisible();

    // Le problème est corrigé côté serveur : le technicien relance l'envoi depuis le PV
    await page.unroute(ENVOI_PV);
    await ouvrirAffaire(page, affaire);
    await page.getByRole("link", { name: new RegExp(numero) }).tap();
    await page.getByRole("button", { name: "Réessayer l'envoi" }).tap();
    await synchroniser(page);
    await expect(page.getByText("PV en attente d'envoi : 0")).toBeVisible();
  });

  test("serveur qui ne répond pas (timeout) : la synchronisation abandonne et le dit", async ({ page }) => {
    test.slow(); // le délai d'abandon est de 30 secondes
    await seConnecter(page);
    await expect(page.getByText("Prêt pour le hors ligne")).toBeVisible();

    // À partir de maintenant, le serveur reçoit les requêtes mais ne répond plus
    await page.route("**/api/sync/**", () => undefined);
    await page.getByRole("button", { name: "Synchroniser" }).tap();

    await expect(page.getByText(/Serveur injoignable : les PV restent sur la tablette/)).toBeVisible({
      timeout: 40_000,
    });
    await expect(page.getByRole("button", { name: "Synchroniser" })).toBeEnabled();
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });
});

test.describe("Pas de doublon", () => {
  test("double appui sur « Créer un PV sur site » : un seul PV", async ({ page, affaire }) => {
    await seConnecter(page);
    await ouvrirAffaire(page, affaire);
    await page.getByRole("button", { name: "Créer un PV sur site" }).dblclick();
    await expect(page).toHaveURL(/\/pv\//);

    await ouvrirAffaire(page, affaire);
    await expect(page.getByRole("link", { name: new RegExp(`${affaire.numero}-\\d{8}`) })).toHaveCount(1);
  });

  test("double appui sur « Valider et figer le PV » : un seul envoi au serveur", async ({ page, affaire }) => {
    const envois: string[] = [];
    page.on("request", (requete) => {
      if (requete.method() === "PUT" && requete.url().includes("/api/pv-versions/")) envois.push(requete.url());
    });

    const numero = await creerPvSurSite(page, affaire);
    await remplirPvComplet(page);
    await remplirSignatures(page);
    await boutonValider(page).dblclick();

    await expect(page.getByText("Reçu par le serveur")).toBeVisible();
    expect(envois).toHaveLength(1);
    await ouvrirAffaire(page, affaire);
    await expect(page.getByRole("link", { name: new RegExp(numero) })).toHaveCount(1);
  });
});
