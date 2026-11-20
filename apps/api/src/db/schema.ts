import {
  ROLES,
  STATUTS_DEPOT,
  STATUTS_PV,
  TYPES_ES,
  TYPES_FICHIER,
  type AnomalieImport,
  type ModificationTracee,
  type PvRelaisData,
} from "@spie/shared";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const roleEnum = pgEnum("role", ROLES);

/** Comptes propres à l'application (spec §7.1). */
export const utilisateurs = pgTable("utilisateur", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Toujours en minuscules. */
  email: text("email").notNull().unique(),
  nom: text("nom").notNull(),
  role: roleEnum("role").notNull(),
  actif: boolean("actif").notNull().default(true),
  passwordHash: text("password_hash").notNull(),
  mustChangePassword: boolean("must_change_password").notNull().default(true),
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Jetons de rafraîchissement (spec §7.2). Rotation à chaque usage : un jeton remplacé puis réutilisé
 * révoque toute sa « famille » (même connexion initiale). Seule l'empreinte SHA-256 est stockée.
 */
export const sessions = pgTable(
  "session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => utilisateurs.id, { onDelete: "cascade" }),
    familyId: uuid("family_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    replacedById: uuid("replaced_by_id"),
    userAgent: text("user_agent"),
    ip: text("ip"),
  },
  (t) => [index("session_user_idx").on(t.userId), index("session_family_idx").on(t.familyId)],
);

export const affaires = pgTable("affaire", {
  id: uuid("id").primaryKey().defaultRandom(),
  numero: text("numero").notNull().unique(),
  client: text("client").notNull(),
  projet: text("projet").notNull(),
  site: text("site").notNull().default(""),
  valideParDefaut: text("valide_par_defaut").notNull().default(""),
  approuveParDefaut: text("approuve_par_defaut").notNull().default(""),
  /** Dossier SharePoint racine de l'affaire (spec §5.2) : bibliothèque + élément Graph. */
  sharepointDriveId: text("sharepoint_drive_id"),
  sharepointItemId: text("dossier_sharepoint_id"),
  sharepointPath: text("sharepoint_path"),
  sharepointWebUrl: text("sharepoint_web_url"),
  archivee: boolean("archivee").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const affectations = pgTable(
  "affectation",
  {
    affaireId: uuid("affaire_id")
      .notNull()
      .references(() => affaires.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => utilisateurs.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.affaireId, t.userId] }), index("affectation_user_idx").on(t.userId)],
);

/** Journal d'audit (spec §4.6, §7.4). */
export const journalAudit = pgTable(
  "journal_audit",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actorId: uuid("actor_id").references(() => utilisateurs.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    details: jsonb("details").$type<Record<string, unknown>>(),
    ip: text("ip"),
  },
  (t) => [index("journal_audit_at_idx").on(t.at)],
);

// --- Lot 1 : listes E/S, équipements, PV, dépôts (spec §8.4) -------------------------------------------------------

export const typeEsEnum = pgEnum("type_es", TYPES_ES);
export const statutPvEnum = pgEnum("statut_pv", STATUTS_PV);
export const typeFichierEnum = pgEnum("type_fichier", TYPES_FICHIER);
export const statutDepotEnum = pgEnum("statut_depot", STATUTS_DEPOT);

/** Version d'une liste d'E/S importée (spec §4.4 : chaque import crée une nouvelle version). */
export const listesEs = pgTable(
  "liste_es",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    affaireId: uuid("affaire_id")
      .notNull()
      .references(() => affaires.id, { onDelete: "cascade" }),
    referenceDocument: text("reference_document").notNull(),
    revision: text("revision").notNull(),
    version: integer("version").notNull(),
    fichierSource: text("fichier_source").notNull(),
    importePar: uuid("importe_par").references(() => utilisateurs.id, { onDelete: "set null" }),
    /** Rapport d'anomalies de l'import. */
    anomalies: jsonb("anomalies").$type<AnomalieImport[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [unique("liste_es_affaire_version_uq").on(t.affaireId, t.version)],
);

export const feuillesEs = pgTable(
  "feuille_es",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listeId: uuid("liste_id")
      .notNull()
      .references(() => listesEs.id, { onDelete: "cascade" }),
    nom: text("nom").notNull(),
    titre: text("titre").notNull().default(""),
    ordre: integer("ordre").notNull(),
    /** Valeurs distinctes de la colonne TAG (une feuille peut décrire plusieurs équipements). */
    groupesTag: jsonb("groupes_tag").$type<string[]>().notNull().default([]),
  },
  (t) => [unique("feuille_es_liste_nom_uq").on(t.listeId, t.nom)],
);

export const pointsEs = pgTable(
  "point_es",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    feuilleId: uuid("feuille_id")
      .notNull()
      .references(() => feuillesEs.id, { onDelete: "cascade" }),
    ordre: integer("ordre").notNull(),
    /** Ligne du fichier Excel d'origine. */
    ligne: integer("ligne").notNull(),
    carte: text("carte").notNull(),
    tag: text("tag").notNull(),
    typeEs: typeEsEnum("type_es").notNull(),
    designation: text("designation").notNull(),
    adresse: text("adresse").notNull(),
    reserve: boolean("reserve").notNull().default(false),
  },
  (t) => [index("point_es_feuille_idx").on(t.feuilleId, t.ordre)],
);

