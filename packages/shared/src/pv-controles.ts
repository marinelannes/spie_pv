import type { Jugement } from "./jugements.js";
import { TYPE_ES_COURTS } from "./io.js";
import { nouvelId } from "./pv-modele-relais.js";
import type { Criticite, PointEsPv, PvRelaisData, Reserve, Trace } from "./pv-relais.js";
import type { SectionRelaisId } from "./pv-sections.js";

/**
 * Contrôles jugés du PV (C / NC / NA). Chaque élément a une référence stable (`ref`) : elle relie une observation
 * ou une réserve à son contrôle d'origine, et sert au récapitulatif avant signature (spec §3.2 étape 4).
 */
export interface ElementJuge {
  ref: string;
  section: SectionRelaisId;
  libelle: string;
  jugement: Jugement | null;
  /** Un jugement doit être choisi avant la signature. */
  obligatoire: boolean;
  /** Commentaire saisi sur l'élément lui-même (tient lieu d'observation pour un NC). */
  commentaire: string;
}

const aDesValeurs = (...phaseurs: { amplitude: number | null }[]) => phaseurs.some((p) => p.amplitude !== null);

/** Jugement agrégé d'une E/S : NC si le test ou la remontée SCADA est NC. */
export function jugementEs(p: PointEsPv): Jugement | null {
  if (p.teste === "NC" || p.scada === "NC") return "NC";
  return p.teste;
}

export function libelleEs(p: Pick<PointEsPv, "adresse" | "designation" | "type">): string {
  return `E/S ${p.adresse} (${TYPE_ES_COURTS[p.type]}) — ${p.designation}`;
}

export function elementsJuges(d: PvRelaisData): ElementJuge[] {
  const out: ElementJuge[] = [];
  const push = (e: Omit<ElementJuge, "commentaire"> & { commentaire?: string }) => out.push({ commentaire: "", ...e });

  for (const t of d.testsPreliminaires) {
    push({
      ref: `tests.${t.id}`,
      section: "tests",
      libelle: t.libelleFr,
      jugement: t.jugement,
      obligatoire: true,
      commentaire: t.observation,
    });
  }
  push({
    ref: "configuration",
    section: "configuration",
    libelle: "Identification de la configuration",
    jugement: d.configuration.jugement,
    obligatoire: true,
  });
  const cm = d.circuitsMesure;
  for (const t of cm.transformateurs) {
    push({
      ref: `transfo.${t.id}`,
      section: "mesures",
      libelle: t.libelleFr,
      jugement: t.jugement,
      obligatoire: true,
      commentaire: t.remarques,
    });
  }
  push({
    ref: "champ-tournant",
    section: "mesures",
    libelle: "Champ tournant",
    jugement: cm.champTournant.jugement,
    obligatoire: true,
  });
  for (const s of cm.sensCablage) {
    push({ ref: `sens.${s.id}`, section: "mesures", libelle: s.libelleFr, jugement: s.jugement, obligatoire: true });
  }
  for (const tab of [cm.systemeEquilibre, cm.systemeDesequilibre]) {
    for (const l of tab.lignes) {
      push({
        ref: `injection.${tab.id}.${l.id}`,
        section: "mesures",
        libelle: `${tab.titreFr} — phase ${l.phase}`,
        jugement: l.jugement,
        // La ligne N du modèle est souvent vide : on n'exige un jugement que sur les lignes injectées.
        obligatoire: aDesValeurs(l.injecteV, l.injecteI),
      });
    }
  }
  for (const t of cm.defautTerre) {
    push({
      ref: `tore.${t.id}`,
      section: "mesures",
      libelle: `Circuit défaut terre — tore ${t.tore}`,
      jugement: t.jugement,
      obligatoire: true,
    });
  }
  push({
    ref: "tresse",
    section: "mesures",
    libelle: cm.controleTresse.libelleFr,
    jugement: cm.controleTresse.jugement,
    obligatoire: true,
  });

  for (const p of d.es.points) {
    push({
      ref: `es.${p.id}`,
      section: "es",
      libelle: libelleEs(p),
      jugement: jugementEs(p),
      obligatoire: true,
      commentaire: p.commentaire,
    });
  }
  for (const l of d.leds) {
    push({
      ref: `led.${l.id}`,
      section: "es",
      libelle: `${l.numero} ${l.couleur}${l.designation ? ` — ${l.designation}` : ""}`,
      jugement: l.jugement,
      // Seules les LED affectées (désignation renseignée) sont à vérifier.
      obligatoire: l.designation.trim() !== "",
    });
  }
  return out;
}

