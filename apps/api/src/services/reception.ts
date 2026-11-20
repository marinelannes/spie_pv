import {
  FAMILLE_RELAIS,
  TIME_ZONE,
  controlesRevision,
  controlesSignature,
  empreintePv,
  indiceSuivant,
  majJournalModifications,
  nomFichierPv,
  parseNumeroPv,
  trierParIndice,
  uploadPvVersionRequestSchema,
  valeursPrepareesModifiees,
  type ModificationTracee,
  type PvVersionStatusDto,
  type TypeFichier,
  type UploadPvVersionRequest,
} from "@spie/shared";
import { and, desc, eq, lt } from "drizzle-orm";
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
  // Révision rétablie : voir plus bas. `aRemplacer` : révision de même indice recréée entre-temps, non commencée.
  let retablie = false;
  let aRemplacer: string | null = null;
  if (existante) {
    // PV préparé au bureau puis signé sur la tablette.
    const [p] = await db.select().from(pvs).where(eq(pvs.id, existante.pvId));
    pv = p!;
    if (pv.id !== req.pvId || pv.numero !== req.numero || pv.affaireId !== affaire.id) {
      throw conflict("Cette version appartient à un autre PV.");
    }
    if (existante.indice !== req.indice) throw conflict("Indice de révision inattendu pour cette version.");
    if (!(await peutSaisirPv(db, user, pv.id))) throw forbidden("Ce PV ne vous est pas affecté.");
    // Révision B et suivantes (spec §3.4) : les révisions signées ne changent plus, les réserves sont reportées.
    // Seule la révision immédiatement précédente est lue (les données d'une révision sont volumineuses).
    const [anterieure] = await db
      .select({ donnees: versionsPv.donnees })
      .from(versionsPv)
      .where(and(eq(versionsPv.pvId, pv.id), lt(versionsPv.indice, existante.indice)))
      .orderBy(desc(versionsPv.indice))
      .limit(1);
    const precedente = anterieure?.donnees;
    if (precedente) {
      const anomalies = controlesRevision(precedente, req.donnees);
      if (anomalies.length > 0) throw badRequest(`Révision ${req.indice} incohérente : ${anomalies.join(" ")}`);
    }
  } else {
    // PV créé sur site : la tablette a choisi l'UUID du PV et celui de la version.
    const [p] = await db.select().from(pvs).where(eq(pvs.id, req.pvId));
    if (p) {
      // Le PV existe mais pas cette version : c'est une révision que le bureau a annulée alors que sa saisie avait
      // commencé hors ligne (le serveur ne l'apprend qu'à la synchronisation). La version de la tablette fait foi
      // (spec §6.5) : elle est rétablie si elle suit bien la dernière révision déposée et si l'indice est libre,
      // ou seulement repris par une révision recréée que personne n'a commencée (celle-ci est remplacée).
      const reservee = "Ce PV existe déjà : la révision suivante doit être réservée auprès du serveur.";
      const versions = trierParIndice(await db.select().from(versionsPv).where(eq(versionsPv.pvId, p.id)));
      let base = versions.at(-1);
      if (base && base.indice === req.indice && base.statut === "prepare" && !base.saisieCommenceeLe) {
        aRemplacer = base.id;
        base = versions.at(-2);
      }
      if (p.numero !== req.numero || p.affaireId !== affaire.id) throw conflict(reservee);
      if (!base || base.statut !== "depose" || indiceSuivant(base.indice) !== req.indice) throw conflict(reservee);
      if (!(await peutSaisirPv(db, user, p.id))) throw forbidden("Ce PV ne vous est pas affecté.");
      const anomalies = controlesRevision(base.donnees, req.donnees);
      if (anomalies.length > 0) throw badRequest(`Révision ${req.indice} incohérente : ${anomalies.join(" ")}`);
      pv = p;
      retablie = true;
    } else {
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
  }

  // Valeurs préparées modifiées sur site (spec §4.2) : recalculées ici, datées par le journal de la tablette.
  const preparees = req.donneesPreparees ?? existante?.donneesPreparees ?? null;
  const modifications: ModificationTracee[] = preparees
    ? majJournalModifications(
        // Journal de la tablette, complété de celui déjà connu du serveur (révision : modifications des révisions
        // précédentes, avec leur auteur et leur date). À chemin égal, la tablette l'emporte.
        [
          ...new Map(
            [
              ...(existante?.modifications ?? []),
              ...req.modifications.map((m) => ({ ...m, avant: m.avant ?? null, apres: m.apres ?? null })),
            ].map((m) => [m.chemin, m] as const),
          ).values(),
        ],
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
      if (retablie) {
        if (aRemplacer) await tx.delete(versionsPv).where(eq(versionsPv.id, aRemplacer));
      } else {
        await tx.insert(pvs).values(pv);
        await tx.insert(pvAffectations).values({ pvId: pv.id, userId: user.id });
      }
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
          responsable: r.responsable,
          datePrevue: r.datePrevue,
          dateLevee: r.levee?.date ?? null,
          commentaireLevee: r.levee?.commentaire ?? null,
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
    ...(retablie ? { revisionRetablie: true } : {}),
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
  // Réserves levées par cette révision (spec §4.3) : tracées.
  const levees = req.donnees.reserves.filter((r) => r.statut === "levee" && r.levee?.indice === req.indice);
  if (levees.length > 0) {
    await audit(db, {
      action: "reserve.levee",
      actorId: user.id,
      targetType: "pv",
      targetId: pv.id,
      details: { numero: pv.numero, indice: req.indice, reserves: levees.map((r) => r.numero) },
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
