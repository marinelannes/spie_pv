CREATE TYPE "public"."statut_depot" AS ENUM('en_attente', 'depose', 'erreur');--> statement-breakpoint
CREATE TYPE "public"."statut_pv" AS ENUM('prepare', 'brouillon', 'signe', 'recu', 'depose', 'erreur');--> statement-breakpoint
CREATE TYPE "public"."type_es" AS ENUM('entree_tor', 'sortie_tor', 'entree_analogique');--> statement-breakpoint
CREATE TYPE "public"."type_fichier" AS ENUM('pdf', 'json', 'xlsx');--> statement-breakpoint
CREATE TABLE "depot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"fichier" "type_fichier" NOT NULL,
	"nom" text NOT NULL,
	"statut" "statut_depot" DEFAULT 'en_attente' NOT NULL,
	"tentatives" integer DEFAULT 0 NOT NULL,
	"derniere_erreur" text,
	"prochaine_tentative" timestamp with time zone,
	"verrou_jusqua" timestamp with time zone,
	"archive_key" text,
	"taille" integer,
	"chemin_sharepoint" text,
	"item_id" text,
	"web_url" text,
	"depose_le" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "depot_version_fichier_uq" UNIQUE("version_id","fichier")
);
--> statement-breakpoint
CREATE TABLE "equipement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"affaire_id" uuid NOT NULL,
	"tag" text NOT NULL,
	"libelle" text DEFAULT '' NOT NULL,
	"niveau_tension" text DEFAULT '' NOT NULL,
	"type_cellule" text DEFAULT '' NOT NULL,
	"equipement" text DEFAULT '' NOT NULL,
	"modele" text DEFAULT '' NOT NULL,
	"local" text DEFAULT '' NOT NULL,
	"tag_armoire" text DEFAULT '' NOT NULL,
	"reference_constructeur" text DEFAULT '' NOT NULL,
	"feuille_es_id" uuid,
	"filtre_tag" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipement_affaire_tag_uq" UNIQUE("affaire_id","tag")
);
--> statement-breakpoint
CREATE TABLE "famille_sharepoint" (
	"famille" text PRIMARY KEY NOT NULL,
	"chemin_relatif" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feuille_es" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"liste_id" uuid NOT NULL,
	"nom" text NOT NULL,
	"titre" text DEFAULT '' NOT NULL,
	"ordre" integer NOT NULL,
	"groupes_tag" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "feuille_es_liste_nom_uq" UNIQUE("liste_id","nom")
);
--> statement-breakpoint
CREATE TABLE "liste_es" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"affaire_id" uuid NOT NULL,
	"reference_document" text NOT NULL,
	"revision" text NOT NULL,
	"version" integer NOT NULL,
	"fichier_source" text NOT NULL,
	"importe_par" uuid,
	"anomalies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "liste_es_affaire_version_uq" UNIQUE("affaire_id","version")
);
--> statement-breakpoint
CREATE TABLE "point_es" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feuille_id" uuid NOT NULL,
	"ordre" integer NOT NULL,
	"ligne" integer NOT NULL,
	"carte" text NOT NULL,
	"tag" text NOT NULL,
	"type_es" "type_es" NOT NULL,
	"designation" text NOT NULL,
	"adresse" text NOT NULL,
	"reserve" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pv_affectation" (
	"pv_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pv_affectation_pv_id_user_id_pk" PRIMARY KEY("pv_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "pv" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"affaire_id" uuid NOT NULL,
	"equipement_id" uuid,
	"modele" text NOT NULL,
	"numero" text NOT NULL,
	"origine" text NOT NULL,
	"cree_par" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reserve" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pv_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"numero" integer NOT NULL,
	"statut" text NOT NULL,
	"criticite" text,
	"controle" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"indice_creation" text NOT NULL,
	"indice_levee" text,
	CONSTRAINT "reserve_version_numero_uq" UNIQUE("version_id","numero")
);
--> statement-breakpoint
CREATE TABLE "version_pv" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pv_id" uuid NOT NULL,
	"indice" text NOT NULL,
	"statut" "statut_pv" NOT NULL,
	"statut_document" text,
	"donnees_preparees" jsonb,
	"donnees" jsonb NOT NULL,
	"modifications" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"empreinte_sha256" text,
	"version_modele" text NOT NULL,
	"liste_es_id" uuid,
	"cree_le" timestamp with time zone NOT NULL,
	"saisie_commencee_le" timestamp with time zone,
	"signe_le" timestamp with time zone,
	"signe_par" uuid,
	"recu_le" timestamp with time zone,
	"depose_le" timestamp with time zone,
	"tablette_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "version_pv_indice_uq" UNIQUE("pv_id","indice")
);
--> statement-breakpoint
ALTER TABLE "depot" ADD CONSTRAINT "depot_version_id_version_pv_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."version_pv"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipement" ADD CONSTRAINT "equipement_affaire_id_affaire_id_fk" FOREIGN KEY ("affaire_id") REFERENCES "public"."affaire"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipement" ADD CONSTRAINT "equipement_feuille_es_id_feuille_es_id_fk" FOREIGN KEY ("feuille_es_id") REFERENCES "public"."feuille_es"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feuille_es" ADD CONSTRAINT "feuille_es_liste_id_liste_es_id_fk" FOREIGN KEY ("liste_id") REFERENCES "public"."liste_es"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liste_es" ADD CONSTRAINT "liste_es_affaire_id_affaire_id_fk" FOREIGN KEY ("affaire_id") REFERENCES "public"."affaire"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liste_es" ADD CONSTRAINT "liste_es_importe_par_utilisateur_id_fk" FOREIGN KEY ("importe_par") REFERENCES "public"."utilisateur"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_es" ADD CONSTRAINT "point_es_feuille_id_feuille_es_id_fk" FOREIGN KEY ("feuille_id") REFERENCES "public"."feuille_es"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pv_affectation" ADD CONSTRAINT "pv_affectation_pv_id_pv_id_fk" FOREIGN KEY ("pv_id") REFERENCES "public"."pv"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pv_affectation" ADD CONSTRAINT "pv_affectation_user_id_utilisateur_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."utilisateur"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pv" ADD CONSTRAINT "pv_affaire_id_affaire_id_fk" FOREIGN KEY ("affaire_id") REFERENCES "public"."affaire"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pv" ADD CONSTRAINT "pv_equipement_id_equipement_id_fk" FOREIGN KEY ("equipement_id") REFERENCES "public"."equipement"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pv" ADD CONSTRAINT "pv_cree_par_utilisateur_id_fk" FOREIGN KEY ("cree_par") REFERENCES "public"."utilisateur"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reserve" ADD CONSTRAINT "reserve_pv_id_pv_id_fk" FOREIGN KEY ("pv_id") REFERENCES "public"."pv"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reserve" ADD CONSTRAINT "reserve_version_id_version_pv_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."version_pv"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "version_pv" ADD CONSTRAINT "version_pv_pv_id_pv_id_fk" FOREIGN KEY ("pv_id") REFERENCES "public"."pv"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "version_pv" ADD CONSTRAINT "version_pv_liste_es_id_liste_es_id_fk" FOREIGN KEY ("liste_es_id") REFERENCES "public"."liste_es"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "version_pv" ADD CONSTRAINT "version_pv_signe_par_utilisateur_id_fk" FOREIGN KEY ("signe_par") REFERENCES "public"."utilisateur"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "depot_file_idx" ON "depot" USING btree ("statut","prochaine_tentative");--> statement-breakpoint
CREATE INDEX "point_es_feuille_idx" ON "point_es" USING btree ("feuille_id","ordre");--> statement-breakpoint
CREATE INDEX "pv_affectation_user_idx" ON "pv_affectation" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "pv_affaire_numero_idx" ON "pv" USING btree ("affaire_id","numero");--> statement-breakpoint
CREATE INDEX "pv_equipement_idx" ON "pv" USING btree ("equipement_id");--> statement-breakpoint
CREATE INDEX "reserve_pv_idx" ON "reserve" USING btree ("pv_id");--> statement-breakpoint
CREATE INDEX "version_pv_statut_idx" ON "version_pv" USING btree ("statut");