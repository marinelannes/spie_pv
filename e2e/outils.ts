import { test as base, expect, type Locator, type Page } from "@playwright/test";
import { creerAffaire, type AffaireDeTest } from "./api";
import { ADRESSES_ES, TECHNICIEN } from "./donnees";

/**
 * Gestes du technicien, réutilisés par tous les scénarios. Chaque fonction correspond à une action à l'écran :
 * un scénario se lit comme le mode opératoire.
 *
 * Rappel : l'application n'a pas de bouton « Enregistrer ». Chaque saisie est enregistrée automatiquement sur la
 * tablette (« Enregistré sur la tablette »), puis le PV signé est envoyé au serveur, qui le dépose dans SharePoint.
 */

/** `test` avec une affaire neuve par scénario, et les fenêtres de confirmation acceptées d'office. */
export const test = base.extend<{ affaire: AffaireDeTest }>({
  affaire: async ({ request }, use) => {
    await use(await creerAffaire(request));
  },
  page: async ({ page }, use) => {
    page.on("dialog", (dialogue) => void dialogue.accept());
    await use(page);
  },
});
export { expect };

export async function seConnecter(page: Page): Promise<void> {
  await page.goto("/connexion");
  await page.getByLabel("Adresse e-mail").fill(TECHNICIEN.email);
  await page.getByLabel("Mot de passe").fill(TECHNICIEN.motDePasse);
  await page.getByRole("button", { name: "Se connecter" }).tap();
  await expect(page.getByRole("heading", { name: "Mes affaires" })).toBeVisible();
}

/** Depuis « Mes affaires », ouvre l'affaire du scénario. */
export async function ouvrirAffaire(page: Page, affaire: AffaireDeTest): Promise<void> {
  await page.getByRole("link", { name: "Mes affaires" }).tap();
  await page.getByRole("link", { name: new RegExp(affaire.numero) }).tap();
  await expect(page.getByRole("heading", { name: new RegExp(affaire.numero) })).toBeVisible();
}