export interface Manquant {
  ref: string;
  section: SectionRelaisId;
  message: string;
  /** Bloquant : la signature est impossible tant qu'il reste. Sinon, simple avertissement. */
  bloquant: boolean;
}

export interface OptionsControles {
  /** Un NC exige une observation (spec §4.2, point ouvert n°9). Activé par défaut. */
  observationObligatoireSurNc?: boolean;
}

/**
 * Ce qui manque avant la signature (spec §3.2 étape 4) : champs obligatoires, E/S non testées, conclusions absentes,
 * NC sans observation. Le choix du statut BPO / BPE / CMS et les signatures sont contrôlés à l'étape de signature
 * (`controlesSignature`).
 */
export function controlesAvantSignature(d: PvRelaisData, opts: OptionsControles = {}): Manquant[] {
  const exigerObs = opts.observationObligatoireSurNc ?? true;
  const out: Manquant[] = [];
  const requis = (ref: string, section: SectionRelaisId, valeur: string, message: string, bloquant = true) => {
    if (valeur.trim() === "") out.push({ ref, section, message, bloquant });
  };

  requis("entete.numeroDocument", "generalites", d.entete.numeroDocument, "N° Document non renseigné.");
  requis("generalites.lieu", "generalites", d.generalites.lieu, "Lieu des tests non renseigné.");
  requis("generalites.dates", "generalites", d.generalites.dates, "Dates des tests non renseignées.");
  for (const f of d.identification) {
    if (f.id === "modele" || f.id === "numero-serie") {
      requis(`identification.${f.id}`, "identification", f.valeur, `${f.libelleFr} non renseigné.`, false);
    }
  }
  requis(
    "configuration.nomFichier",
    "configuration",
    d.configuration.nomFichier,
    "Nom du fichier de paramétrage non renseigné.",
  );

  const observationsParRef = new Map<string, string[]>();
  for (const o of d.observations) {
    if (o.ref) observationsParRef.set(o.ref, [...(observationsParRef.get(o.ref) ?? []), o.observation]);
  }
  const aUneObservation = (e: ElementJuge) =>
    e.commentaire.trim() !== "" || (observationsParRef.get(e.ref) ?? []).some((t) => t.trim() !== "");

  for (const e of elementsJuges(d)) {
    if (e.obligatoire && e.jugement === null) {
      out.push({
        ref: e.ref,
        section: e.section,
        message:
          e.section === "es" && e.ref.startsWith("es.")
            ? `E/S non testée : ${e.libelle}`
            : `Conclusion absente : ${e.libelle}`,
        bloquant: true,
      });
    }
    if (exigerObs && e.jugement === "NC" && !aUneObservation(e)) {
      out.push({ ref: e.ref, section: e.section, message: `NC sans observation : ${e.libelle}`, bloquant: true });
    }
  }

  for (const o of d.observations) {
    if (exigerObs && o.jugement === "NC" && o.observation.trim() === "") {
      out.push({
        ref: `observation.${o.id}`,
        section: "observations",
        message: `Observation n°${o.numero} : NC sans observation.`,
        bloquant: true,
      });
    }
  }

  for (const f of d.fonctions) {
    const mesure = f.tempsMesures.some((t) => `${t.protection}${t.alarme}${t.declenchement}`.trim() !== "");
    if (!mesure) {
      out.push({
        ref: `fonction.${f.id}`,
        section: "protection",
        message: `Temps mesurés non renseignés : ${f.nomLogique || f.libelleFr || "fonction sans nom"}.`,
        bloquant: false,
      });
    }
  }

  if (d.conclusion.materiel === null) {
    out.push({
      ref: "conclusion",
      section: "conclusion",
      message: "Conclusion générale (matériel accepté / refusé) absente.",
      bloquant: true,
    });
  }
  return out;
}

/**
 * Contrôles de l'étape de signature : statut du document, signature SPIE, signature client ou refus motivé.
 * Le refus de signer est daté comme une signature.
 */
