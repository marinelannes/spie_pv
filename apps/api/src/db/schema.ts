import { ROLES } from "@spie/shared";
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
