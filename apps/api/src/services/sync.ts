import { MODELE_RELAIS, MODELE_RELAIS_VERSION, estRevision, type SyncPvDto, type SyncReferenceDto } from "@spie/shared";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { pvAffectations, pvs, versionsPv } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { toAffaireDto } from "../routes/affaires.js";
import { affairesVisibles } from "./acces.js";
import { derniereListeDetail, equipementsDeLAffaire } from "./io-listes.js";
import { pvsDeposes } from "./revisions.js";
import type { UserRow } from "./users.js";

/**
 * Données de référence de la tablette (spec §3.1 étape 5, §6.5) : affaires affectées avec leurs équipements et la
 * dernière version de la liste E/S, PV préparés affectés à l'utilisateur, modèles disponibles.
 */
export async function referenceSync(db: Db, user: UserRow, now: Date): Promise<SyncReferenceDto> {
  const visibles = await affairesVisibles(db, user);
  const affaires = await Promise.all(
    visibles.map(async (a) => ({
      affaire: toAffaireDto(a),
      equipements: await equipementsDeLAffaire(db, a.id),
      liste: await derniereListeDetail(db, a.id),
    })),
  );

  let pvsSync: SyncPvDto[] = [];
  if (visibles.length > 0) {
    const rows = await db
      .select({ v: versionsPv, pv: pvs })
      .from(versionsPv)
      .innerJoin(pvs, eq(versionsPv.pvId, pvs.id))
      .innerJoin(pvAffectations, and(eq(pvAffectations.pvId, pvs.id), eq(pvAffectations.userId, user.id)))
      .where(
        and(
          eq(versionsPv.statut, "prepare"),
          inArray(
            pvs.affaireId,
            visibles.map((a) => a.id),
          ),
        ),
      );
    pvsSync = rows.map(({ v, pv }) => ({
      pvId: pv.id,
      versionId: v.id,
      numero: pv.numero,
      indice: v.indice,
      modele: pv.modele,
      modeleVersion: v.modeleVersion,
      affaireId: pv.affaireId,
      equipementId: pv.equipementId,
      statut: v.statut,
      donnees: v.donnees,
      // Révision : sa base de comparaison est la préparation d'origine, pas ses données (reprises de la précédente).
      ...(estRevision(v.donnees) ? { donneesPreparees: v.donneesPreparees } : {}),
      creeLe: v.creeLe.toISOString(),
      misAJourLe: v.updatedAt.toISOString(),
    }));
  }

  return {
    serverTime: now.toISOString(),
    utilisateur: { id: user.id, nom: user.nom },
    affaires,
    pvs: pvsSync,
    deposes: await pvsDeposes(
      db,
      visibles.map((a) => a.id),
    ),
    modeles: [{ code: MODELE_RELAIS, version: MODELE_RELAIS_VERSION }],
  };
}

/**
 * La tablette a commencé la saisie de PV préparés : sa version fait désormais foi, le préparateur en est averti
 * (spec §6.5). Seuls les PV préparés affectés à l'utilisateur sont pris en compte ; les autres sont ignorés.
 */
export async function signalerSaisieCommencee(
  db: Db,
  args: { user: UserRow; versionIds: string[]; now: Date; ip?: string },
): Promise<number> {
  const ids = [...new Set(args.versionIds)];
  if (ids.length === 0) return 0;
  const rows = await db
    .select({ versionId: versionsPv.id, pvId: pvs.id, numero: pvs.numero, userId: pvAffectations.userId })
    .from(versionsPv)
    .innerJoin(pvs, eq(versionsPv.pvId, pvs.id))
    .leftJoin(pvAffectations, and(eq(pvAffectations.pvId, pvs.id), eq(pvAffectations.userId, args.user.id)))
    .where(and(inArray(versionsPv.id, ids), eq(versionsPv.statut, "prepare"), isNull(versionsPv.saisieCommenceeLe)));
  const autorises = rows.filter((r) => r.userId !== null || args.user.role === "admin");
  for (const r of autorises) {
    await db
      .update(versionsPv)
      .set({ saisieCommenceeLe: args.now })
      .where(and(eq(versionsPv.id, r.versionId), isNull(versionsPv.saisieCommenceeLe)));
    await audit(db, {
      action: "pv.saisie_commencee",
      actorId: args.user.id,
      targetType: "pv",
      targetId: r.pvId,
      details: { numero: r.numero },
      ip: args.ip,
    });
  }
  return autorises.length;
}
