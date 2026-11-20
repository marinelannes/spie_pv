import { preparerPv } from "../api";
import { ADRESSES_ES, RELAIS } from "../donnees";
import {
  SAISIE,
  TENSION_MESUREE,
  allerASection,
  attendreDepot,
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

test.describe("Parcours nominal", () => {
  test("créer un PV complet, le signer, le retrouver dans la liste et le rouvrir à l'identique", async ({
    page,
    affaire,
  }) => {
    // 1. Création sur site et saisie complète
    const numero = await creerPvSurSite(page, affaire);
    await expect(page.getByText("En cours de saisie")).toBeVisible();
    await remplirPvComplet(page);

    // 2. Signatures puis validation : le PV est figé et part vers le serveur
    await remplirSignatures(page);
    await boutonValider(page).tap();
    await expect(bandeauSigne(page)).toBeVisible();

    // 3. Enregistrement « cloud » : le serveur accuse réception…
    await expect(page.getByText("Reçu par le serveur")).toBeVisible();

    // 4. … puis dépose les fichiers dans SharePoint : on retrouve le PV, à jour, dans la liste de l'affaire
    await attendreDepot(page, affaire, numero);
    const ligne = page.getByRole("link", { name: new RegExp(numero) });

    // 5. … et à la réouverture, les données sont celles qui ont été saisies
    await ligne.tap();
    await expect(page.getByText("Ouvrir le PDF dans SharePoint")).toBeVisible();
    await expect(page.getByLabel("Lieu des tests")).toHaveValue(SAISIE.lieu);
    await expect(page.getByLabel("Dates des tests")).toHaveValue(SAISIE.dates);
    await allerASection(page, "Identification du relais");
    await expect(page.getByLabel(/Numéro de série/)).toHaveValue(SAISIE.numeroSerie);
    await allerASection(page, "Vérification des circuits de mesures");
    await expect(page.getByLabel(TENSION_MESUREE)).toHaveValue(SAISIE.tensionMesuree);
    await allerASection(page, "Affectation cartes E/S");
    await expect(
      page
        .getByRole("radiogroup", { name: `${ADRESSES_ES[0]} testé / validé` })
        .getByRole("radio", { name: "C", exact: true }),
    ).toBeChecked();
    await allerASection(page, "Observations");
    await expect(page.getByLabel("Observation 1 — texte")).toHaveValue(SAISIE.observation);
    await allerASection(page, "Conclusion générale des tests");
    await expect(page.getByRole("radio", { name: "Accepté" })).toBeChecked();

    // Un PV signé n'est plus modifiable
    await allerASection(page, "Généralités");
    await expect(page.getByLabel("Lieu des tests")).toBeDisabled();
  });

  test("un PV préparé au bureau arrive sur la tablette, prêt à être complété", async ({ page, request, affaire }) => {
    const prepare = await preparerPv(request, affaire);

    await seConnecter(page);
    await ouvrirAffaire(page, affaire);
    await expect(page.getByText(RELAIS.tag)).toBeVisible();
    const ligne = page.getByRole("link", { name: new RegExp(prepare.numero) });
    await expect(ligne).toContainText("préparé au bureau");

    await ligne.tap();
    await expect(page.getByText("En cours de saisie")).toBeVisible();
    await expect(page.getByRole("button", { name: /Ce qui manque \(\d+\)/ })).toBeVisible();
  });
});
