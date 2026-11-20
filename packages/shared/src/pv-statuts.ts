import { z } from "zod";

/** Statuts d'une version de PV (spec §6.4). */
export const STATUTS_PV = ["prepare", "brouillon", "signe", "recu", "depose", "erreur"] as const;
export const statutPvSchema = z.enum(STATUTS_PV);
export type StatutPv = z.infer<typeof statutPvSchema>;

export const STATUT_PV_LABELS: Record<StatutPv, string> = {
  prepare: "Préparé",
  brouillon: "En cours de saisie",
  signe: "Signé, en attente d'envoi",
  recu: "Reçu par le serveur",
  depose: "Déposé dans SharePoint",
  erreur: "Erreur de dépôt",
};

const TRANSITIONS: Record<StatutPv, readonly StatutPv[]> = {
  prepare: ["brouillon"],
  brouillon: ["signe"],
  signe: ["recu"],
  recu: ["depose", "erreur"],
  erreur: ["depose", "recu"],
  depose: [],
};

/** Transitions du diagramme d'états (spec §6.4). `erreur → recu` : relance d'un dépôt par l'administrateur. */
export function transitionPvPermise(de: StatutPv, vers: StatutPv): boolean {
  return TRANSITIONS[de].includes(vers);
}

/**
 * Statut affiché au bureau (suivi, spec §4.6). Le serveur ne connaît que « préparé », « reçu », « déposé » et
 * « erreur » : la saisie et la signature ont lieu hors ligne. Un PV préparé dont la tablette a signalé le début de
 * saisie est montré « en cours de saisie ». « Signé, en attente d'envoi » n'existe que sur la tablette.
 */
export function statutSuivi(v: { statut: StatutPv; saisieCommenceeLe: string | Date | null }): StatutPv {
  return v.statut === "prepare" && v.saisieCommenceeLe ? "brouillon" : v.statut;
}

/** Statuts proposés au filtre du suivi : ceux que le serveur peut constater (pas « signé, en attente d'envoi »). */
export const STATUTS_SUIVI: readonly StatutPv[] = ["prepare", "brouillon", "recu", "depose", "erreur"];

/** Une version figée (signée) ne se modifie plus (spec §3.2 étape 8). */
export function versionFigee(statut: StatutPv): boolean {
  return statut !== "prepare" && statut !== "brouillon";
}

/** Fichiers produits pour chaque version signée (spec §5.1). */
export const TYPES_FICHIER = ["pdf", "json", "xlsx"] as const;
export const typeFichierSchema = z.enum(TYPES_FICHIER);
export type TypeFichier = z.infer<typeof typeFichierSchema>;

/** Statuts d'un dépôt de fichier dans SharePoint (spec §5.4). */
export const STATUTS_DEPOT = ["en_attente", "depose", "erreur"] as const;
export type StatutDepot = (typeof STATUTS_DEPOT)[number];

export const STATUT_DEPOT_LABELS: Record<StatutDepot, string> = {
  en_attente: "En attente",
  depose: "Déposé",
  erreur: "Erreur",
};

/**
 * Reprises automatiques avec un délai croissant (spec §5.4) : 1 min, 5 min, 30 min, 2 h, 6 h, puis statut Erreur.
 * `tentatives` = nombre d'échecs déjà constatés (1 après le premier échec). Renvoie null quand il faut abandonner.
 */
export const DELAIS_REPRISE_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000] as const;

export function delaiReprise(tentatives: number): number | null {
  if (tentatives < 1) return 0;
  return DELAIS_REPRISE_MS[tentatives - 1] ?? null;
}