export function controlesSignature(d: PvRelaisData): Manquant[] {
  const out: Manquant[] = [];
  const m = (ref: string, message: string) => out.push({ ref, section: "conclusion", message, bloquant: true });
  if (d.entete.statutDocument === null) m("entete.statutDocument", "Statut du document (BPO / BPE / CMS) non choisi.");
  const { spie, client } = d.signatures;
  if (!spie.nom.trim()) m("signatures.spie.nom", "Nom du signataire SPIE manquant.");
  if (!spie.date) m("signatures.spie.date", "Date de signature SPIE manquante.");
  if (!spie.signature) m("signatures.spie.signature", "Signature SPIE manquante.");
  if (client.refus) {
    if (!client.date) m("signatures.client.date", "Date du refus de signer manquante.");
    if (!client.refus.motif.trim()) m("signatures.client.refus", "Motif du refus de signer manquant.");
  } else {
    if (!client.nom.trim()) m("signatures.client.nom", "Nom du signataire client manquant.");
    if (!client.date) m("signatures.client.date", "Date de signature client manquante.");
    if (!client.signature) m("signatures.client.signature", "Signature client manquante (ou refus de signer).");
  }
  return out;
}

export interface AvancementEs {
  total: number;
  testees: number;
  nc: number;
  reserves: number;
  restantes: number;
}

/** Compteur d'avancement des E/S (spec §4.4) : testées sur total, nombre de NC. */
export function avancementEs(points: readonly PointEsPv[]): AvancementEs {
  let testees = 0;
  let nc = 0;
  let reserves = 0;
  for (const p of points) {
    if (p.teste !== null) testees++;
    if (jugementEs(p) === "NC") nc++;
    if (p.reserve) reserves++;
  }
  return { total: points.length, testees, nc, reserves, restantes: points.length - testees };
}

export type ChampsResultatEs = Partial<
  Pick<PointEsPv, "teste" | "leds" | "relais" | "scada" | "message" | "commentaire">
>;

/** Saisie d'un résultat d'E/S : la date, l'heure et l'auteur sont ajoutés automatiquement (spec §4.4). */
export function saisirResultatEs(p: PointEsPv, changes: ChampsResultatEs, trace: Trace): PointEsPv {
  return { ...p, ...changes, saisie: trace };
}

export type FiltreEs = "toutes" | "non_testees" | "nc" | "reserves";

/** Recherche par adresse ou désignation, filtres non testées / NC / réserves (spec §4.4). */
export function filtrerEs(points: readonly PointEsPv[], filtre: FiltreEs, recherche = ""): PointEsPv[] {
  const q = recherche.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();
  const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  return points.filter((p) => {
    if (filtre === "non_testees" && p.teste !== null) return false;
    if (filtre === "nc" && jugementEs(p) !== "NC") return false;
    if (filtre === "reserves" && !p.reserve) return false;
    if (!q) return true;
    return norm(p.adresse).includes(q) || norm(p.designation).includes(q) || norm(p.carte).includes(q);
  });
}

/** Regroupement par carte, dans l'ordre de la liste (liste virtualisée, spec §4.4). */
export function grouperParCarte(points: readonly PointEsPv[]): { carte: string; points: PointEsPv[] }[] {
  const groupes: { carte: string; points: PointEsPv[] }[] = [];
  const index = new Map<string, number>();
  for (const p of points) {
    let i = index.get(p.carte);
    if (i === undefined) {
      i = groupes.length;
      index.set(p.carte, i);
      groupes.push({ carte: p.carte, points: [] });
    }
    groupes[i]!.points.push(p);
  }
  return groupes;
}

export interface NouvelleObservation {
  ref: string | null;
  libelle: string;
  jugement: Jugement | null;
  observation: string;
  /** Transformer le NC en réserve « en un geste » (spec §4.2). */
  reserve?: { description?: string; criticite?: Criticite | null; responsable?: string; datePrevue?: string };
}

/**
 * Ajoute une ligne au tableau Observations, et éventuellement une réserve liée. Les numéros sont attribués
 * automatiquement dans le PV (spec §4.3). Renvoie de nouvelles données, sans modifier celles reçues.
 * Une réserve exige un texte saisi (description ou observation) : sans texte, rien n'est ajouté.
 */
