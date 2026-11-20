// Import des listes d'entrées/sorties (spec §4.4) et export XLSX des résultats (spec §5.1). Côté serveur uniquement
// (exceljs, Buffer Node).
export { texteCellule, texteLigne, lettreColonne } from "./cellules.js";
export { lireListeEs } from "./lecture.js";
export {
  proposerAssociations,
  analyserImport,
  associationsAReprendre,
  type AssociationActuelle,
} from "./associations.js";
export {
  exporterResultatsEs,
  formaterDateHeureParis,
  nomFeuilleExcel,
  COLONNES_EXPORT,
  LIGNE_EN_TETE_EXPORT,
  FOND_NC,
} from "./export.js";
