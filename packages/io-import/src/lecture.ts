import {
  estCommentaireReserve,
  normaliserAdresse,
  normaliserTexte,
  normaliserTypeEs,
  type AnomalieImport,
  type EquipementLu,
  type FeuilleEsLue,
  type ListeEsLue,
  type PointEsLu,
} from "@spie/shared";
import ExcelJS from "exceljs";
import type { Worksheet } from "exceljs";
import { lettreColonne, texteCellule, texteLigne } from "./cellules.js";

/**
 * Lecture d'une « Liste entrées / sorties » (spec §4.4), ex. `GAU11_AUT_009_LISTE ENTREES SORTIES RPN_B.xlsx` :
 * - référence, révision et n° d'affaire dans les en-têtes des feuilles (« N° Document », « Statut : Rev B »,
 *   « N° AFF : A35173 »), avec repli sur la page de garde `PdG_Client` ;
 * - feuille `LISTE DES EQUIPEMENTS` : une ligne par équipement ;
 * - une feuille par type de cellule ou tranche : une ligne par E/S.
 *
 * Choix de lecture (rapportés dans les anomalies) :
 * - la ligne d'en-tête est cherchée dans les 15 premières lignes, jamais supposée en ligne 6 ;
 * - une ligne sans adresse ou sans type n'est pas importée (une E/S n'est pas vérifiable sans adresse ni type) ;
 *   une ligne sans désignation ou sans carte est importée avec un avertissement ;
 * - une ligne de type inconnu n'est pas importée ;
 * - sans colonne « TYPE », la colonne dont les valeurs sont majoritairement des types connus est retenue
 *   (cas de `HTB_TR1`, où l'en-tête de cette colonne est « TAG RPN »).
 */

const LIGNES_EN_TETE_MAX = 15;
const LIGNES_REFERENCE = 5;

type Anomalies = AnomalieImport[];

const cellule = (ws: Worksheet, r: number, c: number) => texteCellule(ws.getRow(r).getCell(c).value);

const colonnesParFeuille = new WeakMap<Worksheet, number>();

/** Nombre de colonnes (calculé une fois : `columnCount` parcourt toutes les lignes à chaque appel). */
function nbColonnes(ws: Worksheet): number {
  let n = colonnesParFeuille.get(ws);
  if (n === undefined) {
    n = Math.max(ws.columnCount, 1);
    colonnesParFeuille.set(ws, n);
  }
  return n;
}

/** Valeurs normalisées des cellules d'une ligne, indexées par n° de colonne. */
function enTetes(ws: Worksheet, r: number): Map<number, string> {
  const out = new Map<number, string>();
  for (let c = 1; c <= nbColonnes(ws); c++) {
    const v = normaliserTexte(cellule(ws, r, c));
    if (v) out.set(c, v);
  }
  return out;
}

function chercherLigneEnTete(ws: Worksheet, accepte: (valeurs: string[]) => boolean): number | null {
  const max = Math.min(LIGNES_EN_TETE_MAX, ws.rowCount);
  for (let r = 1; r <= max; r++) {
    if (accepte([...enTetes(ws, r).values()])) return r;
  }
  return null;
}

const estEnTeteEs = (v: string[]) =>
  v.some((x) => x.startsWith("ADRESSE")) && v.some((x) => x.startsWith("CARTE") || x.startsWith("COMMENTAIRE"));

const estEnTeteEquipements = (v: string[]) =>
  v.includes("TAG") && (v.includes("LIBELLE") || v.includes("TYPE CELLULE"));

const NOM_EQUIPEMENTS = "LISTE DES EQUIPEMENTS";

// --- Référence, révision, n° d'affaire -------------------------------------------------------------------------

const RE_DOCUMENT = /N\s*[°º]?\s*(?:de\s+)?doc(?:ument)?\s*[:.]?\s*([A-Za-z0-9][A-Za-z0-9_.-]*)/i;
const RE_AFFAIRE = /N\s*[°º]?\s*AFF(?:AIRE)?\s*[:.]?\s*([A-Za-z0-9][A-Za-z0-9_-]*)/i;
const RE_REVISION = /statut\s*:?\s*r[eé]v(?:ision)?\.?\s*:?\s*([A-Za-z0-9]{1,4})\b/i;

function plusFrequent(valeurs: string[]): string {
  const n = new Map<string, number>();
  for (const v of valeurs) n.set(v, (n.get(v) ?? 0) + 1);
  let best = "";
  let max = 0;
  for (const [v, c] of n) {
    if (c > max) {
      best = v;
      max = c;
    }
  }
  return best;
}