export function ajouterObservation(
  d: PvRelaisData,
  o: NouvelleObservation,
  idFn: () => string = nouvelId,
): PvRelaisData {
  if (o.reserve && !(o.reserve.description ?? o.observation).trim()) return d;
  const numeroObs = Math.max(0, ...d.observations.map((x) => x.numero)) + 1;
  let reserves = d.reserves;
  let reserveNumero: number | null = null;
  if (o.reserve) {
    reserveNumero = Math.max(0, ...d.reserves.map((r) => r.numero)) + 1;
    reserves = [
      ...d.reserves,
      {
        id: idFn(),
        numero: reserveNumero,
        ref: o.ref,
        controle: o.libelle,
        description: o.reserve.description ?? o.observation,
        criticite: o.reserve.criticite ?? null,
        responsable: o.reserve.responsable ?? "",
        datePrevue: o.reserve.datePrevue ?? "",
        statut: "ouverte",
        indiceCreation: d.entete.indice,
        levee: null,
      },
    ];
  }
  return {
    ...d,
    observations: [
      ...d.observations,
      {
        id: idFn(),
        numero: numeroObs,
        ref: o.ref,
        libelle: o.libelle,
        jugement: o.jugement,
        reserveNumero,
        observation: o.observation,
      },
    ],
    reserves,
  };
}

/** Transforme une observation existante en réserve (si elle n'en a pas déjà une et si son texte est saisi). */
export function transformerEnReserve(
  d: PvRelaisData,
  observationId: string,
  r: { criticite?: Criticite | null; responsable?: string; datePrevue?: string } = {},
  idFn: () => string = nouvelId,
): PvRelaisData {
  const obs = d.observations.find((o) => o.id === observationId);
  if (!obs || obs.reserveNumero !== null || !obs.observation.trim()) return d;
  const numero = Math.max(0, ...d.reserves.map((x) => x.numero)) + 1;
  return {
    ...d,
    observations: d.observations.map((o) => (o.id === observationId ? { ...o, reserveNumero: numero } : o)),
    reserves: [
      ...d.reserves,
      {
        id: idFn(),
        numero,
        ref: obs.ref,
        controle: obs.libelle,
        description: obs.observation,
        criticite: r.criticite ?? null,
        responsable: r.responsable ?? "",
        datePrevue: r.datePrevue ?? "",
        statut: "ouverte",
        indiceCreation: d.entete.indice,
        levee: null,
      },
    ],
  };
}

/**
 * Une réserve créée dans la révision en cours (et toujours ouverte) peut être supprimée tant que le PV n'est pas
 * signé : création par erreur. Une réserve d'une révision précédente se lève, elle ne se supprime pas (spec §3.4).
 */
export function reserveSupprimable(d: Pick<PvRelaisData, "entete">, r: Pick<Reserve, "indiceCreation" | "statut">) {
  return r.indiceCreation === d.entete.indice && r.statut === "ouverte";
}

/**
 * Supprime une réserve : les observations qui la citaient n'ont plus de réserve, et les réserves suivantes sont
 * renumérotées pour garder une numérotation continue (spec §4.3).
 */
export function supprimerReserve(d: PvRelaisData, reserveId: string): PvRelaisData {
  const r = d.reserves.find((x) => x.id === reserveId);
  if (!r || !reserveSupprimable(d, r)) return d;
  const decaler = (n: number) => (n > r.numero ? n - 1 : n);
  return {
    ...d,
    reserves: d.reserves.filter((x) => x.id !== reserveId).map((x) => ({ ...x, numero: decaler(x.numero) })),
    observations: d.observations.map((o) => ({
      ...o,
      reserveNumero: o.reserveNumero === null || o.reserveNumero === r.numero ? null : decaler(o.reserveNumero),
    })),
  };
}

/**
 * Supprime une observation, et la réserve qui lui est liée (si elle est supprimable ; sinon rien n'est supprimé).
 * Les observations suivantes sont renumérotées.
 */
export function supprimerObservation(d: PvRelaisData, observationId: string): PvRelaisData {
  const o = d.observations.find((x) => x.id === observationId);
  if (!o) return d;
  let out = d;
  if (o.reserveNumero !== null) {
    const r = d.reserves.find((x) => x.numero === o.reserveNumero);
    if (r) {
      if (!reserveSupprimable(d, r)) return d;
      out = supprimerReserve(d, r.id);
    }
  }
  return {
    ...out,
    observations: out.observations
      .filter((x) => x.id !== observationId)
      .map((x) => (x.numero > o.numero ? { ...x, numero: x.numero - 1 } : x)),
  };
}

/** Récapitulatif des réserves (spec §4.3) : nombre de réserves ouvertes et levées. */
export function recapReserves(d: Pick<PvRelaisData, "reserves">): { ouvertes: number; levees: number } {
  const ouvertes = d.reserves.filter((r) => r.statut === "ouverte").length;
  return { ouvertes, levees: d.reserves.length - ouvertes };
}
