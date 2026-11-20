import type { Page } from "@playwright/test";
import {
  SAISIE,
  allerASection,
  attendreEnregistrement,
  bandeauSigne,
  boutonValider,
  creerPvSurSite,
  expect,
  remplirPvComplet,
  remplirSignatures,
  test,
} from "../outils";

/** L'application est installée (service worker actif) : elle peut alors s'ouvrir sans réseau. */
async function attendreApplicationInstallee(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
}

test.describe("Hors ligne et rechargement", () => {
  test("le réseau tombe en pleine saisie : on continue, et rien n'est perdu au rechargement", async ({
    page,
    context,
    affaire,
  }) => {
    await creerPvSurSite(page, affaire);
    await attendreApplicationInstallee(page);
    await page.getByLabel("Lieu des tests").fill("Saisi avec le réseau");

    await context.setOffline(true);
    await page.getByLabel("Dates des tests").fill("Saisi sans réseau");
    await attendreEnregistrement(page);

    // Rechargement complet, toujours sans réseau : l'application et la saisie sont là
    await page.reload();
    await expect(page.getByLabel("Lieu des tests")).toHaveValue("Saisi avec le réseau");
    await expect(page.getByLabel("Dates des tests")).toHaveValue("Saisi sans réseau");

    // La saisie reste possible
    await allerASection(page, "Conclusion générale des tests");
    await page.getByRole("radio", { name: "Accepté" }).tap();
    await attendreEnregistrement(page);
  });

  test("signer sans réseau : le PV attend, puis part tout seul à la reconnexion", async ({
    page,
    context,
    affaire,
  }) => {
    await creerPvSurSite(page, affaire);
    await remplirPvComplet(page);

    await context.setOffline(true);
    await remplirSignatures(page);
    await boutonValider(page).tap();
    await expect(bandeauSigne(page)).toBeVisible();
    await expect(page.getByText("Signé, en attente d'envoi")).toBeVisible();

    await context.setOffline(false);
    await expect(page.getByText("Reçu par le serveur")).toBeVisible();
  });

  test("rechargement de la page juste après une frappe : la saisie est conservée", async ({ page, affaire }) => {
    await creerPvSurSite(page, affaire);
    await page.getByLabel("Lieu des tests").fill(SAISIE.lieu);
    // Pas d'attente : on recharge avant la fin de l'enregistrement automatique.
    await page.reload();
    await expect(page.getByLabel("Lieu des tests")).toHaveValue(SAISIE.lieu);
  });

  test("rechargement à l'étape de signature : statut, noms et signatures déjà saisis sont conservés", async ({
    page,
    affaire,
  }) => {
    await creerPvSurSite(page, affaire);
    await remplirPvComplet(page);
    await remplirSignatures(page);
    await expect(boutonValider(page)).toBeEnabled();

    await page.reload();
    await expect(page.getByRole("radio", { name: "BPE" })).toBeChecked();
    await expect(page.getByRole("img", { name: "Signature SPIE" })).toBeVisible();
    await expect(page.getByRole("img", { name: "Visa / signature du client" })).toBeVisible();
    await expect(boutonValider(page)).toBeEnabled();
  });
});
