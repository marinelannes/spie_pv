import { normaliserTexte, type TypeEs } from "./io.js";
import {
  MODELE_RELAIS,
  PV_RELAIS_SCHEMA_VERSION,
  type FonctionProtection,
  type LigneBilingue,
  type LigneInjection,
  type PointEsPv,
  type PvRelaisData,
  type Revision,
} from "./pv-relais.js";

/**
 * Contenu par défaut du « PV de test relais de protection », repris du modèle Word fourni (`exemple PV.docx`).
 * Le préparateur complète et corrige ces valeurs au bureau (spec §3.1) ; les textes fixes (introduction, glossaire)
 * sont dans le rendu (packages/templates).
 */

export function nouvelId(): string {
  return globalThis.crypto.randomUUID();
}

const ligne = (id: string, fr: string, en: string): LigneBilingue => ({ id, fr, en });
const vide = { amplitude: null, angle: null };
const ph = (amplitude: number | null, angle: number | null) => ({ amplitude, angle });

function ligneInjection(
  id: string,
  phase: string,
  v: [number, number] | null,
  i: [number, number] | null,
): LigneInjection {
  return {
    id,
    phase,
    injecteV: v ? ph(v[0], v[1]) : { ...vide },
    injecteI: i ? ph(i[0], i[1]) : { ...vide },
    mesureV: { ...vide },
    mesureI: { ...vide },
    jugement: null,
  };
}

/** Nouvelle fonction de protection, avec les groupes d'injection du modèle (tensions et courants L1 à L3). */
export function nouvelleFonction(idFn: () => string = nouvelId): FonctionProtection {
  const lignes = (prefixe: string, unite: string) =>
    ["L1", "L2", "L3"].map((l, k) => ({
      id: idFn(),
      libelle: `${prefixe} ${l}`,
      amplitude: null,
      unite,
      angle: [0, 120, -120][k] ?? null,
    }));
  return {
    id: idFn(),
    nomLogique: "",
    libelleFr: "",
    libelleEn: "",
    codeAnsi: "",
    ex: "",
    grP: "",
    reglages: "",
    fonction: "",
    courbe: "",
    temps: "",
    injections: [
      { id: idFn(), titreFr: "Tension injectée", titreEn: "Volt", lignes: lignes("V", "V") },
      { id: idFn(), titreFr: "Courant injecté", titreEn: "Current", lignes: lignes("I", "A") },
    ],
    tempsMesures: [
      { id: idFn(), protection: "", alarme: "", declenchement: "" },
      { id: idFn(), protection: "", alarme: "", declenchement: "" },
    ],
    leds: { attendu: "", constate: "" },
    sorties: { attendu: "", constate: "" },
    messages: { attendu: "", constate: "" },
    commentaires: "",
  };
}

/** Point de la liste E/S tel que transmis par l'API (référentiel de l'affaire). */
export interface PointEsSource {
  id: string;
  carte: string;
  tag: string;
  adresse: string;
  type: TypeEs;
  designation: string;
  reserve: boolean;
}

/** E/S du PV à partir de la liste : les E/S de réserve sont cochées NA automatiquement (spec §4.4). */
export function pointsEsDepuisListe(points: readonly PointEsSource[]): PointEsPv[] {
  return points.map((p) => ({
    id: p.id,
    carte: p.carte,
    tag: p.tag,
    adresse: p.adresse,
    type: p.type,
    designation: p.designation,
    reserve: p.reserve,
    teste: p.reserve ? "NA" : null,
    leds: null,
    relais: null,
    scada: null,
    message: "",
    commentaire: "",
    saisie: null,
  }));
}

const LED_COULEURS = ["Vert", "Orange", "Rouge"] as const;

export interface ContexteCreationPv {
  affaire: { numero: string; client: string; projet: string; valideParDefaut: string; approuveParDefaut: string };
  /** Liste E/S de l'équipement (version, feuille, points), si l'équipement en a une. */
  es?: {
    listeId: string;
    listeVersion: number;
    referenceDocument: string;
    revision: string;
    feuille: string;
    filtreTag: string | null;
    points: readonly PointEsSource[];
  } | null;
  /** Date de création (AAAA-MM-JJ, heure de Paris), reprise dans le tableau des révisions. */
  date: string;
  /** « Écrit par » : par défaut le technicien qui signe ; le préparateur peut le renseigner (spec §4.1). */
  ecritPar?: string;
  /** Modèle du relais repris de la liste des équipements, le cas échéant. */
  modeleRelais?: string;
}

/** Première révision (indice A) du tableau des révisions. */
export function premiereRevision(ctx: ContexteCreationPv): Revision {
  return {
    indice: "A",
    date: ctx.date,
    ecritPar: ctx.ecritPar ?? "",
    validePar: ctx.affaire.valideParDefaut,
    approuvePar: ctx.affaire.approuveParDefaut,
    modifications: "Première édition / First issue",
  };
}

