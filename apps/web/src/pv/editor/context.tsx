import type { PvRelaisData, Trace } from "@spie/shared";
import { createContext, use } from "react";

/**
 * Même formulaire en mode « preparation » (bureau : valeurs pré-remplies) et en mode « saisie » (site : mesures,
 * jugements, observations, en plus de la correction des valeurs préparées), spec §4.6 et §8.2.
 */
export type ModeEditeur = "preparation" | "saisie";

export type MajPv = (fn: (d: PvRelaisData) => PvRelaisData) => void;

export interface EditeurContextValue {
  donnees: PvRelaisData;
  /** Données préparées au bureau (repère des valeurs corrigées sur site), null en préparation ou PV créé sur site. */
  preparees: PvRelaisData | null;
  maj: MajPv;
  mode: ModeEditeur;
  lectureSeule: boolean;
  /** Auteur et horodatage des saisies d'E/S (spec §4.4). */
  trace: () => Trace;
}

export const EditeurContext = createContext<EditeurContextValue | null>(null);

export function useEditeur(): EditeurContextValue & { site: boolean } {
  const ctx = use(EditeurContext);
  if (!ctx) throw new Error("useEditeur hors de l'éditeur de PV");
  return { ...ctx, site: ctx.mode === "saisie" };
}

/** Met à jour l'élément `id` d'une liste. */
export function majItem<T extends { id: string }>(liste: readonly T[], id: string, patch: Partial<T>): T[] {
  return liste.map((x) => (x.id === id ? { ...x, ...patch } : x));
}

export function retirerItem<T extends { id: string }>(liste: readonly T[], id: string): T[] {
  return liste.filter((x) => x.id !== id);
}

/** Déplace l'élément `id` d'un cran vers le haut (-1) ou le bas (+1). */
export function deplacerItem<T extends { id: string }>(liste: readonly T[], id: string, sens: -1 | 1): T[] {
  const i = liste.findIndex((x) => x.id === id);
  const j = i + sens;
  if (i < 0 || j < 0 || j >= liste.length) return [...liste];
  const copie = [...liste];
  [copie[i], copie[j]] = [copie[j]!, copie[i]!];
  return copie;
}

const vide = (v: unknown) => v === null || v === undefined || v === "";

/** Une valeur préparée (non vide) a-t-elle été corrigée ? (repère visuel, spec §4.2) */
export function estCorrige(prepare: unknown, actuel: unknown): boolean {
  if (vide(prepare)) return false;
  return JSON.stringify(prepare) !== JSON.stringify(actuel ?? null);
}

/**
 * Nombre saisi au pavé numérique : virgule ou point décimal. Renvoie null pour une saisie vide, undefined pour une
 * saisie invalide (le champ garde alors le texte sans changer la valeur).
 */
export function parseNombre(texte: string): number | null | undefined {
  const t = texte.trim().replace(/\s/g, "").replace(",", ".");
  if (t === "") return null;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/** Affichage français d'un nombre (virgule décimale), chaîne vide pour null. */
export function formatNombre(n: number | null): string {
  return n === null ? "" : String(n).replace(".", ",");
}
