import { z } from "zod";

/** Jugements du glossaire du modèle (spec §4.2) : Conforme, Non conforme, Non applicable. */
export const JUGEMENTS = ["C", "NC", "NA"] as const;
export const jugementSchema = z.enum(JUGEMENTS);
export type Jugement = z.infer<typeof jugementSchema>;

export const JUGEMENT_LABELS: Record<Jugement, string> = {
  C: "Conforme",
  NC: "Non conforme",
  NA: "Non applicable",
};

/** LED et relais activés (spec §4.4). */
export const OK_NOK = ["OK", "NOK"] as const;
export const okNokSchema = z.enum(OK_NOK);
export type OkNok = z.infer<typeof okNokSchema>;

/** Remontée SCADA : C / NC uniquement (spec §4.4). */
export const JUGEMENTS_SCADA = ["C", "NC"] as const;
export const jugementScadaSchema = z.enum(JUGEMENTS_SCADA);
export type JugementScada = z.infer<typeof jugementScadaSchema>;

/** Statut du document, choisi par le technicien à la signature (spec §4.1). */
export const STATUTS_DOCUMENT = ["BPO", "BPE", "CMS"] as const;
export const statutDocumentSchema = z.enum(STATUTS_DOCUMENT);
export type StatutDocument = z.infer<typeof statutDocumentSchema>;

export const STATUT_DOCUMENT_LABELS: Record<StatutDocument, string> = {
  BPO: "Bon Pour Observation",
  BPE: "Bon Pour Exécution",
  CMS: "Conforme à la Mise en Service",
};

/** Conclusion générale (spec §4.1). */
export const CONCLUSIONS = ["accepte", "refuse"] as const;
export const conclusionSchema = z.enum(CONCLUSIONS);
export type Conclusion = z.infer<typeof conclusionSchema>;

export const CONCLUSION_LABELS: Record<Conclusion, string> = {
  accepte: "Matériel accepté",
  refuse: "Matériel refusé",
};
