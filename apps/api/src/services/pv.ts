import {
  MODELE_RELAIS,
  MODELE_RELAIS_VERSION,
  avancementEs,
  creerPvRelais,
  modelePvEquipement,
  numeroPv,
  pointsEsDepuisListe,
  statutSuivi,
  type DepotDto,
  type PvDetailDto,
  type PvRelaisData,
  type PvResumeDto,
  type StatutPv,
  type TechnicienDto,
} from "@spie/shared";
import { and, asc, count, eq, inArray, ne } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  affaires,
  affectations,
  depots,
  equipements,
  pvAffectations,
  pvs,
  utilisateurs,
  versionsPv,
} from "../db/schema.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { parisIsoDate } from "../lib/dates.js";
import type { AffaireRow } from "./acces.js";
import { esDeLEquipement, type EquipementRow } from "./io-listes.js";

export type PvRow = typeof pvs.$inferSelect;
export type VersionRow = typeof versionsPv.$inferSelect;
type DepotRow = typeof depots.$inferSelect;

/**
 * Numéro libre pour un PV créé au bureau : n° d'affaire + date et heure de Paris (spec §4.1). Si un PV de l'affaire
 * porte déjà ce numéro (deux créations dans la même seconde), on prend la seconde suivante.
 */
export async function numeroLibre(
  db: Db,
  affaire: AffaireRow,
  maintenant: Date,
): Promise<{ numero: string; creeLe: Date }> {
  let creeLe = new Date(Math.floor(maintenant.getTime() / 1000) * 1000);
  for (;;) {
    const numero = numeroPv(affaire.numero, creeLe);
    const [pris] = await db
      .select({ id: pvs.id })
      .from(pvs)
      .where(and(eq(pvs.affaireId, affaire.id), eq(pvs.numero, numero)));
    if (!pris) return { numero, creeLe };
    creeLe = new Date(creeLe.getTime() + 1000);
  }
}

/** Données d'un PV relais pour un équipement : contenu par défaut + affaire + liste E/S de l'équipement. */
export async function donneesInitiales(
  db: Db,
  affaire: AffaireRow,
  e: EquipementRow,
  date: Date,
): Promise<PvRelaisData> {
  const es = await esDeLEquipement(db, e);
  return creerPvRelais({
    affaire: {
      numero: affaire.numero,
      client: affaire.client,
      projet: affaire.projet,
      valideParDefaut: affaire.valideParDefaut,
      approuveParDefaut: affaire.approuveParDefaut,
    },
    es,
    date: parisIsoDate(date),
    modeleRelais: e.modele,
  });
}

export async function chargerEquipement(db: Db, affaireId: string, equipementId: string): Promise<EquipementRow> {
  const [e] = await db
    .select()
    .from(equipements)
    .where(and(eq(equipements.id, equipementId), eq(equipements.affaireId, affaireId)));
  if (!e) throw badRequest("Équipement introuvable dans cette affaire.");
  return e;
}

/** Le régulateur de tension n'a pas de modèle de PV (spec §4.5) : aucun PV ne peut être créé pour lui. */
export function assertModelePv(e: Pick<EquipementRow, "tag" | "libelle">): void {
  if (!modelePvEquipement(e)) {
    throw badRequest(`${e.tag} : aucun modèle de PV pour cet équipement (seuls les relais de protection ont un PV).`);
  }
}

/** Création d'un PV au bureau (spec §3.1 étape 3) : numéro attribué, révision A, statut « préparé ». */
export async function creerPvPrepare(
  db: Db,
  args: {
    affaire: AffaireRow;
    equipement: EquipementRow;
    userId: string;
    now: Date;
    donnees?: PvRelaisData;
    techniciens?: string[];
  },
): Promise<string> {
  assertModelePv(args.equipement);
  const { numero, creeLe } = await numeroLibre(db, args.affaire, args.now);
  const donnees = args.donnees ?? (await donneesInitiales(db, args.affaire, args.equipement, args.now));
  return db.transaction(async (tx) => {
    const [pv] = await tx
      .insert(pvs)
      .values({
        affaireId: args.affaire.id,
        equipementId: args.equipement.id,
        modele: MODELE_RELAIS,
        numero,
        origine: "bureau",
        creePar: args.userId,
      })
      .returning({ id: pvs.id });
    await tx.insert(versionsPv).values({
      pvId: pv!.id,
      indice: donnees.entete.indice || "A",
      statut: "prepare",
      donnees,
      donneesPreparees: donnees,
      modeleVersion: MODELE_RELAIS_VERSION,
      listeEsId: donnees.es.listeId,
      creeLe,
    });
    if (args.techniciens && args.techniciens.length > 0) {
      await tx.insert(pvAffectations).values(args.techniciens.map((userId) => ({ pvId: pv!.id, userId })));
    }
    return pv!.id;
  });
}

