import ExcelJS from "exceljs";

/**
 * Jeu de données des tests de bout en bout. Tout est FICTIF : aucun client, site, nom ou numéro d'affaire réel.
 * Les mots de passe ne valent que pour la base en mémoire du serveur de test, recréée à chaque exécution.
 */

export const PORT = 3310;

export const ADMIN = {
  email: "admin@exemple.test",
  nom: "Alex Administrateur",
  motDePasseProvisoire: "Provisoire-E2E-0000!",
  motDePasse: "Essai-E2E-Admin-0001!",
};

export const TECHNICIEN = {
  email: "technicien@exemple.test",
  nom: "Camille Technicien",
  motDePasse: "Essai-E2E-Tech-0001!",
};

export const AFFAIRE = {
  client: "CLIENT DÉMO SAS",
  projet: "Poste de démonstration",
  site: "SITE-DEMO",
  valideParDefaut: "V. Valideur",
  approuveParDefaut: "A. Approbateur",
};

/** Équipement utilisé par les tests : un relais de départ HTA et ses quatre entrées / sorties. */
export const RELAIS = { tag: "RPN_HTA_D1", libelle: "RELAIS DE PROTECTION NUMERIQUE DEPART D1" };
export const ADRESSES_ES = ["BI 1.01", "BI 1.02", "BO 1.01", "I1"];

/**
 * Liste d'entrées / sorties au format attendu par l'import (en-têtes en ligne 6, données à partir de la ligne 7),
 * encodée en base64 comme le fait le back-office.
 */
export async function classeurEs(numeroAffaire: string): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const cartouche = (ws: ExcelJS.Worksheet, colonne: string, titre: string) => {
    ws.getCell(colonne === "U" ? "F1" : "B1").value = titre;
    ws.getCell(`${colonne}1`).value = "N° Document\nDEMO_AUT_001";
    ws.getCell(`${colonne}4`).value = `N° AFF : ${numeroAffaire}`;
    ws.getCell(`${colonne}5`).value = "Statut : Rev A";
  };

  cartouche(wb.addWorksheet("REV"), "U", "LISTE ENTREES / SORTIES \nRPN");

  const equipements = wb.addWorksheet("LISTE DES EQUIPEMENTS");
  cartouche(equipements, "I", "LISTE DES EQUIPEMENTS");
  equipements.getRow(6).values = [
    "LIBELLE",
    "TYPE",
    "TYPE CELLULE",
    "TAG",
    "EQUIPEMENT",
    "MODELE",
    "LOCAL",
    "TAG ARMOIRE",
    "REFERENCE CONSTRUCTEUR",
  ];
  equipements.getRow(7).values = [
    RELAIS.libelle,
    "HTA",
    "TYPE DEPART",
    RELAIS.tag,
    "RELAIS DE DEMONSTRATION",
    "MODELE-DEMO-1",
    "LOCAL HTA",
    "ARMOIRE_DEMO_01",
  ];

  const feuille = wb.addWorksheet("TYPE DEPART");
  cartouche(feuille, "E", "LISTE DES ENTREES / SORTIES \nRELAIS PROTECTION NUMERIQUE\nTYPE DEPART");
  feuille.getRow(6).values = ["CARTES", "TAG CELLULE / EQUIPEMENT", "TYPE", "COMMENTAIRE", "ADRESSE"];
  [
    ["RPN_HTA / CARTE_1", "-", "ENTREE TOR", "POSITION DISJONCTEUR FERMÉ", ADRESSES_ES[0]],
    ["RPN_HTA / CARTE_1", "-", "ENTREE TOR", "DÉFAUT CIRCUIT DE DÉCLENCHEMENT", ADRESSES_ES[1]],
    ["RPN_HTA / CARTE_1", "-", "SORTIE TOR", "DÉCLENCHEMENT DISJONCTEUR", ADRESSES_ES[2]],
    ["RPN_HTA / CARTE_1", "-", "ENTREE ANALOGIQUE", "COURANT PHASE 1", ADRESSES_ES[3]],
  ].forEach((ligne, i) => (feuille.getRow(7 + i).values = ligne));

  return Buffer.from(await wb.xlsx.writeBuffer()).toString("base64");
}
