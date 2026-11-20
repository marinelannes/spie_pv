import { z } from "zod";
import { typeEsSchema } from "./io.js";
import {
  conclusionSchema,
  jugementSchema,
  jugementScadaSchema,
  okNokSchema,
  statutDocumentSchema,
} from "./jugements.js";

/**
 * Données du « PV de test relais de protection » (spec §4.5), stockées en JSON (VERSION_PV.donnees, spec §8.4).
 * Le même schéma sert à la préparation au bureau, à la saisie sur tablette, au contrôle serveur et au rendu PDF.
 *
 * Conventions :
 * - les textes sont des chaînes (vides si non renseignés), jamais null ;
 * - les jugements non encore choisis valent null ;
 * - chaque élément de liste porte un `id` stable : il sert de clé d'interface, de référence pour les observations
 *   (`ref`) et de chemin dans le suivi des valeurs préparées modifiées sur site.
 */
export const PV_RELAIS_SCHEMA_VERSION = 1 as const;
/** Version du modèle de mise en page (packages/templates), reportée dans le JSON et en base. */
export const MODELE_RELAIS_VERSION = "1.0.0";
export const MODELE_RELAIS = "relais" as const;
/** Code famille pour le nom des fichiers (spec §5.3) : Mise en service / essais. */
export const FAMILLE_RELAIS = "MES" as const;

const id = z.string().min(1).max(64);
const texte = (max = 500) => z.string().max(max);
const jugement = jugementSchema.nullable();
/** Valeur numérique saisie au pavé numérique (spec §4.2) : null tant qu'elle n'est pas renseignée. */
const nombre = z.number().finite().nullable();

/** Amplitude et angle, saisis séparément (spec §4.2). L'unité dépend de la colonne. */
export const phaseurSchema = z.object({ amplitude: nombre, angle: nombre });
export type Phaseur = z.infer<typeof phaseurSchema>;

/** Auteur et date d'une saisie (E/S : ajoutés automatiquement, spec §4.4). */
export const traceSchema = z.object({ par: texte(120), le: z.string().datetime({ offset: true }) });
export type Trace = z.infer<typeof traceSchema>;

export const ligneBilingueSchema = z.object({ id, fr: texte(), en: texte() });
export type LigneBilingue = z.infer<typeof ligneBilingueSchema>;

export const revisionSchema = z.object({
  indice: texte(4),
  /** AAAA-MM-JJ. */
  date: texte(10),
  ecritPar: texte(120),
  validePar: texte(120),
  approuvePar: texte(120),
  modifications: texte(500),
});
export type Revision = z.infer<typeof revisionSchema>;

/** Fiche d'identification : libellé / valeur (spec §4.2). */
export const champIdentificationSchema = z.object({
  id,
  libelleFr: texte(120),
  libelleEn: texte(120),
  valeur: texte(200),
});
export type ChampIdentification = z.infer<typeof champIdentificationSchema>;

/** Contrôle avec relevé (tests préliminaires) : valeur relevée + C / NC / NA. */
export const controleReleveSchema = z.object({
  id,
  libelleFr: texte(300),
  libelleEn: texte(300),
  aideFr: texte(300),
  aideEn: texte(300),
  valeur: texte(100),
  jugement,
  observation: texte(1000),
});
export type ControleReleve = z.infer<typeof controleReleveSchema>;

/** Caractéristiques d'un transformateur de mesure (TP, TC, tores) : préparées, vérifiées C / NC / NA sur site. */
export const transformateurSchema = z.object({
  id,
  libelleFr: texte(200),
  libelleEn: texte(200),
  rapport: texte(100),
  classe: texte(50),
  puissance: texte(50),
  remarques: texte(500),
  jugement,
});
export type Transformateur = z.infer<typeof transformateurSchema>;

export const verificationSchema = z.object({
  id,
  libelleFr: texte(300),
  libelleEn: texte(300),
  /** Méthode ou valeur attendue (ex. « Validé par lecture Puissances »). */
  detail: texte(300),
  jugement,
});
export type Verification = z.infer<typeof verificationSchema>;

/** Ligne d'un tableau d'injection (système équilibré / déséquilibré) : valeurs injectées → valeurs lues. */
export const ligneInjectionSchema = z.object({
  id,
  phase: texte(10),
  injecteV: phaseurSchema,
  injecteI: phaseurSchema,
  mesureV: phaseurSchema,
  mesureI: phaseurSchema,
  jugement,
});
export type LigneInjection = z.infer<typeof ligneInjectionSchema>;