/** PV et sa version courante (la plus récente : indice le plus élevé). */
export async function chargerPv(db: Db, pvId: string): Promise<{ pv: PvRow; version: VersionRow }> {
  const [pv] = await db.select().from(pvs).where(eq(pvs.id, pvId));
  if (!pv) throw notFound("PV introuvable.");
  const versions = await db.select().from(versionsPv).where(eq(versionsPv.pvId, pvId));
  const version = versions.sort((a, b) => a.indice.localeCompare(b.indice)).at(-1);
  if (!version) throw notFound("PV sans version.");
  return { pv, version };
}

/** Modification d'un PV préparé : seulement tant que la version n'a pas été reçue signée. */
export async function majPvPrepare(db: Db, pvId: string, donnees: PvRelaisData, now: Date): Promise<void> {
  const { version } = await chargerPv(db, pvId);
  if (version.statut !== "prepare") throw conflict("Ce PV n'est plus modifiable au bureau : il a été signé sur site.");
  await db
    .update(versionsPv)
    .set({ donnees, donneesPreparees: donnees, listeEsId: donnees.es.listeId, updatedAt: now })
    .where(eq(versionsPv.id, version.id));
}

export async function supprimerPvPrepare(db: Db, pvId: string): Promise<PvRow> {
  const { pv, version } = await chargerPv(db, pvId);
  if (version.statut !== "prepare") throw conflict("Seul un PV préparé, non signé, peut être supprimé.");
  if (version.saisieCommenceeLe)
    throw conflict("La saisie de ce PV a commencé sur tablette : il ne peut plus être supprimé.");
  await db.delete(pvs).where(eq(pvs.id, pvId));
  return pv;
}

/** Affectation d'un PV à des techniciens (spec §3.1 étape 4) : ils doivent être affectés à l'affaire. */
export async function affecterPv(
  db: Db,
  pv: PvRow,
  userIds: string[],
): Promise<{ ajoutes: string[]; retires: string[] }> {
  const ids = [...new Set(userIds)];
  if (ids.length > 0) {
    const ok = await db
      .select({ id: utilisateurs.id })
      .from(utilisateurs)
      .innerJoin(affectations, and(eq(affectations.userId, utilisateurs.id), eq(affectations.affaireId, pv.affaireId)))
      .where(and(inArray(utilisateurs.id, ids), eq(utilisateurs.actif, true)));
    if (ok.length !== ids.length) throw badRequest("Chaque technicien doit être un compte actif affecté à l'affaire.");
  }
  const avant = (
    await db.select({ userId: pvAffectations.userId }).from(pvAffectations).where(eq(pvAffectations.pvId, pv.id))
  ).map((r) => r.userId);
  const ajoutes = ids.filter((u) => !avant.includes(u));
  const retires = avant.filter((u) => !ids.includes(u));
  await db.transaction(async (tx) => {
    if (retires.length > 0) {
      await tx
        .delete(pvAffectations)
        .where(and(eq(pvAffectations.pvId, pv.id), inArray(pvAffectations.userId, retires)));
    }
    if (ajoutes.length > 0) await tx.insert(pvAffectations).values(ajoutes.map((userId) => ({ pvId: pv.id, userId })));
  });
  return { ajoutes, retires };
}

/**
 * Duplication d'un PV préparé vers d'autres équipements (spec §4.6), ex. les 5 départs batterie : réglages, fonctions,
 * LED, matériel… sont repris ; la liste E/S est celle de l'équipement cible ; le numéro de série et l'adresse IP,
 * propres à chaque relais, sont vidés ; les techniciens affectés sont repris.
 */