function lireIdentite(wb: ExcelJS.Workbook): { reference: string; revision: string; numeroAffaire: string } {
  const refs: string[] = [];
  const revs: string[] = [];
  const affs: string[] = [];
  for (const ws of wb.worksheets) {
    const max = Math.min(LIGNES_REFERENCE, ws.rowCount);
    for (let r = 1; r <= max; r++) {
      for (let c = 1; c <= nbColonnes(ws); c++) {
        const t = cellule(ws, r, c);
        if (!t) continue;
        const doc = RE_DOCUMENT.exec(t);
        if (doc) refs.push(doc[1]!.toUpperCase());
        const aff = RE_AFFAIRE.exec(t);
        if (aff) affs.push(aff[1]!.toUpperCase());
        const rev = RE_REVISION.exec(t);
        if (rev) revs.push(rev[1]!.toUpperCase());
      }
    }
  }
  let reference = plusFrequent(refs);
  let revision = plusFrequent(revs);
  if (!reference || !revision) {
    const pdg = wb.worksheets.find((w) => normaliserTexte(w.name).startsWith("PDG"));
    if (pdg) {
      if (!reference) reference = referencePageDeGarde(pdg);
      if (!revision) revision = revisionPageDeGarde(pdg);
    }
  }
  return { reference, revision, numeroAffaire: plusFrequent(affs) };
}

/** Page de garde : la référence est un code du type `GAU11_AUT_009` dans le cartouche. */
function referencePageDeGarde(ws: Worksheet): string {
  const max = Math.min(10, ws.rowCount);
  for (let r = 1; r <= max; r++) {
    for (let c = 1; c <= nbColonnes(ws); c++) {
      const m = /\b([A-Z0-9]{2,}(?:_[A-Z0-9]+){2,})\b/.exec(cellule(ws, r, c).toUpperCase());
      if (m) return m[1]!;
    }
  }
  return "";
}

/**
 * Page de garde : tableau des révisions sous l'en-tête « INDICE », la plus récente en haut (ex. B au-dessus de A).
 * On remonte depuis l'en-tête tant que les cellules ressemblent à un indice.
 */
function revisionPageDeGarde(ws: Worksheet): string {
  for (let r = 1; r <= ws.rowCount; r++) {
    for (let c = 1; c <= nbColonnes(ws); c++) {
      if (normaliserTexte(cellule(ws, r, c)) !== "INDICE") continue;
      let derniere = "";
      for (let k = r - 1; k >= 1 && k >= r - 26; k--) {
        const v = texteLigne(ws.getRow(k).getCell(c).value);
        if (!/^[A-Z0-9]{1,4}$/i.test(v)) break;
        derniere = v.toUpperCase();
      }
      if (derniere) return derniere;
    }
  }
  return "";
}

// --- Équipements ------------------------------------------------------------------------------------------------

const COLONNES_EQUIPEMENT: Record<string, keyof Omit<EquipementLu, "ligne">> = {
  LIBELLE: "libelle",
  TYPE: "niveauTension",
  "TYPE CELLULE": "typeCellule",
  TAG: "tag",
  EQUIPEMENT: "equipement",
  MODELE: "modele",
  LOCAL: "local",
  "TAG ARMOIRE": "tagArmoire",
  "REFERENCE CONSTRUCTEUR": "referenceConstructeur",
};

