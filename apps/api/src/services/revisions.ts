import {
  MODELE_RELAIS_VERSION,
  STATUT_PV_LABELS,
  baseSuiviRevision,
  creerRevisionSuivante,
  indiceSuivant,
  reserveEnRetard,
  statutSuivi,
  trierParIndice,
  versionCourante,
  versionFigee,
  type ReserveSuiviDto,
  type ReservesQuery,
  type SyncPvDeposeDto,
  type SyncPvDto,
} from "@spie/shared";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { affaires, equipements, pvAffectations, pvs, reserves, versionsPv } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { parisIsoDate } from "../lib/dates.js";
import { conflict, notFound } from "../lib/errors.js";
import { assertAffaireTerrain } from "./acces.js";
import type { UserRow } from "./users.js";

/** Violation d'unicité PostgreSQL (23505), directe ou enveloppée par Drizzle. */
function estViolationUnicite(err: unknown): boolean {
  for (let e: unknown = err, i = 0; e && i < 4; i++) {
    if (typeof e === "object" && (e as { code?: unknown }).code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Création de la révision suivante d'un PV déposé (spec §3.4). Le serveur réserve l'indice : tant que cette
 * révision n'est pas elle-même déposée, aucune autre ne peut être créée, ce qui empêche deux modifications en
 * parallèle. La révision reprend les données de la précédente ; signatures et statut du document sont vidés.
 * Elle est remise à la tablette comme un PV préparé (saisie hors ligne possible ensuite).
 */
export async function creerRevision(
  db: Db,
  args: { user: UserRow; pvId: string; modifications: string; affecter?: boolean; now: Date; ip?: string },
): Promise<SyncPvDto> {
  const { user, pvId, now } = args;
  const [pv] = await db.select().from(pvs).where(eq(pvs.id, pvId));
  if (!pv) throw notFound("PV introuvable.");
  const affaire = await assertAffaireTerrain(db, user, pv.affaireId);
  // Une affaire archivée n'est plus livrée aux tablettes : la révision resterait « préparée » et verrouillerait le PV.
  if (affaire.archivee) {
    throw conflict(`L'affaire ${affaire.numero} est archivée : aucune révision ne peut y être créée.`);
  }

  const versions = await db.select().from(versionsPv).where(eq(versionsPv.pvId, pvId));
  const courante = versionCourante(versions);
  if (!courante) throw notFound("PV sans version.");
  if (courante.statut !== "depose") {
    if (versions.length > 1 && !versionFigee(courante.statut)) {
      throw conflict(
        `La révision ${courante.indice} de ce PV existe déjà (${STATUT_PV_LABELS[statutSuivi(courante)].toLowerCase()}) : synchronisez la tablette pour la récupérer.`,
      );
    }
    throw conflict("La révision suivante ne se crée qu'à partir d'un PV déposé dans SharePoint.");
  }
  const indice = indiceSuivant(courante.indice);
  if (!indice) throw conflict(`Le PV est à l'indice ${courante.indice} : aucun indice suivant n'est disponible.`);

  const donnees = creerRevisionSuivante(courante.donnees, {
    indice,
    date: parisIsoDate(now),
    modifications: args.modifications,
  });
  // Repère des valeurs pré-remplies modifiées : la préparation d'origine, reprise de révision en révision.
  const donneesPreparees = baseSuiviRevision(courante.donneesPreparees, indice);
  let versionId: string;
  try {
    versionId = await db.transaction(async (tx) => {
      const [v] = await tx
        .insert(versionsPv)
        .values({
          pvId,
          indice,
          statut: "prepare",
          donnees,
          donneesPreparees,
          // Le journal (auteur, date) des valeurs déjà modifiées dans les révisions précédentes est conservé.
          modifications: courante.modifications,
          modeleVersion: MODELE_RELAIS_VERSION,
          listeEsId: courante.listeEsId,
          creeLe: now,
        })
        .returning({ id: versionsPv.id });
      // Qui rouvre un PV pour le compléter lui-même en devient l'un des techniciens (spec §2) : le technicien
      // toujours, un préparateur ou un administrateur quand il le fait depuis la tablette. Sans cela, la révision
      // ne lui serait pas resynchronisée et son envoi signé serait refusé (« ce PV ne vous est pas affecté »).
      if (user.role === "technicien" || args.affecter) {
        await tx.insert(pvAffectations).values({ pvId, userId: user.id }).onConflictDoNothing();
      }
      await tx.update(pvs).set({ updatedAt: now }).where(eq(pvs.id, pvId));
      return v!.id;
    });
  } catch (err) {
    // Deux demandes simultanées : la contrainte (pv, indice) n'en laisse passer qu'une.
    if (estViolationUnicite(err)) throw conflict(`La révision ${indice} de ce PV vient d'être créée par ailleurs.`);
    throw err;
  }
  await audit(db, {
    action: "pv.revision_creee",
    actorId: user.id,
    targetType: "pv",
    targetId: pvId,
    details: { numero: pv.numero, indice, affaire: affaire.numero, modifications: args.modifications },
    ip: args.ip,
  });
  return {
    pvId,
    versionId,
    numero: pv.numero,
    indice,
    modele: pv.modele,
    modeleVersion: MODELE_RELAIS_VERSION,
    affaireId: pv.affaireId,
    equipementId: pv.equipementId,
    statut: "prepare",
    donnees,
    donneesPreparees,
    creeLe: now.toISOString(),
    misAJourLe: now.toISOString(),
  };
}

interface VersionLegere {
  id: string;
  pvId: string;
  indice: string;
  statut: (typeof versionsPv.$inferSelect)["statut"];
  deposeLe: Date | null;
}

async function versionsLegeres(db: Db, affaireIds: string[]) {
  return db
    .select({
      id: versionsPv.id,
      pvId: versionsPv.pvId,
      indice: versionsPv.indice,
      statut: versionsPv.statut,
      deposeLe: versionsPv.deposeLe,
      numero: pvs.numero,
      affaireId: pvs.affaireId,
      equipementId: pvs.equipementId,
    })
    .from(versionsPv)
    .innerJoin(pvs, eq(versionsPv.pvId, pvs.id))
    .where(inArray(pvs.affaireId, affaireIds));
}

function parPv<T extends VersionLegere>(versions: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const v of trierParIndice(versions)) {
    out.set(v.pvId, [...(out.get(v.pvId) ?? []), v]);
  }
  return out;
}

async function recapParVersion(db: Db, versionIds: string[]) {
  const out = new Map<string, { ouvertes: number; levees: number }>();
  if (versionIds.length === 0) return out;
  const rows = await db
    .select({ versionId: reserves.versionId, statut: reserves.statut })
    .from(reserves)
    .where(inArray(reserves.versionId, versionIds));
  for (const r of rows) {
    const c = out.get(r.versionId) ?? { ouvertes: 0, levees: 0 };
    if (r.statut === "ouverte") c.ouvertes++;
    else c.levees++;
    out.set(r.versionId, c);
  }
  return out;
}

/** PV dont la révision courante est déposée : la révision suivante peut être créée depuis la tablette. */
export async function pvsDeposes(db: Db, affaireIds: string[]): Promise<SyncPvDeposeDto[]> {
  if (affaireIds.length === 0) return [];
  const courantes = [...parPv(await versionsLegeres(db, affaireIds)).values()]
    .map((vs) => vs.at(-1)!)
    .filter((v) => v.statut === "depose");
  const recap = await recapParVersion(
    db,
    courantes.map((v) => v.id),
  );
  return courantes
    .map((v) => ({
      pvId: v.pvId,
      versionId: v.id,
      numero: v.numero,
      indice: v.indice,
      affaireId: v.affaireId,
      equipementId: v.equipementId,
      deposeLe: v.deposeLe?.toISOString() ?? null,
      reserves: recap.get(v.id) ?? { ouvertes: 0, levees: 0 },
    }))
    .sort((a, b) => a.numero.localeCompare(b.numero));
}

/**
 * Suivi des réserves dans le back-office (spec §4.3, lot 2) : pour chaque PV, les réserves telles qu'elles figurent
 * dans sa dernière révision signée (reçue ou déposée). Une révision en préparation ou en cours de saisie ne compte
 * pas encore : la levée n'est acquise qu'à la signature.
 */
export async function reservesSuivi(
  db: Db,
  f: { affaireIds: string[]; statut?: ReservesQuery["statut"]; criticite?: ReservesQuery["criticite"]; now: Date },
): Promise<ReserveSuiviDto[]> {
  if (f.affaireIds.length === 0) return [];
  const signees = new Map<string, { versionId: string; indice: string; enCours: string | null }>();
  for (const [pvId, vs] of parPv(await versionsLegeres(db, f.affaireIds))) {
    const signee = vs.filter((v) => versionFigee(v.statut)).at(-1);
    if (!signee) continue;
    const derniere = vs.at(-1)!;
    signees.set(pvId, {
      versionId: signee.id,
      indice: signee.indice,
      enCours: derniere.id !== signee.id ? derniere.indice : null,
    });
  }
  const versionIds = [...signees.values()].map((s) => s.versionId);
  if (versionIds.length === 0) return [];

  const conds = [inArray(reserves.versionId, versionIds)];
  if (f.statut) conds.push(eq(reserves.statut, f.statut));
  const rows = await db
    .select({
      r: reserves,
      numeroPv: pvs.numero,
      affaireId: pvs.affaireId,
      affaireNumero: affaires.numero,
      tag: equipements.tag,
    })
    .from(reserves)
    .innerJoin(pvs, eq(reserves.pvId, pvs.id))
    .innerJoin(affaires, eq(pvs.affaireId, affaires.id))
    .leftJoin(equipements, eq(pvs.equipementId, equipements.id))
    .where(and(...conds))
    .orderBy(asc(affaires.numero), asc(equipements.tag), asc(pvs.numero), asc(reserves.numero));

  const aujourdHui = parisIsoDate(f.now);
  const criticite = (c: string | null): ReserveSuiviDto["criticite"] =>
    c === "bloquante" || c === "non_bloquante" ? c : null;
  return rows
    .map(({ r, numeroPv, affaireId, affaireNumero, tag }): ReserveSuiviDto => {
      const s = signees.get(r.pvId)!;
      return {
        id: r.id,
        pvId: r.pvId,
        versionId: r.versionId,
        numeroPv,
        indicePv: s.indice,
        affaireId,
        affaireNumero,
        equipementTag: tag,
        numero: r.numero,
        controle: r.controle,
        description: r.description,
        criticite: criticite(r.criticite),
        responsable: r.responsable,
        datePrevue: r.datePrevue,
        statut: r.statut,
        indiceCreation: r.indiceCreation,
        levee:
          r.statut === "levee"
            ? { date: r.dateLevee ?? "", commentaire: r.commentaireLevee ?? "", indice: r.indiceLevee ?? "" }
            : null,
        enRetard: reserveEnRetard(r, aujourdHui),
        revisionEnCours: s.enCours,
      };
    })
    .filter((r) => !f.criticite || (f.criticite === "aucune" ? r.criticite === null : r.criticite === f.criticite));
}
