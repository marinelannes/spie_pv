import { TIME_ZONE, TYPE_ES_LABELS, type PvDocument } from "@spie/shared";
import ExcelJS from "exceljs";
import type { Borders, Cell, Fill } from "exceljs";

/**
 * Fichier XLSX déposé à côté du PDF (spec §5.1, §4.4 « Restitution ») : la feuille d'E/S de l'équipement,
 * complétée des colonnes de résultats saisies sur la tablette.
 */

export const COLONNES_EXPORT = [
  { titre: "CARTES", largeur: 22 },
  { titre: "TAG CELLULE / EQUIPEMENT", largeur: 26 },
  { titre: "TYPE", largeur: 18 },
  { titre: "COMMENTAIRE", largeur: 48 },
  { titre: "ADRESSE", largeur: 12 },
  { titre: "RÉSERVE", largeur: 10 },
  { titre: "TESTÉ / VALIDÉ", largeur: 10 },
  { titre: "LED ACTIVÉES", largeur: 10 },
  { titre: "RELAIS ACTIVÉS", largeur: 10 },
  { titre: "REMONTÉE SCADA", largeur: 10 },
  { titre: "MESSAGE SUPERVISION", largeur: 36 },
  { titre: "COMMENTAIRE ESSAI", largeur: 36 },
  { titre: "SAISI PAR", largeur: 20 },
  { titre: "SAISI LE", largeur: 20 },
] as const;

export const LIGNE_EN_TETE_EXPORT = 6;

/** Rouge clair (fond) et rouge foncé (texte) : mise en forme « mauvais » d'Excel. */
export const FOND_NC = "FFFFC7CE";
const TEXTE_NC = "FF9C0006";
const FOND_EN_TETE = "FFD9E1F2";

const dateHeureParis = new Intl.DateTimeFormat("fr-FR", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** « 19/11/2026 14:32:05 » (heure de Paris). Texte plutôt que date Excel : une date Excel n'a pas de fuseau. */
export function formaterDateHeureParis(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : dateHeureParis.format(d).replace(",", "");
}

/** Nom de feuille Excel : 31 caractères au plus, sans `\ / ? * [ ] :`, ni apostrophe en début ou fin. */
export function nomFeuilleExcel(nom: string): string {
  const n = nom
    .replace(/[\\/?*[\]:]/g, "-")
    .replace(/^'+|'+$/g, "")
    .trim()
    .slice(0, 31)
    .trim();
  return n || "E-S";
}

const bordure: Partial<Borders> = {
  top: { style: "thin" },
  left: { style: "thin" },
  bottom: { style: "thin" },
  right: { style: "thin" },
};

const remplissage = (argb: string): Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });

function marquerNc(cell: Cell) {
  cell.fill = remplissage(FOND_NC);
  cell.font = { color: { argb: TEXTE_NC }, bold: true };
}

export async function exporterResultatsEs(doc: PvDocument): Promise<Uint8Array> {
  const { es, entete } = doc.donnees;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Plateforme PV SPIE";
  const genere = new Date(doc.meta.genereLe);
  if (!Number.isNaN(genere.getTime())) {
    wb.created = genere;
    wb.modified = genere;
  }
  const ws = wb.addWorksheet(nomFeuilleExcel(es.feuille), {
    views: [{ state: "frozen", ySplit: LIGNE_EN_TETE_EXPORT, xSplit: 0 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });
  const nbCol = COLONNES_EXPORT.length;
  COLONNES_EXPORT.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.largeur;
  });

  const eq = doc.equipement;
  const cartouche = [
    `LISTE DES ENTRÉES / SORTIES — RÉSULTATS DES ESSAIS${es.feuille ? ` — ${es.feuille}` : ""}`,
    `N° Document : ${es.referenceDocument || entete.numeroDocument || "—"}`,
    `N° AFF : ${doc.affaire.numero}`,
    `Liste E/S : révision ${es.revision || "—"}${es.listeVersion ? ` (version ${es.listeVersion})` : ""}${
      es.filtreTag ? ` — partie « ${es.filtreTag} »` : ""
    }`,
    `PV n° ${doc.pv.numero} — indice ${doc.version.indice}${eq ? ` — équipement ${eq.tag}${eq.libelle ? ` (${eq.libelle})` : ""}` : ""}`,
  ];
  cartouche.forEach((texte, i) => {
    const r = i + 1;
    ws.mergeCells(r, 1, r, nbCol);
    const cell = ws.getCell(r, 1);
    cell.value = texte;
    cell.font = i === 0 ? { bold: true, size: 14 } : { bold: i === 4, size: 11 };
  });

  const enTete = ws.getRow(LIGNE_EN_TETE_EXPORT);
  COLONNES_EXPORT.forEach((c, i) => {
    const cell = enTete.getCell(i + 1);
    cell.value = c.titre;
    cell.font = { bold: true };
    cell.fill = remplissage(FOND_EN_TETE);
    cell.border = bordure;
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  enTete.height = 30;

  es.points.forEach((p, i) => {
    const row = ws.getRow(LIGNE_EN_TETE_EXPORT + 1 + i);
    const valeurs = [
      p.carte,
      p.tag,
      TYPE_ES_LABELS[p.type],
      p.designation,
      p.adresse,
      p.reserve ? "Oui" : "",
      p.teste ?? "",
      p.leds ?? "",
      p.relais ?? "",
      p.scada ?? "",
      p.message,
      p.commentaire,
      p.saisie?.par ?? "",
      p.saisie ? formaterDateHeureParis(p.saisie.le) : "",
    ];
    valeurs.forEach((v, k) => {
      const cell = row.getCell(k + 1);
      cell.value = v;
      cell.border = bordure;
      cell.alignment = { vertical: "top", wrapText: k === 3 || k === 10 || k === 11 };
      if (v === "NC" || v === "NOK") marquerNc(cell);
    });
  });

  const derniere = LIGNE_EN_TETE_EXPORT + Math.max(es.points.length, 0);
  ws.autoFilter = { from: { row: LIGNE_EN_TETE_EXPORT, column: 1 }, to: { row: derniere, column: nbCol } };

  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}