export const tableauInjectionSchema = z.object({
  id,
  titreFr: texte(200),
  titreEn: texte(200),
  lignes: z.array(ligneInjectionSchema).max(10),
});
export type TableauInjection = z.infer<typeof tableauInjectionSchema>;

/** Circuits défaut terre : injection primaire (côté tore) et secondaire (boîtier ESSAILEC). */
export const ligneToreSchema = z.object({
  id,
  tore: texte(50),
  unite: z.enum(["A", "V"]),
  primaireApplicable: z.boolean(),
  primaireInjecte: phaseurSchema,
  primaireMesure: phaseurSchema,
  secondaireApplicable: z.boolean(),
  secondaireInjecte: phaseurSchema,
  secondaireMesure: phaseurSchema,
  jugement,
});
export type LigneTore = z.infer<typeof ligneToreSchema>;

/** Résultat de vérification d'une E/S (spec §4.4). Carte, adresse, type et désignation viennent de la liste. */
export const pointEsPvSchema = z.object({
  id,
  carte: texte(120),
  tag: texte(200),
  adresse: texte(60),
  type: typeEsSchema,
  designation: texte(300),
  reserve: z.boolean(),
  teste: jugement,
  leds: okNokSchema.nullable(),
  relais: okNokSchema.nullable(),
  scada: jugementScadaSchema.nullable(),
  message: texte(300),
  commentaire: texte(1000),
  saisie: traceSchema.nullable(),
});
export type PointEsPv = z.infer<typeof pointEsPvSchema>;

export const blocEsSchema = z.object({
  /** Version de la liste E/S utilisée par le PV (spec §4.4 : « un PV garde la version qu'il a utilisée »). */
  listeId: z.string().uuid().nullable(),
  listeVersion: z.number().int().positive().nullable(),
  referenceDocument: texte(120),
  revision: texte(20),
  feuille: texte(120),
  /** Partie de la feuille retenue quand elle décrit plusieurs équipements (colonne TAG CELLULE / EQUIPEMENT). */
  filtreTag: texte(200).nullable(),
  points: z.array(pointEsPvSchema).max(2000),
});
export type BlocEs = z.infer<typeof blocEsSchema>;

/** Affectation d'une LED (n°, couleur, désignation), vérifiée sur site. */
export const ledSchema = z.object({
  id,
  numero: texte(30),
  couleur: texte(30),
  designation: texte(200),
  jugement,
});
export type Led = z.infer<typeof ledSchema>;

export const ligneInjectionFonctionSchema = z.object({
  id,
  libelle: texte(30),
  amplitude: nombre,
  unite: texte(10),
  angle: nombre,
});
export type LigneInjectionFonction = z.infer<typeof ligneInjectionFonctionSchema>;

export const groupeInjectionSchema = z.object({
  id,
  titreFr: texte(100),
  titreEn: texte(100),
  lignes: z.array(ligneInjectionFonctionSchema).max(6),
});
export type GroupeInjection = z.infer<typeof groupeInjectionSchema>;

export const tempsMesureSchema = z.object({
  id,
  protection: texte(40),
  alarme: texte(40),
  declenchement: texte(40),
});
export type TempsMesure = z.infer<typeof tempsMesureSchema>;

/** Valeur préparée (attendue) et valeur constatée sur site. */
export const attenduConstateSchema = z.object({ attendu: texte(300), constate: texte(300) });
export type AttenduConstate = z.infer<typeof attenduConstateSchema>;

/** Fonction de protection (bloc répétable du plan de protection). Pas de conclusion par fonction (spec v0.3). */
export const fonctionProtectionSchema = z.object({
  id,
  nomLogique: texte(40),
  libelleFr: texte(200),
  libelleEn: texte(200),
  codeAnsi: texte(20),
  ex: texte(10),
  grP: texte(10),
  reglages: texte(200),
  /** Colonne facultative du modèle (ex. « LD » pour le contrôle de synchronisme). */
  fonction: texte(60),
  courbe: texte(40),
  temps: texte(40),
  injections: z.array(groupeInjectionSchema).max(3),
  tempsMesures: z.array(tempsMesureSchema).max(6),
  leds: attenduConstateSchema,
  sorties: attenduConstateSchema,
  messages: attenduConstateSchema,
  commentaires: texte(1000),
});
export type FonctionProtection = z.infer<typeof fonctionProtectionSchema>;