/** Connexion, ouverture de l'affaire et création d'un PV sur site. Renvoie le numéro du PV. */
export async function creerPvSurSite(page: Page, affaire: AffaireDeTest): Promise<string> {
  await seConnecter(page);
  await ouvrirAffaire(page, affaire);
  await page.getByRole("button", { name: "Créer un PV sur site" }).tap();
  await expect(page).toHaveURL(/\/pv\//);
  return (await page.getByRole("heading", { level: 1 }).innerText()).trim();
}

/** Change de section par la barre des sections (ex. « Généralités », « Observations »). */
export async function allerASection(page: Page, titre: string): Promise<void> {
  await page.getByRole("navigation", { name: "Sections du PV" }).getByRole("button", { name: titre }).tap();
  await expect(page.getByRole("heading", { level: 2, name: titre })).toBeVisible();
}

/** Attend la fin de l'enregistrement automatique. */
export async function attendreEnregistrement(page: Page): Promise<void> {
  await expect(page.getByText("Enregistré sur la tablette")).toBeVisible();
}

/** Appuie sur « C » (conforme) pour tous les contrôles de la section affichée qui n'ont pas encore de jugement. */
export async function toutJugerConforme(page: Page): Promise<void> {
  const sansJugement = page
    .getByRole("radiogroup")
    .filter({ hasNot: page.getByRole("radio", { checked: true }) })
    .getByRole("radio", { name: "C", exact: true });
  while ((await sansJugement.count()) > 0) await sansJugement.first().tap();
}

/** Valeurs saisies par `remplirPvComplet`, pour les comparer à la réouverture. */
export const SAISIE = {
  lieu: "Poste de démonstration — local HTA",
  dates: "Semaine 47 (du 17 au 19/11/2026)",
  numeroSerie: "SN-DEMO-000123",
  tensionAuxiliaire: "125 V",
  fichierParametrage: "DEMO_RPN_HTA_D1.cfg",
  tensionMesuree: "57,7",
  observation: "Câble repéré « D1-É » à remplacer : gaine abîmée côté bornier.",
};

/** Libellé (accessible) de la tension mesurée sur la phase A : le champ numérique utilisé par les scénarios. */
export const TENSION_MESUREE = "Système équilibré phase A — V mesurée — amplitude (V)";

/** Remplit tout ce que l'application exige avant la signature (bouton « Ce qui manque »). */
export async function remplirPvComplet(page: Page): Promise<void> {
  await allerASection(page, "Généralités");
  await page.getByLabel("Lieu des tests").fill(SAISIE.lieu);
  await page.getByLabel("Dates des tests").fill(SAISIE.dates);

  await allerASection(page, "Identification du relais");
  await page.getByLabel(/Numéro de série/).fill(SAISIE.numeroSerie);

  await allerASection(page, "Tests préliminaires");
  await page
    .getByLabel("Mesure de la tension d'alimentation auxiliaire — valeur relevée")
    .fill(SAISIE.tensionAuxiliaire);
  await toutJugerConforme(page);

  await allerASection(page, "Identification de la configuration");
  await page.getByLabel(/Nom du fichier de paramétrage/).fill(SAISIE.fichierParametrage);
  await toutJugerConforme(page);

  await allerASection(page, "Vérification des circuits de mesures");
  await page.getByLabel(TENSION_MESUREE).fill(SAISIE.tensionMesuree);
  await toutJugerConforme(page);

  // Les E/S sont dans une liste défilante : on cherche chaque adresse, puis on la juge.
  await allerASection(page, "Affectation cartes E/S");
  for (const adresse of ADRESSES_ES) {
    await page.getByLabel("Rechercher une E/S").fill(adresse);
    await page
      .getByRole("radiogroup", { name: `${adresse} testé / validé` })
      .getByRole("radio", { name: "C", exact: true })
      .tap();
  }
  await expect(page.getByText("4 / 4 E/S testées")).toBeVisible();

  await allerASection(page, "Observations");
  await page.getByRole("button", { name: "Ajouter une observation" }).tap();
  await page.getByLabel("Observation 1 — libellé du contrôle").fill("Contrôle visuel du câblage");
  await page.getByLabel("Observation 1 — texte").fill(SAISIE.observation);

  await allerASection(page, "Conclusion générale des tests");
  await page.getByRole("radio", { name: "Accepté" }).tap();

  await expect(page.getByRole("button", { name: "Ce qui manque (0)" })).toBeVisible();
  await attendreEnregistrement(page);
}

/** Trace un trait dans un cadre de signature, comme au doigt. */
export async function dessinerSignature(page: Page, cadre: Locator): Promise<void> {
  await cadre.scrollIntoViewIfNeeded();
  const zone = (await cadre.boundingBox())!;
  const y = zone.y + zone.height / 2;
  await page.mouse.move(zone.x + 40, y);
  await page.mouse.down();
  await page.mouse.move(zone.x + 120, y - 30, { steps: 5 });
  await page.mouse.move(zone.x + 200, y + 20, { steps: 5 });
  await page.mouse.up();
}

/** Étape « Signer » : statut du document, signatures SPIE et client. S'arrête avant la validation. */
export async function remplirSignatures(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Signer", exact: true }).tap();
  await expect(page.getByRole("heading", { name: /Signature du PV/ })).toBeVisible();
  await page.getByRole("radio", { name: "BPE" }).tap();
  await dessinerSignature(page, page.getByLabel("Signature SPIE"));
  await page.getByRole("heading", { name: "Client" }).locator("..").getByLabel("Nom").fill("Dominique Client");
  await dessinerSignature(page, page.getByLabel("Visa / signature du client"));
}

export const boutonValider = (page: Page) => page.getByRole("button", { name: "Valider et figer le PV" });

/** Bandeau du PV signé et figé. */
export const bandeauSigne = (page: Page) => page.getByText(/PV signé le .* : il ne peut plus être modifié/);

/**
 * Le dépôt SharePoint se fait en arrière-plan, quelques secondes après la réception : on synchronise depuis
 * « Mes affaires » jusqu'à ce que le PV apparaisse « Déposé dans SharePoint » dans la liste de l'affaire.
 */
export async function attendreDepot(page: Page, affaire: AffaireDeTest, numero: string): Promise<void> {
  await expect(async () => {
    await page.getByRole("link", { name: "Mes affaires" }).tap();
    await page.getByRole("button", { name: "Synchroniser" }).tap();
    await expect(page.getByRole("button", { name: "Synchroniser" })).toBeEnabled();
    await ouvrirAffaire(page, affaire);
    await expect(page.getByRole("link", { name: new RegExp(numero) })).toContainText("Déposé dans SharePoint", {
      timeout: 1_000,
    });
  }).toPass({ timeout: 45_000 });
}