/** PV relais vierge, pré-rempli avec l'affaire, la liste E/S et le contenu par défaut du modèle. */
export function creerPvRelais(ctx: ContexteCreationPv): PvRelaisData {
  return {
    schemaVersion: PV_RELAIS_SCHEMA_VERSION,
    modele: MODELE_RELAIS,
    entete: {
      numeroDocument: ctx.es?.referenceDocument ?? "",
      numeroAffaire: ctx.affaire.numero,
      client: ctx.affaire.client,
      projet: ctx.affaire.projet,
      indice: "A",
      statutDocument: null,
    },
    revisions: [premiereRevision(ctx)],
    generalites: {
      objet: [
        ligne(
          "objet-intro",
          "Ce document a pour objet de regrouper les différents résultats des contrôles et essais réalisés sur le relais de protection :",
          "The aim of this document is to summarize the results of all tests and checks performed to the electrical protection device:",
        ),
        ligne("objet-fil", "Contrôle fil à fil", "Loop test"),
        ligne(
          "objet-equipements",
          "Contrôle des équipements installés",
          "Checks the installed material and its wiring",
        ),
        ligne(
          "objet-fonctionnels",
          "Tests fonctionnels du relais de protection",
          "Functional test of the protection device",
        ),
      ],
      lieu: "",
      dates: "",
    },
    materielTest: [
      ligne(
        "mt-1",
        "Pour les tests électriques sous tension et hors tension :",
        "To electrical tests, ON and OFF power",
      ),
      ligne("mt-2", "Multimètres numériques", "Digital multimeter"),
      ligne("mt-3", "Valise d'injection OMICRON", "Volt/Current portable generator OMICRON"),
      ligne("mt-4", "Simulation des entrées sorties tout ou rien :", "Digital and Analogue Input / output"),
      ligne("mt-5", "Simulation des entrées tout ou rien", "Simulation of digital inputs"),
      ligne(
        "mt-6",
        "Simulation des sondes température Pt 100 par potentiomètres multi-tours, boîte à décades",
        "Simulation of temperature sensors Pt 100 by multi-turn potentiometers, scaled resistor box",
      ),
      ligne("mt-7", "Simulation des sorties tout ou rien : voyants", "Simulation of digital outputs: LED"),
    ],
    documentsReference: [
      ligne("doc-procedure", "Procédure de test :", "Test procedure"),
      ligne("doc-norme", "Norme :", "Standard"),
    ],
    identification: [
      { id: "modele", libelleFr: "Numéro du modèle", libelleEn: "Model number", valeur: ctx.modeleRelais ?? "" },
      { id: "numero-serie", libelleFr: "Numéro de série", libelleEn: "Serial number", valeur: "" },
      { id: "code-commande", libelleFr: "Code de commande", libelleEn: "Order code", valeur: "" },
      { id: "adresse-ip", libelleFr: "Adresse IP", libelleEn: "IP address", valeur: "" },
      { id: "tension-aux", libelleFr: "Tension auxiliaire", libelleEn: "Auxiliary voltage", valeur: "" },
      { id: "option", libelleFr: "Option", libelleEn: "Option", valeur: "" },
      { id: "frequence", libelleFr: "Plage de fréquence", libelleEn: "Frequency range", valeur: "50 Hz" },
      { id: "communication", libelleFr: "Communication", libelleEn: "Communication", valeur: "" },
    ],
    testsPreliminaires: [
      {
        id: "tension-aux",
        libelleFr: "Mesure de la tension d'alimentation auxiliaire",
        libelleEn: "Auxiliary supply",
        aideFr: "Tension relevée au multimètre",
        aideEn: "Voltage measured with a multimeter",
        valeur: "",
        jugement: null,
        observation: "",
      },
      {
        id: "terre",
        libelleFr: "Contrôle mise à la terre du relais suivant préconisation du constructeur",
        libelleEn: "Earthing loop",
        aideFr: "Continuité relevée au multimètre aux bornes GND du relais et répartiteur de terre",
        aideEn: "Continuity measured between the relay GND terminals and the earth bar",
        valeur: "",
        jugement: null,
        observation: "",
      },
      {
        id: "heure",
        libelleFr: "Mise à l'heure & date du relais",
        libelleEn: "Setting date & time to the device",
        aideFr: "",
        aideEn: "",
        valeur: "",
        jugement: null,
        observation: "",
      },
    ],
    configuration: { nomFichier: "", jugement: null },
    circuitsMesure: {
      transformateurs: [
        {
          id: "tp",
          libelleFr: "Caractéristiques TP",
          libelleEn: "VTs ratio",
          rapport: "",
          classe: "",
          puissance: "",
          remarques: "",
          jugement: null,
        },
        {
          id: "tc-a",
          libelleFr: "Caractéristiques TC A",
          libelleEn: "CTs A ratio",
          rapport: "",
          classe: "",
          puissance: "",
          remarques: "",
          jugement: null,
        },
        {
          id: "tore-1",
          libelleFr: "Caractéristique tore 1 (courant homopolaire)",
          libelleEn: "Homopolar current CT No. 1 characteristics",
          rapport: "",
          classe: "",
          puissance: "",
          remarques: "",
          jugement: null,
        },
        {
          id: "tore-2",
          libelleFr: "Caractéristique tore 2 (courant homopolaire)",
          libelleEn: "Homopolar current CT No. 2 characteristics",
          rapport: "",
          classe: "",
          puissance: "",
          remarques: "",
          jugement: null,
        },
        {
          id: "tore-3",
          libelleFr: "Caractéristique tore 3 (tension homopolaire)",
          libelleEn: "Homopolar voltage VT No. 3 characteristics",
          rapport: "",
          classe: "",
          puissance: "",
          remarques: "",
          jugement: null,
        },
      ],
      champTournant: { valeur: "", jugement: null },
      sensCablage: [
        {
          id: "sens-1",
          libelleFr: "Vérification sens 1S1-1S2 (par injection primaire)",
          libelleEn: "CTs connection check (tested by primary injection)",
          detail: "Validé par lecture Puissances / Validated by Power Readings",
          jugement: null,
        },
        {
          id: "sens-2",
          libelleFr: "Vérification sens 2S1-2S2 (par injection primaire)",
          libelleEn: "CTs connection check (tested by primary injection)",
          detail: "Validé par lecture Puissances / Validated by Power Readings",
          jugement: null,
        },
      ],
      systemeEquilibre: {
        id: "equilibre",
        titreFr: "Système équilibré",
        titreEn: "Balanced system",
        lignes: [
          ligneInjection("eq-a", "A", [57.74, 0], [1, 0]),
          ligneInjection("eq-b", "B", [57.74, -120], [1, -120]),
          ligneInjection("eq-c", "C", [57.74, 120], [1, 120]),
          ligneInjection("eq-n", "N", null, null),
        ],
      },
      systemeDesequilibre: {
        id: "desequilibre",
        titreFr: "Système déséquilibré",
        titreEn: "Un-balanced system",
        lignes: [
          ligneInjection("deq-a", "A", [57.74, 0], [1, 0]),
          ligneInjection("deq-b", "B", [40, -120], [0.5, -120]),
          ligneInjection("deq-c", "C", [20, 120], [0.1, 120]),
          ligneInjection("deq-n", "N", null, null),
        ],
      },
      defautTerre: [
        {
          id: "tore-n1",
          tore: "N°1",
          unite: "A",
          primaireApplicable: false,
          primaireInjecte: { ...vide },
          primaireMesure: { ...vide },
          secondaireApplicable: true,
          secondaireInjecte: ph(0.2, 0),
          secondaireMesure: { ...vide },
          jugement: null,
        },
        {
          id: "tore-n2",
          tore: "N°2",
          unite: "V",
          primaireApplicable: false,
          primaireInjecte: { ...vide },
          primaireMesure: { ...vide },
          secondaireApplicable: true,
          secondaireInjecte: { ...vide },
          secondaireMesure: { ...vide },
          jugement: null,
        },
      ],
      controleTresse: {
        id: "tresse",
        libelleFr: "Contrôle câblage tresse de terre dans les tores suivant schéma",
        libelleEn: "Cabling check of the armor earth current balancing through CT (see schematic)",
        detail: "",
        jugement: null,
      },
    },
    es: ctx.es
      ? {
          listeId: ctx.es.listeId,
          listeVersion: ctx.es.listeVersion,
          referenceDocument: ctx.es.referenceDocument,
          revision: ctx.es.revision,
          feuille: ctx.es.feuille,
          filtreTag: ctx.es.filtreTag,
          points: pointsEsDepuisListe(ctx.es.points),
        }
      : {
          listeId: null,
          listeVersion: null,
          referenceDocument: "",
          revision: "",
          feuille: "",
          filtreTag: null,
          points: [],
        },
    leds: "ABCDEFGHIJ".split("").flatMap((l) =>
      LED_COULEURS.map((couleur) => ({
        id: `led-${l}-${couleur.toLowerCase()}`,
        numero: `Led ${l}`,
        couleur,
        designation: "",
        jugement: null,
      })),
    ),
    fonctions: [],
    observations: [],
    reserves: [],
    conclusion: { materiel: null },
    signatures: {
      spie: { nom: "", date: "", signature: null, commentaires: "" },
      client: { nom: "", date: "", signature: null, commentaires: "", refus: null },
    },
  };
}

/**
 * Modèle de PV applicable à un équipement (spec §4.5) : en V1, le seul modèle est le « PV de test relais de
 * protection ». Le régulateur de tension (tag `RGU_…`, libellé « REGULATEUR DE TENSION … ») n'a pas de modèle :
 * aucun PV n'est prévu pour lui. Règle volontairement étroite : un relais mal repéré resterait bloqué.
 */
export function modelePvEquipement(e: { tag: string; libelle: string }): typeof MODELE_RELAIS | null {
  const tag = normaliserTexte(e.tag);
  if (tag.startsWith("RGU_") || tag === "RGU" || normaliserTexte(e.libelle).startsWith("REGULATEUR")) return null;
  return MODELE_RELAIS;
}