function lireEquipements(ws: Worksheet, anomalies: Anomalies): EquipementLu[] {
  const ligneEnTete = chercherLigneEnTete(ws, estEnTeteEquipements);
  if (ligneEnTete === null) {
    anomalies.push({
      code: "en_tete_introuvable",
      severite: "erreur",
      feuille: ws.name,
      ligne: null,
      message: "En-tête de la liste des équipements introuvable (colonnes LIBELLE, TAG, TYPE CELLULE…).",
    });
    return [];
  }
  const colonnes = new Map<keyof Omit<EquipementLu, "ligne">, number>();
  for (const [c, h] of enTetes(ws, ligneEnTete)) {
    const champ = COLONNES_EQUIPEMENT[h];
    if (champ && !colonnes.has(champ)) colonnes.set(champ, c);
  }

  const out: EquipementLu[] = [];
  const parTag = new Map<string, number>();
  const parLibelle = new Map<string, EquipementLu>();
  for (let r = ligneEnTete + 1; r <= ws.rowCount; r++) {
    const lu = (champ: keyof Omit<EquipementLu, "ligne">) => {
      const c = colonnes.get(champ);
      return c === undefined ? "" : texteLigne(ws.getRow(r).getCell(c).value);
    };
    const eq: EquipementLu = {
      ligne: r,
      libelle: lu("libelle"),
      niveauTension: lu("niveauTension"),
      typeCellule: lu("typeCellule"),
      tag: lu("tag"),
      equipement: lu("equipement"),
      modele: lu("modele"),
      local: lu("local"),
      tagArmoire: lu("tagArmoire"),
      referenceConstructeur: lu("referenceConstructeur"),
    };
    const { ligne: _l, ...valeurs } = eq;
    if (Object.values(valeurs).every((v) => v === "")) continue;
    if (!eq.tag) {
      anomalies.push({
        code: "ligne_incomplete",
        severite: "avertissement",
        feuille: ws.name,
        ligne: r,
        message: `Équipement sans TAG${eq.libelle ? ` (« ${eq.libelle} »)` : ""} : ligne ignorée.`,
      });
      continue;
    }
    const tagNorm = normaliserTexte(eq.tag);
    const dejaLigne = parTag.get(tagNorm);
    if (dejaLigne !== undefined) {
      anomalies.push({
        code: "tag_equipement_en_double",
        severite: "erreur",
        feuille: ws.name,
        ligne: r,
        message: `TAG « ${eq.tag} » en double (déjà ligne ${dejaLigne}) : ligne ignorée.`,
      });
      continue;
    }
    parTag.set(tagNorm, r);
    if (eq.libelle) {
      const libNorm = normaliserTexte(eq.libelle);
      const autre = parLibelle.get(libNorm);
      if (autre) {
        anomalies.push({
          code: "libelle_equipement_en_double",
          severite: "avertissement",
          feuille: ws.name,
          ligne: r,
          message: `Libellé « ${eq.libelle} » identique à celui de ${autre.tag} (ligne ${autre.ligne}) : vérifier le libellé de ${eq.tag}.`,
        });
      } else {
        parLibelle.set(libNorm, eq);
      }
    }
    out.push(eq);
  }
  return out;
}

// --- Feuilles d'E/S ---------------------------------------------------------------------------------------------

interface ColonnesEs {
  carte: number | null;
  tag: number | null;
  type: number | null;
  designation: number | null;
  adresse: number;
}

/** Part des valeurs non vides d'une colonne qui sont des types d'E/S connus. */
function partTypesConnus(ws: Worksheet, c: number, debut: number): number {
  let n = 0;
  let connus = 0;
  for (let r = debut; r <= ws.rowCount; r++) {
    const v = texteLigne(ws.getRow(r).getCell(c).value);
    if (!v) continue;
    n++;
    if (normaliserTypeEs(v)) connus++;
  }
  return n === 0 ? 0 : connus / n;
}

function colonnesEs(ws: Worksheet, ligneEnTete: number, anomalies: Anomalies): ColonnesEs | null {
  const h = enTetes(ws, ligneEnTete);
  const trouver = (pred: (v: string) => boolean, exclues: (number | null)[] = []) => {
    for (const [c, v] of h) if (!exclues.includes(c) && pred(v)) return c;
    return null;
  };
  const adresse = trouver((v) => v.startsWith("ADRESSE"));
  if (adresse === null) return null;
  const designation = trouver(
    (v) => v.startsWith("COMMENTAIRE") || v.startsWith("DESIGNATION") || v.startsWith("LIBELLE"),
  );
  const carte = trouver((v) => v.startsWith("CARTE"));
  let type = trouver((v) => v === "TYPE" || (v.startsWith("TYPE") && !v.includes("CELLULE")));
  const prises = [adresse, designation, carte];

  if (type === null) {
    // Colonne des types mal intitulée (ex. « TAG RPN » dans HTB_TR1) : on retient celle qui contient des types.
    let meilleure: { c: number; part: number } | null = null;
    for (const c of h.keys()) {
      if (prises.includes(c)) continue;
      const part = partTypesConnus(ws, c, ligneEnTete + 1);
      if (part >= 0.5 && (!meilleure || part > meilleure.part)) meilleure = { c, part };
    }
    if (meilleure) {
      type = meilleure.c;
      anomalies.push({
        code: "type_deduit",
        severite: "info",
        feuille: ws.name,
        ligne: ligneEnTete,
        message: `Pas de colonne « TYPE » : la colonne ${lettreColonne(type)} (« ${h.get(type)} »), qui contient les types d'E/S, est utilisée.`,
      });
    } else {
      anomalies.push({
        code: "en_tete_introuvable",
        severite: "avertissement",
        feuille: ws.name,
        ligne: ligneEnTete,
        message: "Colonne « TYPE » introuvable : aucune E/S de cette feuille ne peut être importée.",
      });
    }
  }
  prises.push(type);
  const tag =
    trouver((v) => v.startsWith("TAG") && (v.includes("CELLULE") || v.includes("EQUIPEMENT")), prises) ??
    trouver((v) => v.startsWith("TAG"), prises);
  return { carte, tag, type, designation, adresse };
}

