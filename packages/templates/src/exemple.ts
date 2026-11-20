import {
  FAMILLE_RELAIS,
  MODELE_RELAIS_VERSION,
  ajouterObservation,
  creerPvRelais,
  nouvelleFonction,
  type FonctionProtection,
  type PointEsSource,
  type PvDocument,
  type PvRelaisData,
  type TypeEs,
} from "@spie/shared";
import { SIGNATURE_EXEMPLE_CLIENT, SIGNATURE_EXEMPLE_SPIE } from "./exemple-signatures.js";

export { SIGNATURE_EXEMPLE_CLIENT, SIGNATURE_EXEMPLE_SPIE };

/**
 * PV d'exemple réaliste (affaire A00001, départ batterie F1), entièrement renseigné et signé. Sert aux tests du
 * rendu, au contrôle visuel des PDF et aux démonstrations de l'aperçu. Données fictives.
 */

const DESIGNATIONS: [TypeEs, string][] = [
  ["entree_tor", "SURVEILLANCE CIRCUIT DECLENCHEMENT"],
  ["entree_tor", "SURVEILLANCE BOBINE DECLENCHEMENT"],
  ["entree_tor", "TP EMBROCHE ET DISJ. 100V FERME"],
  ["entree_tor", "SECTIONNEUR TERRE CELLULE TP OUVERT (JDB A LA TERRE)"],
  ["entree_tor", "POSITION DISJ. OUVERT"],
  ["entree_tor", "POSITION DISJ. FERMÉ"],
  ["entree_tor", "DISJ. DÉBROCHÉ"],
  ["entree_tor", "DISJ. EMBROCHÉ"],
  ["entree_tor", "SMALT OUVERT"],
  ["entree_tor", "SMALT FERMÉ"],
  ["entree_tor", "PRISE DISJONCTEUR INSERE"],
  ["entree_tor", "COMMUTATEUR DISTANT"],
  ["entree_tor", "DECLENCHEMENT VIA DEFAUT COM SACU (API PMS)"],
  ["entree_tor", "DECLENCHEMENT VIA AU / WDG API PMS"],
  ["entree_tor", "RESERVE"],
  ["entree_tor", "OUVERTURE DEPUIS CELLULE ARRIVEE"],
  ["entree_tor", "RESSORT CHARGE ET DISJ. MOTEUR FERME"],
  ["sortie_tor", "DÉCLENCHEMENT DISJ. MBO1"],
  ["sortie_tor", "ENCLENCHEMENT DISJONCTEUR"],
  ["sortie_tor", "DÉCLENCHEMENT DISJ. MBO2"],
  ["sortie_tor", "VERROUILLAGE FERMETURE DISJ."],
  ["sortie_tor", "REPORT DECLENCHEMENT RPN VERS API"],
  ["sortie_tor", "RESERVE"],
  ["sortie_tor", "AUTORISATION FERMETURE SMALT"],
  ["sortie_tor", "CHIEN DE GARDE VERS API"],
  ["entree_analogique", "COURANT PHASE 1"],
  ["entree_analogique", "COURANT PHASE 2"],
  ["entree_analogique", "COURANT PHASE 3"],
  ["entree_analogique", "COURANT HOMOPOLAIRE"],
  ["entree_analogique", "TENSION PHASE 1"],
  ["entree_analogique", "TENSION PHASE 2"],
  ["entree_analogique", "TENSION PHASE 3"],
  ["entree_analogique", "TENSION POINT NEUTRE"],
];

const CARTES = ["RPN_HTA / PS050_1", "RPN_HTA / IO60_1", "RPN_HTA / IO60_2", "RPN_HTA / IO208"];