/** Équipements de l'affaire, issus de la liste des équipements (clé : TAG dans l'affaire). */
export const equipements = pgTable(
  "equipement",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    affaireId: uuid("affaire_id")
      .notNull()
      .references(() => affaires.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
    libelle: text("libelle").notNull().default(""),
    niveauTension: text("niveau_tension").notNull().default(""),
    typeCellule: text("type_cellule").notNull().default(""),
    equipement: text("equipement").notNull().default(""),
    modele: text("modele").notNull().default(""),
    local: text("local").notNull().default(""),
    tagArmoire: text("tag_armoire").notNull().default(""),
    referenceConstructeur: text("reference_constructeur").notNull().default(""),
    /** Feuille d'E/S associée (spec §4.4), avec un filtre facultatif sur la colonne TAG de la feuille. */
    feuilleEsId: uuid("feuille_es_id").references(() => feuillesEs.id, { onDelete: "set null" }),
    filtreTag: text("filtre_tag"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("equipement_affaire_tag_uq").on(t.affaireId, t.tag)],
);

/** PV (un par relais en V1). Le numéro identifie le PV ; il reste le même d'une révision à l'autre (spec §4.1). */
export const pvs = pgTable(
  "pv",
  {
    /** UUID généré par la tablette pour un PV créé sur site (envoi idempotent, spec §6.3). */
    id: uuid("id").primaryKey().defaultRandom(),
    affaireId: uuid("affaire_id")
      .notNull()
      .references(() => affaires.id, { onDelete: "restrict" }),
    equipementId: uuid("equipement_id").references(() => equipements.id, { onDelete: "set null" }),
    modele: text("modele").notNull(),
    /** Pas d'unicité : un doublon venant du terrain est accepté puis signalé (spec §4.1). */
    numero: text("numero").notNull(),
    origine: text("origine", { enum: ["bureau", "site"] }).notNull(),
    creePar: uuid("cree_par").references(() => utilisateurs.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("pv_affaire_numero_idx").on(t.affaireId, t.numero), index("pv_equipement_idx").on(t.equipementId)],
);

export const pvAffectations = pgTable(
  "pv_affectation",
  {
    pvId: uuid("pv_id")
      .notNull()
      .references(() => pvs.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => utilisateurs.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.pvId, t.userId] }), index("pv_affectation_user_idx").on(t.userId)],
);