/** Titre de la feuille (lignes au-dessus de l'en-tête), hors cartouche N° Document / N° AFF / Statut. */
function titreFeuille(ws: Worksheet, ligneEnTete: number): string {
  for (let r = 1; r < ligneEnTete; r++) {
    for (let c = 1; c <= nbColonnes(ws); c++) {
      const t = texteLigne(ws.getRow(r).getCell(c).value);
      if (!t || RE_DOCUMENT.test(t) || RE_AFFAIRE.test(t) || RE_REVISION.test(t)) continue;
      return t;
    }
  }
  return ws.name;
}

const sansTag = (tag: string) => tag === "" || tag === "-";

function lireFeuilleEs(ws: Worksheet, ligneEnTete: number, anomalies: Anomalies): FeuilleEsLue | null {
  const cols = colonnesEs(ws, ligneEnTete, anomalies);
  if (!cols) return null;
  const titre = titreFeuille(ws, ligneEnTete);
  if (cols.type === null) return { nom: ws.name, titre, points: [], groupesTag: [] };

  const avecEnTete = new Set(enTetes(ws, ligneEnTete).keys());
  const colonnesSansEnTete = new Map<number, number>();
  const points: PointEsLu[] = [];
  const val = (r: number, c: number | null) => (c === null ? "" : texteLigne(ws.getRow(r).getCell(c).value));

  for (let r = ligneEnTete + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= nbColonnes(ws); c++) {
      if (!avecEnTete.has(c) && texteLigne(row.getCell(c).value) !== "") {
        colonnesSansEnTete.set(c, (colonnesSansEnTete.get(c) ?? 0) + 1);
      }
    }
    const p = {
      carte: val(r, cols.carte),
      tag: val(r, cols.tag),
      typeBrut: val(r, cols.type),
      designation: val(r, cols.designation),
      adresse: val(r, cols.adresse),
    };
    if (Object.values(p).every((v) => v === "")) continue;

    const manquants = [
      !p.adresse && "adresse manquante",
      !p.typeBrut && "type manquant",
      !p.designation && "désignation manquante",
      !p.carte && cols.carte !== null && "carte manquante",
    ].filter((x): x is string => Boolean(x));
    const nonImportee = !p.adresse || !p.typeBrut;
    if (manquants.length > 0) {
      anomalies.push({
        code: "ligne_incomplete",
        severite: "avertissement",
        feuille: ws.name,
        ligne: r,
        message: `Ligne incomplète (${manquants.join(", ")})${nonImportee ? " : ligne non importée." : "."}`,
      });
    }
    if (nonImportee) continue;

    const type = normaliserTypeEs(p.typeBrut);
    if (!type) {
      anomalies.push({
        code: "type_inconnu",
        severite: "avertissement",
        feuille: ws.name,
        ligne: r,
        message: `Type « ${p.typeBrut} » inconnu (attendu : ENTREE TOR, E TOR, SORTIE TOR, S TOR, ENTREE ANALOGIQUE, E ANA) : ligne non importée.`,
      });
      continue;
    }
    points.push({ ligne: r, ...p, type, reserve: estCommentaireReserve(p.designation) });
  }

  for (const [c, n] of colonnesSansEnTete) {
    anomalies.push({
      code: "colonne_sans_en_tete",
      severite: "info",
      feuille: ws.name,
      ligne: ligneEnTete,
      message: `Colonne ${lettreColonne(c)} sans en-tête ignorée (${n} valeur${n > 1 ? "s" : ""}).`,
    });
  }

  // Doublons d'adresse : dans un même groupe TAG (une feuille peut décrire plusieurs relais, ex. HTB_TR1).
  const vues = new Map<string, PointEsLu>();
  for (const p of points) {
    const cle = `${sansTag(p.tag) ? "" : normaliserTexte(p.tag)}\u0000${normaliserAdresse(p.adresse)}`;
    const premier = vues.get(cle);
    if (premier) {
      anomalies.push({
        code: "adresse_en_double",
        severite: "avertissement",
        feuille: ws.name,
        ligne: p.ligne,
        message: `Adresse « ${p.adresse} » en double${sansTag(p.tag) ? "" : ` pour « ${p.tag} »`} (déjà ligne ${premier.ligne}${
          premier.carte !== p.carte ? `, carte ${premier.carte || "—"} ; ici carte ${p.carte || "—"}` : ""
        }).`,
      });
    } else {
      vues.set(cle, p);
    }
  }

  const groupesTag = [...new Set(points.map((p) => p.tag).filter((t) => !sansTag(t)))];
  if (groupesTag.length > 1) {
    anomalies.push({
      code: "feuille_multi_equipements",
      severite: "info",
      feuille: ws.name,
      ligne: null,
      message: `La feuille décrit plusieurs ensembles (colonne TAG : ${groupesTag.map((g) => `« ${g} »`).join(", ")}) : à l'association, choisir le filtre TAG de chaque équipement.`,
    });
  }
  return { nom: ws.name, titre, points, groupesTag };
}

