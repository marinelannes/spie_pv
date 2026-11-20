import ExcelJS from "exceljs";
import type { CellValue, Workbook, Worksheet } from "exceljs";

/** Construction de classeurs de test qui reproduisent la structure de la liste E/S GAU11_AUT_009. */

export const EN_TETE_ES = ["CARTES", "TAG CELLULE / EQUIPEMENT", "TYPE", "COMMENTAIRE", "ADRESSE"];
export const EN_TETE_EQUIPEMENTS = [
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

export interface Cartouche {
  document?: string;
  affaire?: string;
  revision?: string;
  /** Colonne du cartouche (comme la colonne E des feuilles du fichier réel). */
  colonne?: number;
}

export function nouveauClasseur(): Workbook {
  return new ExcelJS.Workbook();
}

/** Cartouche des lignes 1 à 5 : « N° Document\n… », « N° AFF : … », « Statut : Rev … ». */
export function ajouterCartouche(ws: Worksheet, c: Cartouche = {}): void {
  const col = c.colonne ?? 5;
  ws.getCell(1, col).value = `N° Document\n${c.document ?? "GAU11_AUT_009"}`;
  ws.getCell(4, col).value = `N° AFF : ${c.affaire ?? "A35173"}`;
  ws.getCell(5, col).value = `Statut : Rev ${c.revision ?? "B"}`;
}

export interface OptionsFeuilleEs {
  ligneEnTete?: number;
  enTete?: (string | null)[];
  titre?: string;
  cartouche?: Cartouche | false;
}

export function feuilleEs(wb: Workbook, nom: string, lignes: CellValue[][], opts: OptionsFeuilleEs = {}): Worksheet {
  const ws = wb.addWorksheet(nom);
  const ligneEnTete = opts.ligneEnTete ?? 6;
  ws.getCell(1, 2).value = opts.titre ?? `LISTE DES ENTREES / SORTIES \nRELAIS PROTECTION NUMERIQUE\n${nom}`;
  if (opts.cartouche !== false) ajouterCartouche(ws, opts.cartouche || {});
  (opts.enTete ?? EN_TETE_ES).forEach((h, i) => {
    if (h !== null) ws.getCell(ligneEnTete, i + 1).value = h;
  });
  lignes.forEach((valeurs, k) => {
    valeurs.forEach((v, i) => {
      if (v !== undefined && v !== null) ws.getCell(ligneEnTete + 1 + k, i + 1).value = v;
    });
  });
  return ws;
}

/** Ligne d'équipement : LIBELLE, TYPE, TYPE CELLULE, TAG, EQUIPEMENT, MODELE, LOCAL, TAG ARMOIRE, REF. */
export type LigneEquipement = (string | null)[];

export function feuilleEquipements(
  wb: Workbook,
  lignes: LigneEquipement[],
  opts: { nom?: string; ligneEnTete?: number; cartouche?: Cartouche | false } = {},
): Worksheet {
  const ws = wb.addWorksheet(opts.nom ?? "LISTE DES EQUIPEMENTS");
  const ligneEnTete = opts.ligneEnTete ?? 6;
  ws.getCell(1, 2).value = "LISTE DES EQUIPEMENTS";
  if (opts.cartouche !== false) ajouterCartouche(ws, { ...(opts.cartouche || {}), colonne: 9 });
  EN_TETE_EQUIPEMENTS.forEach((h, i) => {
    ws.getCell(ligneEnTete, i + 1).value = h;
  });
  lignes.forEach((valeurs, k) => {
    valeurs.forEach((v, i) => {
      if (v !== null) ws.getCell(ligneEnTete + 1 + k, i + 1).value = v;
    });
  });
  return ws;
}

export const eq = (tag: string, typeCellule: string, libelle = `RELAIS ${tag}`, niveau = "HTA"): LigneEquipement => [
  libelle,
  niveau,
  typeCellule,
  tag,
  "RELAIS SIPROTEC 5",
  "COMPACT - 7SX8000",
  "LOCAL HTA",
  "ZN_HTA_1ESS01_C01",
  null,
];

export const es = (carte: string, tag: string, type: string, designation: string, adresse: string): CellValue[] => [
  carte,
  tag,
  type,
  designation,
  adresse,
];

export async function versOctets(wb: Workbook): Promise<Uint8Array> {
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

/** Classeur minimal valide : 3 équipements, une feuille TYPE BATTERIE. */
export function classeurStandard(): Workbook {
  const wb = nouveauClasseur();
  feuilleEquipements(wb, [
    eq("RPN_HTA_F1", "TYPE BATTERIE"),
    eq("RPN_HTA_F2", "TYPE BATTERIE"),
    eq("RGU_HTB_TR", "", "REGULATEUR", "HTB"),
  ]);
  feuilleEs(wb, "TYPE BATTERIE", [
    es("RPN_HTA / PS050_1", "-", "ENTREE TOR", "SURVEILLANCE CIRCUIT DECLENCHEMENT", "BI 1.01"),
    es("RPN_HTA / IO60_1", "-", "ENTREE TOR", "RESERVE", "BI 2.11"),
    es("RPN_HTA / PS050_1", "-", "SORTIE TOR", "DÉCLENCHEMENT DISJ. MBO1", "BO 1.01"),
    es("RPN_HTA / PS050_1", "-", "ENTREE ANALOGIQUE", "COURANT PHASE 1", "I1"),
  ]);
  return wb;
}
