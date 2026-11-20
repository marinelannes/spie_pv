ALTER TABLE "reserve" ADD COLUMN "responsable" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "reserve" ADD COLUMN "date_prevue" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "reserve" ADD COLUMN "date_levee" text;--> statement-breakpoint
ALTER TABLE "reserve" ADD COLUMN "commentaire_levee" text;--> statement-breakpoint
-- Reprise des réserves déjà reçues (lot 1) : les nouvelles colonnes sont lues dans le JSON de la version, qui fait foi.
UPDATE "reserve" AS r SET
  "responsable" = coalesce(e.value->>'responsable', ''),
  "date_prevue" = coalesce(e.value->>'datePrevue', ''),
  "date_levee" = e.value->'levee'->>'date',
  "commentaire_levee" = e.value->'levee'->>'commentaire'
FROM "version_pv" AS v, jsonb_array_elements(v."donnees"->'reserves') AS e
WHERE v."id" = r."version_id" AND (e.value->>'numero')::int = r."numero";