/** Liste E/S d'exemple : les 33 E/S de la feuille « TYPE BATTERIE », répétées pour atteindre `nb`. */
export function pointsEsExemple(nb = 33): PointEsSource[] {
  return Array.from({ length: nb }, (_, i) => {
    const [type, designation] = DESIGNATIONS[i % DESIGNATIONS.length]!;
    const lot = Math.floor(i / DESIGNATIONS.length);
    const prefixe = type === "entree_tor" ? "BI" : type === "sortie_tor" ? "BO" : "I";
    return {
      id: `es-${i + 1}`,
      // Cartes contiguës, comme dans une liste réelle (le PDF regroupe les E/S par carte).
      carte: CARTES[Math.min(CARTES.length - 1, Math.floor((i * CARTES.length) / nb))]!,
      tag: "-",
      adresse: `${prefixe} ${lot + 1}.${String((i % DESIGNATIONS.length) + 1).padStart(2, "0")}`,
      type,
      designation,
      reserve: designation === "RESERVE",
    };
  });
}

function fonction(
  idFn: () => string,
  nom: string,
  fr: string,
  en: string,
  ansi: string,
  reglage: string,
  temps: string,
  mesure: string,
): FonctionProtection {
  const f = nouvelleFonction(idFn);
  return {
    ...f,
    nomLogique: nom,
    libelleFr: fr,
    libelleEn: en,
    codeAnsi: ansi,
    ex: "1",
    grP: "1",
    reglages: reglage,
    courbe: "DT",
    temps,
    injections: f.injections.map((g, gi) => ({
      ...g,
      lignes: g.lignes.map((l) => ({ ...l, amplitude: gi === 0 ? 57.74 : 5 })),
    })),
    tempsMesures: [
      { ...f.tempsMesures[0]!, protection: "OK" },
      { ...f.tempsMesures[1]!, protection: "OK", declenchement: mesure },
    ],
    leds: { attendu: "LED TRIP ; LED C", constate: "LED TRIP ; LED C" },
    sorties: { attendu: "Carte B : /DO2 ; DO1 — Virtuelle : VO1", constate: "Carte B : /DO2 ; DO1 — Virtuelle : VO1" },
    messages: { attendu: `${nom} TRIP`, constate: `${nom} TRIP` },
    commentaires: "",
  };
}

export interface OptionsExemple {
  /** Nombre d'E/S (33 par défaut, 128 pour la feuille la plus longue de DEMO1_AUT_009). */
  nbEs?: number;
  /** Document signé (empreinte, signatures) ou aperçu en cours de saisie. Signé par défaut. */
  signe?: boolean;
  /** Le client refuse de signer (mention « Refus de signer » et motif). */
  refusClient?: boolean;
}