export async function dupliquerPv(
  db: Db,
  args: {
    source: { pv: PvRow; version: VersionRow };
    affaire: AffaireRow;
    equipementIds: string[];
    userId: string;
    now: Date;
  },
): Promise<string[]> {
  if (args.source.version.statut !== "prepare") throw conflict("Seul un PV préparé (non signé) peut être dupliqué.");
  const techniciens = (
    await db
      .select({ userId: pvAffectations.userId })
      .from(pvAffectations)
      .where(eq(pvAffectations.pvId, args.source.pv.id))
  ).map((r) => r.userId);
  // Toutes les cibles sont vérifiées avant de créer le premier PV : pas de duplication partielle.
  const cibles: EquipementRow[] = [];
  for (const equipementId of [...new Set(args.equipementIds)]) {
    if (equipementId === args.source.pv.equipementId)
      throw badRequest("Un PV ne peut pas être dupliqué vers son propre équipement.");
    const cible = await chargerEquipement(db, args.affaire.id, equipementId);
    assertModelePv(cible);
    cibles.push(cible);
  }
  const crees: string[] = [];
  for (const cible of cibles) {
    const es = await esDeLEquipement(db, cible);
    const src = structuredClone(args.source.version.donnees);
    const donnees: PvRelaisData = {
      ...src,
      identification: src.identification.map((f) => {
        if (f.id === "numero-serie" || f.id === "adresse-ip") return { ...f, valeur: "" };
        if (f.id === "modele" && cible.modele) return { ...f, valeur: cible.modele };
        return f;
      }),
      es: es
        ? {
            listeId: es.listeId,
            listeVersion: es.listeVersion,
            referenceDocument: es.referenceDocument,
            revision: es.revision,
            feuille: es.feuille,
            filtreTag: es.filtreTag,
            points: pointsEsDepuisListe(es.points),
          }
        : {
            listeId: null,
            listeVersion: null,
            referenceDocument: "",
            revision: "",
            feuille: "",
            filtreTag: null,
            points: [],
          },
    };
    crees.push(
      await creerPvPrepare(db, {
        affaire: args.affaire,
        equipement: cible,
        userId: args.userId,
        now: args.now,
        donnees,
        techniciens,
      }),
    );
  }
  return crees;
}

function depotDto(d: DepotRow): DepotDto {
  return {
    id: d.id,
    fichier: d.fichier,
    nom: d.nom,
    statut: d.statut,
    tentatives: d.tentatives,
    derniereErreur: d.derniereErreur,
    prochaineTentative: d.statut === "en_attente" ? (d.prochaineTentative?.toISOString() ?? null) : null,
    webUrl: d.webUrl,
    cheminSharePoint: d.cheminSharePoint,
    deposeLe: d.deposeLe?.toISOString() ?? null,
  };
}

export async function depotsDeVersions(db: Db, versionIds: string[]): Promise<Map<string, DepotDto[]>> {
  const out = new Map<string, DepotDto[]>();
  if (versionIds.length === 0) return out;
  const rows = await db.select().from(depots).where(inArray(depots.versionId, versionIds)).orderBy(asc(depots.fichier));
  for (const d of rows) out.set(d.versionId, [...(out.get(d.versionId) ?? []), depotDto(d)]);
  return out;
}

/** Numéros portés par plusieurs PV d'une même affaire (spec §4.1 : le serveur détecte et alerte). */
export async function numerosEnDoublon(db: Db, affaireIds: string[]): Promise<Set<string>> {
  if (affaireIds.length === 0) return new Set();
  const rows = await db
    .select({ affaireId: pvs.affaireId, numero: pvs.numero, n: count(pvs.id) })
    .from(pvs)
    .where(inArray(pvs.affaireId, affaireIds))
    .groupBy(pvs.affaireId, pvs.numero);
  return new Set(rows.filter((r) => Number(r.n) > 1).map((r) => `${r.affaireId}|${r.numero}`));
}

export async function autrePvMemeNumero(db: Db, pv: Pick<PvRow, "id" | "affaireId" | "numero">): Promise<boolean> {
  const [autre] = await db
    .select({ id: pvs.id })
    .from(pvs)
    .where(and(eq(pvs.affaireId, pv.affaireId), eq(pvs.numero, pv.numero), ne(pvs.id, pv.id)));
  return Boolean(autre);
}

export interface FiltrePv {
  affaireIds?: string[];
  pvIds?: string[];
  equipementId?: string;
  statut?: StatutPv;
  technicienId?: string;
  modele?: string;
}

/** Liste de suivi des PV (spec §4.6) avec la version courante de chacun. */
export async function resumesPv(db: Db, f: FiltrePv): Promise<PvResumeDto[]> {
  return (await chargerResumes(db, f, false)) as PvResumeDto[];
}

export async function detailPv(db: Db, pvId: string): Promise<PvDetailDto> {
  const [d] = (await chargerResumes(db, { pvIds: [pvId] }, true)) as PvDetailDto[];
  if (!d) throw notFound("PV introuvable.");
  return d;
}