/** Ligne du tableau Observations (spec §4.1). `ref` pointe le contrôle d'origine (voir `elementsJuges`). */
export const observationSchema = z.object({
  id,
  numero: z.number().int().positive(),
  ref: texte(120).nullable(),
  libelle: texte(300),
  jugement,
  reserveNumero: z.number().int().positive().nullable(),
  observation: texte(2000),
});
export type Observation = z.infer<typeof observationSchema>;

export const CRITICITES = ["bloquante", "non_bloquante"] as const;
export const criticiteSchema = z.enum(CRITICITES);
export type Criticite = z.infer<typeof criticiteSchema>;
export const CRITICITE_LABELS: Record<Criticite, string> = {
  bloquante: "Bloquante",
  non_bloquante: "Non bloquante",
};

export const reserveSchema = z.object({
  id,
  numero: z.number().int().positive(),
  ref: texte(120).nullable(),
  controle: texte(300),
  description: texte(2000),
  criticite: criticiteSchema.nullable(),
  responsable: texte(120),
  /** AAAA-MM-JJ. */
  datePrevue: texte(10),
  statut: z.enum(["ouverte", "levee"]),
  indiceCreation: texte(4),
  levee: z.object({ date: texte(10), commentaire: texte(1000), indice: texte(4) }).nullable(),
});
export type Reserve = z.infer<typeof reserveSchema>;

export const signataireSchema = z.object({
  nom: texte(120),
  /** AAAA-MM-JJ. */
  date: texte(10),
  /** Signature manuscrite capturée (PNG en data URL), null si absente. */
  signature: z
    .string()
    .max(600_000)
    .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, "Signature invalide.")
    .nullable(),
  commentaires: texte(1000),
});
export type Signataire = z.infer<typeof signataireSchema>;

export const signaturesSchema = z.object({
  spie: signataireSchema,
  client: signataireSchema.extend({
    /** Le client refuse de signer : mention « Refus de signer », motif, et `date` du refus (spec §3.2). */
    refus: z.object({ motif: texte(1000) }).nullable(),
  }),
});
export type Signatures = z.infer<typeof signaturesSchema>;

export const pvRelaisDataSchema = z.object({
  schemaVersion: z.literal(PV_RELAIS_SCHEMA_VERSION),
  modele: z.literal(MODELE_RELAIS),
  entete: z.object({
    /** Codification projet SPIE (ex. GAU11_AUT_009), distincte du numéro du PV (spec §4.1). */
    numeroDocument: texte(120),
    numeroAffaire: texte(32),
    client: texte(200),
    projet: texte(200),
    indice: texte(4),
    statutDocument: statutDocumentSchema.nullable(),
  }),
  revisions: z.array(revisionSchema).max(26),
  generalites: z.object({
    objet: z.array(ligneBilingueSchema).max(20),
    lieu: texte(300),
    dates: texte(200),
  }),
  materielTest: z.array(ligneBilingueSchema).max(50),
  documentsReference: z.array(ligneBilingueSchema).max(50),
  identification: z.array(champIdentificationSchema).max(30),
  testsPreliminaires: z.array(controleReleveSchema).max(20),
  configuration: z.object({ nomFichier: texte(300), jugement }),
  circuitsMesure: z.object({
    transformateurs: z.array(transformateurSchema).max(10),
    champTournant: z.object({ valeur: texte(60), jugement }),
    sensCablage: z.array(verificationSchema).max(6),
    systemeEquilibre: tableauInjectionSchema,
    systemeDesequilibre: tableauInjectionSchema,
    defautTerre: z.array(ligneToreSchema).max(6),
    controleTresse: verificationSchema,
  }),
  es: blocEsSchema,
  leds: z.array(ledSchema).max(100),
  fonctions: z.array(fonctionProtectionSchema).max(60),
  observations: z.array(observationSchema).max(500),
  reserves: z.array(reserveSchema).max(500),
  conclusion: z.object({ materiel: conclusionSchema.nullable() }),
  signatures: signaturesSchema,
});
export type PvRelaisData = z.infer<typeof pvRelaisDataSchema>;
