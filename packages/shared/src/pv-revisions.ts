import { canonicalJson } from "./empreinte.js";
import type { PvRelaisData, Reserve } from "./pv-relais.js";

/**
 * Révisions d'un PV et levée de réserves (spec §3.4, §4.3). Une révision signée ne change plus : la suivante reprend
 * ses données, vide les signatures et le statut du document, et ajoute une ligne au tableau des révisions.
 */

/** Indice suivant (A → B … Y → Z). null après Z, ou si l'indice n'est pas une lettre majuscule. */
export function indiceSuivant(indice: string): string | null {
  if (!/^[A-Y]$/.test(indice)) return null;
  return String.fromCharCode(indice.charCodeAt(0) + 1);
}

/** Ordre des indices de révision (A < B < … < Z), indépendant de la langue du poste ou du serveur. */
export function comparerIndices(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Révisions de la plus ancienne à la plus récente (nouveau tableau). */
export function trierParIndice<T extends { indice: string }>(versions: readonly T[]): T[] {
  return [...versions].sort((a, b) => comparerIndices(a.indice, b.indice));
}

/** Révision courante d'un PV : celle dont l'indice est le plus élevé. */
export function versionCourante<T extends { indice: string }>(versions: readonly T[]): T | undefined {
  let courante: T | undefined;
  for (const v of versions) if (!courante || comparerIndices(v.indice, courante.indice) > 0) courante = v;
  return courante;
}

/**
 * Base de comparaison des « valeurs pré-remplies modifiées sur site » (spec §4.2) pour une révision : la préparation
 * faite au bureau, reprise de la révision précédente, et non l'ensemble des données de cette révision. Les saisies
 * de site reprises (résultats d'E/S, jugements, réserves, observations) n'ont jamais été « pré-remplies » : elles
 * évoluent d'une révision à l'autre sans être signalées. null : PV créé sur site, rien n'a été préparé.
 */
export function baseSuiviRevision(prepareesPrecedentes: PvRelaisData | null, indice: string): PvRelaisData | null {
  if (!prepareesPrecedentes) return null;
  return { ...prepareesPrecedentes, entete: { ...prepareesPrecedentes.entete, indice } };
}

export interface ContexteRevision {
  indice: string;
  /** Date de création de la révision (AAAA-MM-JJ, heure de Paris). */
  date: string;
  /** Description de la modification, reportée dans le tableau des révisions. */
  modifications: string;
}

/**
 * Données de la révision suivante (spec §3.4) : tout est repris de la révision précédente, sauf les signatures et
 * le statut BPO / BPE / CMS, vidés. « Validé par » et « Approuvé par » sont repris de la ligne précédente ;
 * « Écrit par » sera le signataire.
 */
export function creerRevisionSuivante(precedente: PvRelaisData, ctx: ContexteRevision): PvRelaisData {
  const derniere = precedente.revisions.at(-1);
  return {
    ...structuredClone(precedente),
    entete: { ...precedente.entete, indice: ctx.indice, statutDocument: null },
    revisions: [
      ...precedente.revisions,
      {
        indice: ctx.indice,
        date: ctx.date,
        ecritPar: "",
        validePar: derniere?.validePar ?? "",
        approuvePar: derniere?.approuvePar ?? "",
        modifications: ctx.modifications.trim(),
      },
    ],
    signatures: {
      spie: { nom: "", date: "", signature: null, commentaires: "" },
      client: { nom: "", date: "", signature: null, commentaires: "", refus: null },
    },
  };
}

/** Le PV est-il une révision (indice B ou plus) ? */
export function estRevision(d: Pick<PvRelaisData, "revisions">): boolean {
  return d.revisions.length > 1;
}

/** Réserve créée dans une révision précédente : elle ne se supprime pas et sa description est figée. */
export function reserveHeritee(d: Pick<PvRelaisData, "entete">, r: Pick<Reserve, "indiceCreation">): boolean {
  return r.indiceCreation !== d.entete.indice;
}

/** Lève une réserve ouverte (spec §4.3) : date, commentaire, indice de la révision qui la lève. */
export function leverReserve(
  d: PvRelaisData,
  reserveId: string,
  levee: { date: string; commentaire?: string },
): PvRelaisData {
  return {
    ...d,
    reserves: d.reserves.map((r) =>
      r.id === reserveId && r.statut === "ouverte"
        ? {
            ...r,
            statut: "levee" as const,
            levee: { date: levee.date, commentaire: levee.commentaire ?? "", indice: d.entete.indice },
          }
        : r,
    ),
  };
}

/** Une levée ne s'annule que dans la révision qui l'a prononcée : les révisions signées ne changent plus. */
export function leveeAnnulable(d: Pick<PvRelaisData, "entete">, r: Pick<Reserve, "statut" | "levee">): boolean {
  return r.statut === "levee" && r.levee?.indice === d.entete.indice;
}

export function annulerLevee(d: PvRelaisData, reserveId: string): PvRelaisData {
  return {
    ...d,
    reserves: d.reserves.map((r) =>
      r.id === reserveId && leveeAnnulable(d, r) ? { ...r, statut: "ouverte" as const, levee: null } : r,
    ),
  };
}

/** Réserve ouverte dont la date prévue de levée est dépassée (`aujourdHui` : AAAA-MM-JJ). */
export function reserveEnRetard(r: { statut: string; datePrevue: string }, aujourdHui: string): boolean {
  return r.statut === "ouverte" && r.datePrevue !== "" && r.datePrevue < aujourdHui;
}

const egal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

/**
 * Contrôle d'intégrité d'une révision face à la précédente (spec §1.5 : « chaque révision signée reste visible et ne
 * change plus », §4.3 : « les réserves sont reportées d'une révision à l'autre »). Renvoie les anomalies constatées.
 */
export function controlesRevision(precedente: PvRelaisData, courante: PvRelaisData): string[] {
  const out: string[] = [];
  const indice = courante.entete.indice;
  if (indiceSuivant(precedente.entete.indice) !== indice) {
    out.push(`L'indice ${indice} ne suit pas l'indice ${precedente.entete.indice}.`);
  }

  const lignes = courante.revisions;
  if (lignes.length !== precedente.revisions.length + 1 || lignes.at(-1)?.indice !== indice) {
    out.push(`Le tableau des révisions doit se terminer par une seule ligne nouvelle, d'indice ${indice}.`);
  }
  if (precedente.revisions.some((r, i) => !egal(r, lignes[i]))) {
    out.push("Les lignes des révisions précédentes ont été modifiées dans le tableau des révisions.");
  }

  const parId = new Map(courante.reserves.map((r) => [r.id, r] as const));
  for (const p of precedente.reserves) {
    const c = parId.get(p.id);
    if (!c) {
      out.push(
        `La réserve n°${p.numero} de l'indice ${p.indiceCreation} a disparu : une réserve se lève, elle ne se supprime pas.`,
      );
      continue;
    }
    if (c.numero !== p.numero || c.indiceCreation !== p.indiceCreation) {
      out.push(`La réserve n°${p.numero} a changé de numéro ou d'indice de création.`);
    }
    if (p.statut === "levee" && !(c.statut === "levee" && egal(c.levee, p.levee))) {
      out.push(`La levée de la réserve n°${p.numero}, prononcée à l'indice ${p.levee?.indice ?? "?"}, a été modifiée.`);
    }
    if (p.statut === "ouverte" && c.statut === "levee" && c.levee?.indice !== indice) {
      out.push(`La réserve n°${p.numero} est levée dans cette révision : l'indice de levée doit être ${indice}.`);
    }
  }
  const anciennes = new Set(precedente.reserves.map((r) => r.id));
  for (const c of courante.reserves) {
    if (anciennes.has(c.id)) continue;
    if (c.indiceCreation !== indice) {
      out.push(`La réserve n°${c.numero} est nouvelle : son indice de création doit être ${indice}.`);
    }
    if (c.statut === "levee" && c.levee?.indice !== indice) {
      out.push(`La réserve n°${c.numero} est levée dans cette révision : l'indice de levée doit être ${indice}.`);
    }
  }
  return out;
}
