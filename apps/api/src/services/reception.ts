import {
  FAMILLE_RELAIS,
  TIME_ZONE,
  controlesSignature,
  empreintePv,
  majJournalModifications,
  nomFichierPv,
  parseNumeroPv,
  uploadPvVersionRequestSchema,
  valeursPrepareesModifiees,
  type ModificationTracee,
  type PvVersionStatusDto,
  type TypeFichier,
  type UploadPvVersionRequest,
} from "@spie/shared";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { depots, equipements, pvAffectations, pvs, reserves, utilisateurs, versionsPv } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { HttpError, badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { assertAffaireTerrain, estAffecte } from "./acces.js";
import { autrePvMemeNumero, depotsDeVersions, type PvRow, type VersionRow } from "./pv.js";
import type { UserRow } from "./users.js";

/** « 19/11/2026 16:00 », heure de Paris (messages d'erreur lus sur la tablette). */
const DATE_HEURE_PARIS = new Intl.DateTimeFormat("fr-FR", {
  timeZone: TIME_ZONE,
  dateStyle: "short",
  timeStyle: "short",
});

export interface ResultatReception {
  status: PvVersionStatusDto;
  /** false : renvoi d'une version déjà reçue (idempotence, spec §6.3). */
  cree: boolean;
}

/** Fichiers produits pour une version (spec §5.1) : PDF et JSON toujours, XLSX si le PV contient des E/S. */
export function fichiersAProduire(v: Pick<VersionRow, "donnees">): TypeFichier[] {
  return v.donnees.es.points.length > 0 ? ["pdf", "json", "xlsx"] : ["pdf", "json"];
}

async function peutSaisirPv(db: Db, user: UserRow, pvId: string): Promise<boolean> {
  if (user.role === "admin") return true;
  const [a] = await db
    .select({ id: pvAffectations.pvId })
    .from(pvAffectations)
    .where(and(eq(pvAffectations.pvId, pvId), eq(pvAffectations.userId, user.id)));
  return Boolean(a);
}

export async function statutVersion(db: Db, versionId: string): Promise<PvVersionStatusDto> {
  const [row] = await db
    .select({ v: versionsPv, pv: pvs, signataire: utilisateurs.nom })
    .from(versionsPv)
    .innerJoin(pvs, eq(versionsPv.pvId, pvs.id))
    .leftJoin(utilisateurs, eq(versionsPv.signePar, utilisateurs.id))
    .where(eq(versionsPv.id, versionId));
  if (!row) throw notFound("Version de PV introuvable.");
  return {
    versionId: row.v.id,
    pvId: row.pv.id,
    numero: row.pv.numero,
    statut: row.v.statut,
    signeLe: row.v.signeLe?.toISOString() ?? null,
    signePar: row.signataire,
    alerteDoublon: await autrePvMemeNumero(db, row.pv),
    depots: (await depotsDeVersions(db, [row.v.id])).get(row.v.id) ?? [],
  };
}

/** Statut d'une version, pour la tablette (§8.5) : réservé aux personnes affectées à l'affaire. */
export async function statutVersionPourUtilisateur(
  db: Db,
  user: UserRow,
  versionId: string,
): Promise<PvVersionStatusDto> {
  const [row] = await db
    .select({ affaireId: pvs.affaireId })
    .from(versionsPv)
    .innerJoin(pvs, eq(versionsPv.pvId, pvs.id))
    .where(eq(versionsPv.id, versionId));
  if (!row) throw notFound("Version de PV introuvable.");
  if (!(await estAffecte(db, user, row.affaireId))) throw forbidden();
  return statutVersion(db, versionId);
}

/**
 * Réception d'un PV signé (spec §3.3, §6.3) : contrôle des droits, de l'empreinte SHA-256 et des signatures,
 * enregistrement (idempotent), puis planification des dépôts SharePoint.
 */
export async function recevoirVersion(
  db: Db,
  args: { user: UserRow; versionId: string; body: unknown; now: Date; ip?: string },
): Promise<ResultatReception> {
  const { user, versionId, now } = args;
  const req: UploadPvVersionRequest = uploadPvVersionRequestSchema.parse(args.body);
  const affaire = await assertAffaireTerrain(db, user, req.affaireId);

  // Idempotence : la même version renvoyée (accusé de réception perdu) ne crée pas de doublon.
  const [existante] = await db.select().from(versionsPv).where(eq(versionsPv.id, versionId));
  if (existante && existante.statut !== "prepare" && existante.statut !== "brouillon") {
    const status = await statutVersion(db, versionId);
    if (existante.pvId !== req.pvId || existante.empreinte !== req.empreinte) {
      // Typiquement : PV affecté à deux techniciens, l'autre l'a signé et envoyé le premier.
      const par = status.signePar ? ` par ${status.signePar}` : "";
      const le = status.signeLe ? ` le ${DATE_HEURE_PARIS.format(new Date(status.signeLe))}` : "";
      throw conflict(
        `Ce PV a déjà été signé${par}${le} et reçu par le serveur : cette version n'est pas prise en compte.`,
      );
    }
    return { status, cree: false };
  }

  const numero = parseNumeroPv(req.numero);
  if (!numero || numero.affaire !== affaire.numero) {
    throw badRequest(`Numéro de PV invalide pour l'affaire ${affaire.numero} : ${req.numero}.`);
  }
  if (req.donnees.entete.indice !== req.indice) throw badRequest("L'indice du PV ne correspond pas à ses données.");
  let equipement: typeof equipements.$inferSelect | undefined;
  if (req.equipementId) {
    [equipement] = await db
      .select()
      .from(equipements)
      .where(and(eq(equipements.id, req.equipementId), eq(equipements.affaireId, affaire.id)));
    if (!equipement) throw badRequest("Équipement introuvable dans cette affaire.");
  }

  const attendue = await empreintePv({
    pvId: req.pvId,
    versionId,
    numero: req.numero,
    indice: req.indice,
    signeLe: req.signeLe,
    donnees: req.donnees,
  });
  if (attendue !== req.empreinte) {
    throw new HttpError(
      422,
      "integrity",
      "Empreinte SHA-256 invalide : les données reçues ne correspondent pas au PV signé.",
    );
  }
  const manques = controlesSignature(req.donnees);
  if (manques.length > 0) throw badRequest(`PV incomplet : ${manques.map((m) => m.message).join(" ")}`);

  let pv: PvRow;
  if (existante) {
    // PV préparé au bureau puis signé sur la tablette.
    const [p] = await db.select().from(pvs).where(eq(pvs.id, existante.pvId));
    pv = p!;
    if (pv.id !== req.pvId || pv.numero !== req.numero || pv.affaireId !== affaire.id) {
      throw conflict("Cette version appartient à un autre PV.");
    }
    if (existante.indice !== req.indice) throw conflict("Indice de révision inattendu pour cette version.");
    if (!(await peutSaisirPv(db, user, pv.id))) throw forbidden("Ce PV ne vous est pas affecté.");
  } else {
    // PV créé sur site : la tablette a choisi l'UUID du PV et celui de la version.
    const [p] = await db.select().from(pvs).where(eq(pvs.id, req.pvId));
    if (p) throw conflict("Ce PV existe déjà : la révision suivante doit être réservée auprès du serveur.");
    pv = {
      id: req.pvId,
      affaireId: affaire.id,
      equipementId: equipement?.id ?? null,
      modele: req.modele,
      numero: req.numero,
      origine: "site",
      creePar: user.id,
      createdAt: now,
      updatedAt: now,
    };
  }

  // Valeurs préparées modifiées sur site (spec §4.2) : recalculées ici, datées par le journal de la tablette.
  const preparees = req.donneesPreparees ?? existante?.donneesPreparees ?? null;
  const modifications: ModificationTracee[] = preparees
    ? majJournalModifications(
        req.modifications.map((m) => ({ ...m, avant: m.avant ?? null, apres: m.apres ?? null })),
        valeursPrepareesModifiees(preparees, req.donnees),
        {
          par: user.nom,
          le: req.signeLe,
        },
      )
    : [];
  const signeLe = new Date(req.signeLe);
  const fichiers = fichiersAProduire({ donnees: req.donnees });
  const tag = equipement?.tag ?? null;

  await db.transaction(async (tx) => {
    const champs = {
      statut: "recu" as const,
      statutDocument: req.donnees.entete.statutDocument,
      donnees: req.donnees,
      donneesPreparees: preparees,
      modifications,
      empreinte: req.empreinte,
      modeleVersion: req.modeleVersion,
      listeEsId: req.donnees.es.listeId,
      signeLe,
      signePar: user.id,
      recuLe: now,
      tabletteId: req.tabletteId,
      updatedAt: now,
    };
    if (existante) {
      await tx
        .update(versionsPv)
        .set({ ...champs, saisieCommenceeLe: existante.saisieCommenceeLe ?? signeLe })
        .where(eq(versionsPv.id, versionId));
    } else {
      await tx.insert(pvs).values(pv);
      await tx.insert(pvAffectations).values({ pvId: pv.id, userId: user.id });
      await tx.insert(versionsPv).values({
        id: versionId,
        pvId: pv.id,
        indice: req.indice,
        creeLe: new Date(req.creeLe),
        saisieCommenceeLe: new Date(req.creeLe),
        ...champs,
      });
    }
    if (req.donnees.reserves.length > 0) {
      await tx.insert(reserves).values(
        req.donnees.reserves.map((r) => ({
          pvId: pv.id,
          versionId,
          numero: r.numero,
          statut: r.statut,
          criticite: r.criticite,
          controle: r.controle,
          description: r.description,
          indiceCreation: r.indiceCreation,
          indiceLevee: r.levee?.indice ?? null,
        })),
      );
    }
    await tx.insert(depots).values(
      fichiers.map((fichier) => ({
        versionId,
        fichier,
        nom: nomFichierPv({ famille: FAMILLE_RELAIS, tag, numero: pv.numero, indice: req.indice, extension: fichier }),
        prochaineTentative: now,
      })),
    );
  });

  const details = {
    numero: pv.numero,
    indice: req.indice,
    affaire: affaire.numero,
    equipement: tag,
    empreinte: req.empreinte,
  };
  await audit(db, { action: "pv.recu", actorId: user.id, targetType: "pv", targetId: pv.id, details, ip: args.ip });
  if (modifications.length > 0) {
    await audit(db, {
      action: "pv.valeurs_modifiees",
      actorId: user.id,
      targetType: "pv",
      targetId: pv.id,
      details: { numero: pv.numero, chemins: modifications.map((m) => m.chemin) },
      ip: args.ip,
    });
  }
  const status = await statutVersion(db, versionId);
  if (status.alerteDoublon) {
    // Deux postes ont créé un PV sur la même affaire à la même seconde (spec §4.1) : alerte administrateur.
    await audit(db, {
      action: "pv.doublon_numero",
      actorId: user.id,
      targetType: "pv",
      targetId: pv.id,
      details,
      ip: args.ip,
    });
  }
  return { status, cree: true };
}
