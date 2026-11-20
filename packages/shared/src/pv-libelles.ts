/**
 * Libellés lisibles des valeurs préparées modifiées sur site (spec §4.2), pour le back-office : le chemin technique
 * (`fonctions[f1].reglages`, `revisions[0].ecritPar`) devient « Plan de protection — PHPTOC1 — Réglages », et les
 * valeurs (objets, listes) sont mises en texte au lieu de JSON.
 */

const SECTIONS: Record<string, string> = {
  entete: "En-tête",
  revisions: "Tableau des révisions",
  generalites: "Généralités",
  materielTest: "Matériel de test",
  documentsReference: "Documents de référence",
  identification: "Identification du relais",
  testsPreliminaires: "Tests préliminaires",
  configuration: "Identification de la configuration",
  circuitsMesure: "Circuits de mesures",
  es: "Affectation cartes E/S",
  leds: "LED",
  fonctions: "Plan de protection",
  observations: "Observations",
  reserves: "Réserves",
  conclusion: "Conclusion",
  signatures: "Signatures",
};

/** Libellés des champs ; null : niveau de structure sans intérêt pour le lecteur (omis). */
const CHAMPS: Record<string, string | null> = {
  numeroDocument: "N° Document",
  numeroAffaire: "N° d'affaire",
  client: "Client",
  projet: "Projet",
  indice: "Indice",
  statutDocument: "Statut du document",
  date: "Date",
  ecritPar: "Écrit par",
  validePar: "Validé par",
  approuvePar: "Approuvé par",
  modifications: "Modifications",
  objet: "Objet",
  lieu: "Lieu des tests",
  dates: "Dates des tests",
  valeur: "Valeur",
  observation: "Observation",
  jugement: "Jugement",
  rapport: "Rapport",
  classe: "Classe",
  puissance: "Puissance",
  remarques: "Remarques",
  detail: "Détail",
  nomFichier: "Nom du fichier",
  transformateurs: "Transformateurs",
  champTournant: "Champ tournant",
  sensCablage: "Sens de câblage",
  systemeEquilibre: "Système équilibré",
  systemeDesequilibre: "Système déséquilibré",
  defautTerre: "Défaut terre",
  controleTresse: "Contrôle de la tresse",
  lignes: null,
  injecteV: "Tension injectée",
  injecteI: "Courant injecté",
  mesureV: "Tension mesurée",
  mesureI: "Courant mesuré",
  tore: "Tore",
  unite: "Unité",
  primaireApplicable: "Primaire applicable",
  primaireInjecte: "Primaire injecté",
  primaireMesure: "Primaire mesuré",
  secondaireApplicable: "Secondaire applicable",
  secondaireInjecte: "Secondaire injecté",
  secondaireMesure: "Secondaire mesuré",
  points: null,
  designation: "Désignation",
  adresse: "Adresse",
  carte: "Carte",
  tag: "TAG",
  type: "Type",
  numero: "N°",
  couleur: "Couleur",
  nomLogique: "Nom logique",
  libelleFr: "Libellé",
  libelleEn: "Libellé (anglais)",
  codeAnsi: "Code ANSI",
  reglages: "Réglages",
  fonction: "Fonction",
  courbe: "Courbe",
  temps: "Temps",
  injections: "Injections",
  tempsMesures: "Temps mesurés",
  sorties: "Sorties",
  messages: "Messages",
  commentaires: "Commentaires",
  protection: "Protection",
  alarme: "Alarme",
  declenchement: "Déclenchement",
  amplitude: "Amplitude",
  angle: "Angle",
  attendu: "Attendu",
  constate: "Constaté",
  fr: "Texte",
  en: "Texte (anglais)",
  titreFr: "Titre",
  titreEn: "Titre (anglais)",
  phase: "Phase",
  libelle: "Libellé",
  nom: "Nom",
};

/** « primaireInjecte » → « Primaire injecte » : repli pour un champ sans libellé connu. */
function humaniser(cle: string): string {
  const mots = cle.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return mots.charAt(0).toUpperCase() + mots.slice(1);
}