async function chargerResumes(db: Db, f: FiltrePv, detail: boolean): Promise<(PvResumeDto | PvDetailDto)[]> {
  if (f.affaireIds?.length === 0 || f.pvIds?.length === 0) return [];
  const conds = [];
  if (f.affaireIds) conds.push(inArray(pvs.affaireId, f.affaireIds));
  if (f.pvIds) conds.push(inArray(pvs.id, f.pvIds));
  if (f.equipementId) conds.push(eq(pvs.equipementId, f.equipementId));
  if (f.modele) conds.push(eq(pvs.modele, f.modele));
  if (f.technicienId) {
    const ids = (
      await db
        .select({ pvId: pvAffectations.pvId })
        .from(pvAffectations)
        .where(eq(pvAffectations.userId, f.technicienId))
    ).map((r) => r.pvId);
    if (ids.length === 0) return [];
    conds.push(inArray(pvs.id, ids));
  }
  const rows = await db
    .select({ pv: pvs, affaireNumero: affaires.numero, eqTag: equipements.tag, eqLibelle: equipements.libelle })
    .from(pvs)
    .innerJoin(affaires, eq(pvs.affaireId, affaires.id))
    .leftJoin(equipements, eq(pvs.equipementId, equipements.id))
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(asc(affaires.numero), asc(equipements.tag), asc(pvs.numero));
  if (rows.length === 0) return [];

  const pvIds = rows.map((r) => r.pv.id);
  const versions = await db.select().from(versionsPv).where(inArray(versionsPv.pvId, pvIds));
  const courante = new Map<string, VersionRow>();
  for (const v of versions.sort((a, b) => a.indice.localeCompare(b.indice))) courante.set(v.pvId, v);

  const tech = await db
    .select({ pvId: pvAffectations.pvId, id: utilisateurs.id, nom: utilisateurs.nom })
    .from(pvAffectations)
    .innerJoin(utilisateurs, eq(pvAffectations.userId, utilisateurs.id))
    .where(inArray(pvAffectations.pvId, pvIds))
    .orderBy(asc(utilisateurs.nom));
  const techParPv = new Map<string, TechnicienDto[]>();
  for (const t of tech) techParPv.set(t.pvId, [...(techParPv.get(t.pvId) ?? []), { id: t.id, nom: t.nom }]);

  const depotsParVersion = await depotsDeVersions(
    db,
    [...courante.values()].map((v) => v.id),
  );
  const doublons = await numerosEnDoublon(db, [...new Set(rows.map((r) => r.pv.affaireId))]);

  const out: (PvResumeDto | PvDetailDto)[] = [];
  for (const r of rows) {
    const v = courante.get(r.pv.id);
    if (!v) continue;
    // Filtre sur le statut de suivi : un PV préparé dont la saisie a commencé est « en cours de saisie ».
    if (f.statut && statutSuivi({ statut: v.statut, saisieCommenceeLe: v.saisieCommenceeLe }) !== f.statut) continue;
    const av = avancementEs(v.donnees.es.points);
    const resume: PvResumeDto = {
      pvId: r.pv.id,
      versionId: v.id,
      numero: r.pv.numero,
      indice: v.indice,
      modele: r.pv.modele,
      affaireId: r.pv.affaireId,
      affaireNumero: r.affaireNumero,
      equipementId: r.pv.equipementId,
      equipementTag: r.eqTag,
      equipementLibelle: r.eqLibelle,
      statut: v.statut,
      statutDocument: v.statutDocument,
      techniciens: techParPv.get(r.pv.id) ?? [],
      saisieCommenceeLe: v.saisieCommenceeLe?.toISOString() ?? null,
      signeLe: v.signeLe?.toISOString() ?? null,
      recuLe: v.recuLe?.toISOString() ?? null,
      creeLe: v.creeLe.toISOString(),
      misAJourLe: v.updatedAt.toISOString(),
      nbModifications: v.modifications.length,
      avancementEs: { total: av.total, testees: av.testees, nc: av.nc },
      alerteDoublon: doublons.has(`${r.pv.affaireId}|${r.pv.numero}`),
      depots: depotsParVersion.get(v.id) ?? [],
    };
    out.push(
      detail
        ? {
            ...resume,
            donnees: v.donnees,
            donneesPreparees: v.donneesPreparees,
            modifications: v.modifications,
            empreinte: v.empreinte,
          }
        : resume,
    );
  }
  return out;
}

export async function techniciensDeLAffaire(db: Db, affaireId: string): Promise<TechnicienDto[]> {
  return db
    .select({ id: utilisateurs.id, nom: utilisateurs.nom })
    .from(affectations)
    .innerJoin(utilisateurs, eq(affectations.userId, utilisateurs.id))
    .where(and(eq(affectations.affaireId, affaireId), eq(utilisateurs.actif, true)))
    .orderBy(asc(utilisateurs.nom));
}