export function exemplePvDocument(opts: OptionsExemple = {}): PvDocument {
  let n = 0;
  const id = () => `ex-${++n}`;
  const signe = opts.signe ?? true;
  let d: PvRelaisData = creerPvRelais({
    affaire: {
      numero: "A00001",
      client: "CLIENT DEMO INDUSTRIES SAS",
      projet: "Stockage batteries – DEMO1",
      valideParDefaut: "V. VALIDEUR",
      approuveParDefaut: "A. APPROBATEUR",
    },
    es: {
      listeId: "6f1c2b9e-1d2c-4a8b-9e10-0a0b0c0d0e01",
      listeVersion: 1,
      referenceDocument: "DEMO1_AUT_009",
      revision: "B",
      feuille: "TYPE BATTERIE",
      filtreTag: null,
      points: pointsEsExemple(opts.nbEs ?? 33),
    },
    date: "2026-11-19",
    ecritPar: "T. TECHNICIEN",
    modeleRelais: "COMPACT - 7SX8000",
  });
  const c = <T extends { jugement: unknown }>(x: T) => ({ ...x, jugement: "C" as const });
  const trace = { par: "T. TECHNICIEN", le: "2026-11-19T14:10:00.000Z" };
  const identification: Record<string, string> = {
    "numero-serie": "BF2511003214",
    "code-commande": "7SX8000-1AA00-0AA0",
    "adresse-ip": "10.20.1.13",
    "tension-aux": "110 Vcc",
    option: "—",
    communication: "IEC 61850",
  };
  const cm = d.circuitsMesure;
  d = {
    ...d,
    entete: { ...d.entete, statutDocument: signe ? "CMS" : null },
    generalites: {
      ...d.generalites,
      lieu: "Poste DEMO1 — local HTA zone nord",
      dates: "Semaine 47 (17 au 19/11/2026)",
    },
    documentsReference: [
      {
        id: "doc-procedure",
        fr: "Procédure de test : SSO.UIO.PC03-0_Recette_Armoire_ACC",
        en: "Test procedure: SSO.UIO.PC03-0_Recette_Armoire_ACC",
      },
      { id: "doc-norme", fr: "Norme : IEC 60439-1", en: "Standard: IEC 60439-1" },
    ],
    identification: d.identification.map((f) => ({ ...f, valeur: identification[f.id] ?? f.valeur })),
    testsPreliminaires: d.testsPreliminaires.map((t, i) => ({
      ...t,
      valeur: ["112,4 Vcc", "0,2 Ω", "OK"][i] ?? "",
      jugement: "C",
    })),
    configuration: { nomFichier: "DEMO1_RPN_HTA_F1_V3.dex5", jugement: "C" },
    circuitsMesure: {
      ...cm,
      transformateurs: cm.transformateurs.map((t) =>
        t.id === "tp"
          ? { ...t, rapport: "33 kV/√3 / 100 V/√3", classe: "0.5", puissance: "50 VA", jugement: "C" as const }
          : t.id === "tc-a"
            ? { ...t, rapport: "1250/1 A", classe: "5P20", puissance: "20 VA", jugement: "C" as const }
            : t.id === "tore-1"
              ? { ...t, rapport: "50/1 A", classe: "5P10", puissance: "2.5 VA", jugement: "C" as const }
              : { ...t, rapport: "NA", jugement: "NA" as const },
      ),
      champTournant: { valeur: "Direct (L1-L2-L3)", jugement: "C" },
      sensCablage: cm.sensCablage.map(c),
      systemeEquilibre: {
        ...cm.systemeEquilibre,
        lignes: cm.systemeEquilibre.lignes.map((l) =>
          l.phase === "N"
            ? l
            : {
                ...l,
                mesureV: { amplitude: 57.7, angle: l.injecteV.angle },
                mesureI: { amplitude: 1, angle: l.injecteI.angle },
                jugement: "C" as const,
              },
        ),
      },
      systemeDesequilibre: {
        ...cm.systemeDesequilibre,
        lignes: cm.systemeDesequilibre.lignes.map((l) =>
          l.phase === "N"
            ? l
            : { ...l, mesureV: { ...l.injecteV }, mesureI: { ...l.injecteI }, jugement: "C" as const },
        ),
      },
      defautTerre: cm.defautTerre.map((t) =>
        t.unite === "A"
          ? { ...t, secondaireMesure: { amplitude: 0.2, angle: 0 }, jugement: "C" as const }
          : { ...t, secondaireApplicable: false, jugement: "NA" as const },
      ),
      controleTresse: c(cm.controleTresse),
    },
    es: {
      ...d.es,
      points: d.es.points.map((p, i) =>
        p.reserve
          ? p
          : {
              ...p,
              teste: i === 4 ? ("NC" as const) : ("C" as const),
              leds: p.type === "entree_analogique" ? null : ("OK" as const),
              relais: p.type === "sortie_tor" ? ("OK" as const) : null,
              scada: i === 4 ? ("NC" as const) : ("C" as const),
              message: i === 4 ? "Libellé absent" : p.designation,
              commentaire: i === 4 ? "Remontée SCADA absente, à reprendre côté API" : "",
              saisie: trace,
            },
      ),
    },
    leds: d.leds.map((l) =>
      l.numero === "Led A" && l.couleur === "Vert"
        ? { ...l, designation: "Disjoncteur ouvert", jugement: "C" as const }
        : l.numero === "Led A" && l.couleur === "Rouge"
          ? { ...l, designation: "Disjoncteur fermé", jugement: "C" as const }
          : l.numero === "Led C" && l.couleur === "Rouge"
            ? { ...l, designation: "50 – Court-circuit", jugement: "C" as const }
            : l,
    ),
    fonctions: [
      fonction(id, "PHPTOC1", "Maximum de courant", "Overcurrent", "51", "6250A", "100ms", "216 ms"),
      fonction(id, "EFPTOC1", "Maximum de courant de terre", "Earth fault", "51N", "20A", "400ms", "502 ms"),
      {
        ...fonction(id, "CTRLSYNC1", "Contrôle de synchronisme", "Sync control", "25", "990V – 5° - 0.1Hz", "inst", ""),
        fonction: "LD",
        commentaires: "Blocage de fermeture uniquement. LD = jeu de barres inactif et ligne vivante uniquement.",
      },
    ],
    conclusion: { materiel: "accepte" },
  };
  const nc = d.es.points[4]!;
  d = ajouterObservation(
    d,
    {
      ref: `es.${nc.id}`,
      libelle: `E/S ${nc.adresse} — ${nc.designation}`,
      jugement: "NC",
      observation: "Remontée SCADA absente.",
      reserve: { criticite: "non_bloquante", responsable: "SPIE — automatisme", datePrevue: "2026-11-30" },
    },
    id,
  );
  d = ajouterObservation(
    d,
    { ref: null, libelle: "Contrôle visuel du câblage", jugement: "C", observation: "RAS" },
    id,
  );
  if (signe) {
    d = {
      ...d,
      signatures: {
        spie: { nom: "T. TECHNICIEN", date: "2026-11-19", signature: SIGNATURE_EXEMPLE_SPIE, commentaires: "" },
        client: opts.refusClient
          ? {
              nom: "J. DUPONT",
              date: "2026-11-19",
              signature: null,
              commentaires: "",
              refus: { motif: "Réserve n°1 à lever avant signature." },
            }
          : {
              nom: "J. DUPONT",
              date: "2026-11-19",
              signature: SIGNATURE_EXEMPLE_CLIENT,
              commentaires: "Réserve n°1 à lever avant la mise en service.",
              refus: null,
            },
      },
    };
  }
  const fonctionId = d.fonctions[0]!.id;
  return {
    format: "spie-pv/1",
    pv: {
      id: "3c1f6a2e-5b7d-4e8f-9a0b-1c2d3e4f5a6b",
      numero: "A00001-20261119-143205",
      modele: "relais",
      modeleVersion: MODELE_RELAIS_VERSION,
      famille: FAMILLE_RELAIS,
    },
    version: {
      id: "9d8e7f6a-5b4c-4d3e-8f2a-1b0c9d8e7f6a",
      indice: "A",
      statutDocument: d.entete.statutDocument,
      signeLe: signe ? "2026-11-19T15:02:00.000Z" : null,
      empreinte: signe ? "5f2b8c0e9a7d4c3b1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b" : null,
    },
    affaire: {
      numero: "A00001",
      client: "CLIENT DEMO INDUSTRIES SAS",
      projet: "Stockage batteries – DEMO1",
      site: "DEMO1",
    },
    equipement: {
      tag: "RPN_HTA_F1",
      libelle: "RELAIS DE PROTECTION NUMERIQUE DEPART F1",
      typeCellule: "TYPE BATTERIE",
      modele: "COMPACT - 7SX8000",
      local: "LOCAL HTA - ZONE NORD",
      tagArmoire: "ZN_HTA_1ESS01_C03",
    },
    listeEs: { id: "6f1c2b9e-1d2c-4a8b-9e10-0a0b0c0d0e01", reference: "DEMO1_AUT_009", revision: "B", version: 1 },
    meta: {
      creeLe: "2026-11-19T13:32:05.000Z",
      tabletteId: "tablette-demo",
      signePar: signe ? { id: "00000000-0000-4000-8000-000000000001", nom: "T. TECHNICIEN" } : null,
      recuLe: null,
      genereLe: "2026-11-19T15:05:00.000Z",
    },
    donnees: d,
    donneesPreparees: null,
    modifications: [
      {
        chemin: `fonctions[${fonctionId}].reglages`,
        avant: "6250A",
        apres: "6300A",
        par: "T. TECHNICIEN",
        le: "2026-11-19T14:20:00.000Z",
      },
    ],
  };
}
