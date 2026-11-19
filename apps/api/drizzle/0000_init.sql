CREATE TYPE "public"."role" AS ENUM('technicien', 'preparateur', 'admin');--> statement-breakpoint
CREATE TABLE "affaire" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"numero" text NOT NULL,
	"client" text NOT NULL,
	"projet" text NOT NULL,
	"site" text DEFAULT '' NOT NULL,
	"valide_par_defaut" text DEFAULT '' NOT NULL,
	"approuve_par_defaut" text DEFAULT '' NOT NULL,
	"sharepoint_drive_id" text,
	"dossier_sharepoint_id" text,
	"sharepoint_path" text,
	"sharepoint_web_url" text,
	"archivee" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "affaire_numero_unique" UNIQUE("numero")
);
--> statement-breakpoint
CREATE TABLE "affectation" (
	"affaire_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "affectation_affaire_id_user_id_pk" PRIMARY KEY("affaire_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "journal_audit" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "journal_audit_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"details" jsonb,
	"ip" text
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by_id" uuid,
	"user_agent" text,
	"ip" text,
	CONSTRAINT "session_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "utilisateur" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"nom" text NOT NULL,
	"role" "role" NOT NULL,
	"actif" boolean DEFAULT true NOT NULL,
	"password_hash" text NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"password_changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "utilisateur_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "affectation" ADD CONSTRAINT "affectation_affaire_id_affaire_id_fk" FOREIGN KEY ("affaire_id") REFERENCES "public"."affaire"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affectation" ADD CONSTRAINT "affectation_user_id_utilisateur_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."utilisateur"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_audit" ADD CONSTRAINT "journal_audit_actor_id_utilisateur_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."utilisateur"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_utilisateur_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."utilisateur"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "affectation_user_idx" ON "affectation" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "journal_audit_at_idx" ON "journal_audit" USING btree ("at");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_family_idx" ON "session" USING btree ("family_id");