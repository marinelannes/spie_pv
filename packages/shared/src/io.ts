import { z } from "zod";

/** Types d'E/S après normalisation (spec §4.4). */
export const TYPES_ES = ["entree_tor", "sortie_tor", "entree_analogique"] as const;
export const typeEsSchema = z.enum(TYPES_ES);
export type TypeEs = z.infer<typeof typeEsSchema>;

export const TYPE_ES_LABELS: Record<TypeEs, string> = {
  entree_tor: "Entrée TOR",
  sortie_tor: "Sortie TOR",
  entree_analogique: "Entrée analogique",
};

/** Libellés courts pour les tableaux (PDF, liste tablette). */
export const TYPE_ES_COURTS: Record<TypeEs, string> = {
  entree_tor: "E TOR",
  sortie_tor: "S TOR",
  entree_analogique: "E ANA",
};

/**
 * Texte de cellule Excel ramené à une forme comparable : majuscules, sans accents, espaces simples.
 * « Entrée  analogique » → « ENTREE ANALOGIQUE ».
 */
export function normaliserTexte(v: string): string {
  return v.normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim().toUpperCase();
}

const TYPES_CONNUS: Record<string, TypeEs> = {
  "ENTREE TOR": "entree_tor",
  "E TOR": "entree_tor",
  "SORTIE TOR": "sortie_tor",
  "S TOR": "sortie_tor",
  "ENTREE ANALOGIQUE": "entree_analogique",
  "E ANA": "entree_analogique",
};

/**
 * Normalise le type d'une E/S (spec §4.4) : `ENTREE TOR` / `E TOR` → entrée TOR, `SORTIE TOR` / `S TOR` → sortie TOR,
 * `ENTREE ANALOGIQUE` / `E ANA` → entrée analogique. Renvoie null pour un type inconnu.
 */
export function normaliserTypeEs(brut: string | null | undefined): TypeEs | null {
  if (!brut) return null;
  return TYPES_CONNUS[normaliserTexte(brut)] ?? null;
}

/** E/S de réserve : commentaire `RESERVE` ou `RESERVE CABLEE` (spec §4.4). Importée, marquée et cochée NA. */
export function estCommentaireReserve(commentaire: string | null | undefined): boolean {
  if (!commentaire) return false;
  const n = normaliserTexte(commentaire);
  return n === "RESERVE" || n === "RESERVE CABLEE";
}

/** Adresse comparable pour la détection des doublons : « Q  01 » et « q 01 » sont la même adresse. */
export function normaliserAdresse(adresse: string): string {
  return normaliserTexte(adresse);
}