// --- Classeur ---------------------------------------------------------------------------------------------------

export async function lireListeEs(
  contenu: Uint8Array,
  opts: { numeroAffaireAttendu?: string } = {},
): Promise<ListeEsLue> {
  const wb = new ExcelJS.Workbook();
  // exceljs attend un Buffer Node (la lecture se fait côté serveur).
  await wb.xlsx.load(Buffer.from(contenu.buffer, contenu.byteOffset, contenu.byteLength) as never);
  const anomalies: Anomalies = [];
  const { reference, revision, numeroAffaire } = lireIdentite(wb);

  if (!reference) {
    anomalies.push({
      code: "reference_introuvable",
      severite: "avertissement",
      feuille: null,
      ligne: null,
      message: "Référence du document (« N° Document ») introuvable dans le fichier.",
    });
  }
  if (!revision) {
    anomalies.push({
      code: "reference_introuvable",
      severite: "avertissement",
      feuille: null,
      ligne: null,
      message: "Révision du document (« Statut : Rev … ») introuvable dans le fichier.",
    });
  }
  const attendu = opts.numeroAffaireAttendu?.trim().toUpperCase();
  if (attendu) {
    if (!numeroAffaire) {
      anomalies.push({
        code: "reference_introuvable",
        severite: "avertissement",
        feuille: null,
        ligne: null,
        message: `N° d'affaire (« N° AFF ») introuvable dans le fichier : impossible de vérifier qu'il s'agit de l'affaire ${attendu}.`,
      });
    } else if (numeroAffaire !== attendu) {
      anomalies.push({
        code: "affaire_differente",
        severite: "erreur",
        feuille: null,
        ligne: null,
        message: `Le fichier concerne l'affaire ${numeroAffaire}, pas l'affaire ${attendu}.`,
      });
    }
  }

  const wsEquipements =
    wb.worksheets.find((w) => normaliserTexte(w.name) === NOM_EQUIPEMENTS) ??
    wb.worksheets.find((w) => chercherLigneEnTete(w, estEnTeteEquipements) !== null);
  let equipements: EquipementLu[] = [];
  if (wsEquipements) {
    equipements = lireEquipements(wsEquipements, anomalies);
  } else {
    anomalies.push({
      code: "feuille_equipements_absente",
      severite: "erreur",
      feuille: null,
      ligne: null,
      message: `Feuille « ${NOM_EQUIPEMENTS} » introuvable.`,
    });
  }

  const feuilles: FeuilleEsLue[] = [];
  for (const ws of wb.worksheets) {
    if (ws === wsEquipements) continue;
    const ligne = chercherLigneEnTete(ws, estEnTeteEs);
    if (ligne === null) continue; // page de garde, révisions, autres feuilles
    const f = lireFeuilleEs(ws, ligne, anomalies);
    if (f) feuilles.push(f);
  }
  if (feuilles.length === 0) {
    anomalies.push({
      code: "aucune_feuille_es",
      severite: "erreur",
      feuille: null,
      ligne: null,
      message: "Aucune feuille d'entrées/sorties (colonnes CARTES, TYPE, COMMENTAIRE, ADRESSE) dans le fichier.",
    });
  }

  return { reference, revision, numeroAffaire, equipements, feuilles, anomalies };
}
