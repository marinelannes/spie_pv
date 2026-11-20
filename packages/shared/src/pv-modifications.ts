import { canonicalJson } from "./empreinte.js";
import type { Trace } from "./pv-relais.js";

/**
 * Valeurs pré-remplies modifiées sur site (spec §4.2) : la valeur préparée est conservée (donnees_preparees) et la
 * modification est signalée dans le back-office avec son auteur et sa date.
 */
export interface ValeurModifiee {
  /** Chemin lisible, ex. `fonctions[f1].reglages` (les éléments de liste sont désignés par leur id). */
  chemin: string;
  avant: unknown;
  /** null si l'élément préparé a été supprimé. */
  apres: unknown;
}

export interface ModificationTracee extends ValeurModifiee {
  par: string;
  le: string;
}

const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const estVide = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

const egal = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null);

const avecIds = (a: unknown[]): a is { id: string }[] => a.every((x) => estObjet(x) && typeof x.id === "string");

/**
 * Compare les données préparées et les données actuelles. Ne sont rapportées que les valeurs qui étaient
 * renseignées à la préparation (une valeur vide complétée sur site n'est pas une modification).
 */
export function valeursPrepareesModifiees(preparees: unknown, actuelles: unknown): ValeurModifiee[] {
  const out: ValeurModifiee[] = [];
  const visit = (p: unknown, c: unknown, chemin: string) => {
    if (estVide(p)) return;
    if (estObjet(p)) {
      if (!estObjet(c)) {
        out.push({ chemin, avant: p, apres: c ?? null });
        return;
      }
      for (const k of Object.keys(p)) visit(p[k], c[k], chemin ? `${chemin}.${k}` : k);
      return;
    }
    if (Array.isArray(p) && avecIds(p) && Array.isArray(c) && avecIds(c)) {
      const parId = new Map(c.map((x) => [x.id, x] as const));
      for (const item of p) {
        const sub = `${chemin}[${item.id}]`;
        const courant = parId.get(item.id);
        if (courant === undefined) out.push({ chemin: sub, avant: item, apres: null });
        else visit(item, courant, sub);
      }
      return;
    }
    // Liste d'objets sans id (ex. tableau des révisions) : comparaison élément par élément, par position, pour ne
    // pas signaler comme modifié un champ vide au bureau et complété sur site (« Écrit par »).
    if (Array.isArray(p) && Array.isArray(c) && p.every(estObjet)) {
      p.forEach((item, i) => {
        const sub = `${chemin}[${i}]`;
        if (i >= c.length) out.push({ chemin: sub, avant: item, apres: null });
        else visit(item, c[i], sub);
      });
      return;
    }
    if (!egal(p, c)) out.push({ chemin, avant: p, apres: c ?? null });
  };
  visit(preparees, actuelles, "");
  return out;
}

/**
 * Met à jour le journal des modifications à chaque enregistrement : une modification nouvelle (ou dont la valeur a
 * encore changé) reçoit l'auteur et la date courants ; une modification annulée disparaît du journal.
 */
export function majJournalModifications(
  journal: readonly ModificationTracee[],
  modifiees: readonly ValeurModifiee[],
  trace: Trace,
): ModificationTracee[] {
  const precedent = new Map(journal.map((j) => [j.chemin, j] as const));
  return modifiees.map((m) => {
    const p = precedent.get(m.chemin);
    if (p && egal(p.apres, m.apres)) return { ...m, par: p.par, le: p.le };
    return { ...m, par: trace.par, le: trace.le };
  });
}