const libelleChamp = (cle: string): string | null => (cle in CHAMPS ? CHAMPS[cle]! : humaniser(cle));

type Objet = Record<string, unknown>;
const estObjet = (v: unknown): v is Objet => typeof v === "object" && v !== null && !Array.isArray(v);
const texte = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

/** Nom d'un élément de liste (E/S, fonction, ligne de tableau, révision…) tel que le lecteur le connaît. */
function libelleElement(item: unknown): string | null {
  if (!estObjet(item)) return null;
  const adresse = texte(item.adresse);
  if (adresse) return [adresse, texte(item.designation)].filter(Boolean).join(" ");
  for (const k of ["nomLogique", "libelleFr", "titreFr", "designation", "libelle", "controle"]) {
    const t = texte(item[k]);
    if (t) return t;
  }
  if (texte(item.phase)) return `Phase ${texte(item.phase)}`;
  if (texte(item.tore)) return `Tore ${texte(item.tore)}`;
  if (texte(item.indice)) return `Rév. ${texte(item.indice)}`;
  if (texte(item.numero)) return `N°${texte(item.numero)}`;
  const fr = texte(item.fr);
  if (fr) return fr.length > 60 ? `${fr.slice(0, 57)}…` : fr;
  return null;
}

/** Découpe `a.b[c].d` en jetons : clés et sélecteurs d'éléments (id ou position). */
function jetons(chemin: string): { cle?: string; element?: string }[] {
  const out: { cle?: string; element?: string }[] = [];
  for (const m of chemin.matchAll(/([^.[\]]+)|\[([^\]]*)\]/g)) {
    if (m[1] !== undefined) out.push({ cle: m[1] });
    else out.push({ element: m[2] ?? "" });
  }
  return out;
}

/** Libellé lisible d'un chemin de modification, résolu dans les données du PV (préparées de préférence). */
export function libelleCheminPv(chemin: string, donnees: unknown): string {
  const parties: string[] = [];
  let noeud: unknown = donnees;
  for (const [i, j] of jetons(chemin).entries()) {
    if (j.cle !== undefined) {
      const l = i === 0 ? (SECTIONS[j.cle] ?? humaniser(j.cle)) : libelleChamp(j.cle);
      if (l) parties.push(l);
      noeud = estObjet(noeud) ? noeud[j.cle] : undefined;
    } else {
      const sel = j.element ?? "";
      let item: unknown;
      if (Array.isArray(noeud)) {
        item = noeud.find((x) => estObjet(x) && x.id === sel);
        if (item === undefined && /^\d+$/.test(sel)) item = noeud[Number(sel)];
      }
      parties.push(libelleElement(item) ?? (/^\d+$/.test(sel) ? `n°${Number(sel) + 1}` : sel));
      noeud = item;
    }
  }
  return parties.join(" — ");
}

/** Valeur lisible (texte, nombre décimal à la française, phaseur, objet, liste) au lieu de JSON. */
export function valeurLisible(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v).replace(".", ",");
  if (typeof v === "boolean") return v ? "Oui" : "Non";
  if (Array.isArray(v)) return v.length === 0 ? "—" : v.map(valeurLisible).join("\n");
  if (estObjet(v)) {
    if ("amplitude" in v && "angle" in v && Object.keys(v).length === 2) {
      return v.amplitude === null && v.angle === null
        ? "—"
        : `${valeurLisible(v.amplitude)} ∠ ${valeurLisible(v.angle)}°`;
    }
    const lignes = Object.entries(v)
      .filter(([k, x]) => k !== "id" && x !== null && x !== undefined && x !== "" && !(Array.isArray(x) && !x.length))
      .map(([k, x]) => `${libelleChamp(k) ?? humaniser(k)} : ${valeurLisible(x)}`);
    return lignes.length === 0 ? "—" : lignes.join("\n");
  }
  return String(v);
}