/** Révision d'un PV (indice A, B…). `donnees` fait foi ; `donnees_preparees` garde l'état de la préparation. */
export const versionsPv = pgTable(
  "version_pv",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pvId: uuid("pv_id")
      .notNull()
      .references(() => pvs.id, { onDelete: "cascade" }),
    indice: text("indice").notNull(),
    statut: statutPvEnum("statut").notNull(),
    statutDocument: text("statut_document", { enum: ["BPO", "BPE", "CMS"] }),
    donneesPreparees: jsonb("donnees_preparees").$type<PvRelaisData>(),
    donnees: jsonb("donnees").$type<PvRelaisData>().notNull(),
    modifications: jsonb("modifications").$type<ModificationTracee[]>().notNull().default([]),
    empreinte: text("empreinte_sha256"),
    modeleVersion: text("version_modele").notNull(),
    listeEsId: uuid("liste_es_id").references(() => listesEs.id, { onDelete: "set null" }),
    /** Date de création du PV (numérotation) : préparation au bureau ou création sur la tablette. */
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull(),
    saisieCommenceeLe: timestamp("saisie_commencee_le", { withTimezone: true }),
    signeLe: timestamp("signe_le", { withTimezone: true }),
    signePar: uuid("signe_par").references(() => utilisateurs.id, { onDelete: "set null" }),
    recuLe: timestamp("recu_le", { withTimezone: true }),
    deposeLe: timestamp("depose_le", { withTimezone: true }),
    tabletteId: text("tablette_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("version_pv_indice_uq").on(t.pvId, t.indice), index("version_pv_statut_idx").on(t.statut)],
);

/** Réserves des versions reçues (suivi et recherches dans le back-office, spec §8.4). Le JSON fait foi. */
export const reserves = pgTable(
  "reserve",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pvId: uuid("pv_id")
      .notNull()
      .references(() => pvs.id, { onDelete: "cascade" }),
    versionId: uuid("version_id")
      .notNull()
      .references(() => versionsPv.id, { onDelete: "cascade" }),
    numero: integer("numero").notNull(),
    statut: text("statut", { enum: ["ouverte", "levee"] }).notNull(),
    criticite: text("criticite"),
    controle: text("controle").notNull().default(""),
    description: text("description").notNull().default(""),
    indiceCreation: text("indice_creation").notNull(),
    indiceLevee: text("indice_levee"),
  },
  (t) => [unique("reserve_version_numero_uq").on(t.versionId, t.numero), index("reserve_pv_idx").on(t.pvId)],
);

/** Dépôt d'un fichier d'une version dans SharePoint, avec reprises (spec §5.4). Sert aussi de file de travail. */
export const depots = pgTable(
  "depot",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    versionId: uuid("version_id")
      .notNull()
      .references(() => versionsPv.id, { onDelete: "cascade" }),
    fichier: typeFichierEnum("fichier").notNull(),
    nom: text("nom").notNull(),
    statut: statutDepotEnum("statut").notNull().default("en_attente"),
    tentatives: integer("tentatives").notNull().default(0),
    derniereErreur: text("derniere_erreur"),
    prochaineTentative: timestamp("prochaine_tentative", { withTimezone: true }),
    /** Bail du traitement en cours : un autre worker ne reprend pas le dépôt avant cette date. */
    verrouJusqua: timestamp("verrou_jusqua", { withTimezone: true }),
    /** Copie dans le stockage d'archive (Azure Blob en production). */
    archiveKey: text("archive_key"),
    taille: integer("taille"),
    cheminSharePoint: text("chemin_sharepoint"),
    itemId: text("item_id"),
    webUrl: text("web_url"),
    deposeLe: timestamp("depose_le", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("depot_version_fichier_uq").on(t.versionId, t.fichier),
    index("depot_file_idx").on(t.statut, t.prochaineTentative),
  ],
);

/** Paramétrage SharePoint : chemin relatif par famille de PV, sous le dossier de l'affaire (spec §4.6, §5.2). */
export const famillesSharePoint = pgTable("famille_sharepoint", {
  famille: text("famille").primaryKey(),
  cheminRelatif: text("chemin_relatif").notNull().default(""),
  updatedAt: updatedAt(),
});
