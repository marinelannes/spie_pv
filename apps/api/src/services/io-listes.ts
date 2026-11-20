import { analyserImport, associationsAReprendre, lireListeEs } from "@spie/io-import";
import {
  ioImportRequestSchema,
  type AssociationEquipementInput,
  pointsPourEquipement,
  type EquipementDto,
  type FeuilleEsDto,
  type IoImportAnalyseDto,
  type IoImportRequest,
  type IoImportResultDto,
  type ListeEsDetailDto,
  type ListeEsDto,
  type ListeEsLue,
  type PointEsSource,
} from "@spie/shared";
import { and, asc, count, desc, eq, inArray, max } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { equipements, feuillesEs, listesEs, pointsEs, pvs, utilisateurs, versionsPv } from "../db/schema.js";
import { badRequest, notFound } from "../lib/errors.js";
import type { AffaireRow } from "./acces.js";

type ListeRow = typeof listesEs.$inferSelect;
export type EquipementRow = typeof equipements.$inferSelect;

/** Contenu d'un fichier envoyé en base64 (éventuellement en data URL). */
export function decoderBase64(contenu: string): Uint8Array {
  const b64 = contenu.replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
  if (!b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length % 4 === 1) {
    throw badRequest("Fichier illisible : contenu base64 invalide.");
  }
  return new Uint8Array(Buffer.from(b64, "base64"));
}

/** Associations choisies à la main pour les équipements déjà enregistrés (import précédent ou « Changer »). */
async function associationsPrecedentes(db: Db, affaireId: string): Promise<AssociationEquipementInput[]> {
  const rows = await db
    .select({
      tag: equipements.tag,
      typeCellule: equipements.typeCellule,
      feuille: feuillesEs.nom,
      filtreTag: equipements.filtreTag,
    })
    .from(equipements)
    .leftJoin(feuillesEs, eq(equipements.feuilleEsId, feuillesEs.id))
    .where(eq(equipements.affaireId, affaireId));
  return associationsAReprendre(rows);
}

async function lireEtAnalyser(db: Db, affaire: AffaireRow, req: IoImportRequest) {
  const contenu = decoderBase64(req.contenuBase64);
  let lue: ListeEsLue;
  try {
    lue = await lireListeEs(contenu, { numeroAffaireAttendu: affaire.numero });
  } catch (err) {
    throw badRequest(`Fichier Excel illisible : ${(err as Error).message}`);
  }
  const precedentes = await associationsPrecedentes(db, affaire.id);
  return { lue, analyse: analyserImport(lue, req.fichier, req.associations, precedentes) };
}

/** Lecture et analyse du fichier, sans rien enregistrer (aperçu de l'import dans le back-office). */
export async function analyserFichier(db: Db, affaire: AffaireRow, body: unknown): Promise<IoImportAnalyseDto> {
  return (await lireEtAnalyser(db, affaire, ioImportRequestSchema.parse(body))).analyse;
}

/**
 * Import d'une liste E/S (spec §4.4) : nouvelle version de la liste (feuilles et points), création ou mise à jour
 * des équipements de l'affaire (clé : TAG) et de leur feuille associée. Les associations choisies à la main pour la
 * version précédente sont reprises quand la requête n'en donne pas. Les équipements absents du nouveau fichier sont
 * conservés (des PV peuvent les référencer).
 */
export async function importerListe(
  db: Db,
  affaire: AffaireRow,
  body: unknown,
  userId: string,
): Promise<IoImportResultDto> {
  const req = ioImportRequestSchema.parse(body);
  const { lue, analyse } = await lireEtAnalyser(db, affaire, req);
  if (analyse.bloquant) {
    const erreurs = analyse.anomalies.filter((a) => a.severite === "erreur").map((a) => a.message);
    throw badRequest(`Import impossible : ${erreurs.join(" ; ")}`);
  }

  return db.transaction(async (tx) => {
    const [{ v } = { v: 0 }] = await tx
      .select({ v: max(listesEs.version) })
      .from(listesEs)
      .where(eq(listesEs.affaireId, affaire.id));
    const [liste] = await tx
      .insert(listesEs)
      .values({
        affaireId: affaire.id,
        referenceDocument: analyse.reference,
        revision: analyse.revision,
        version: Number(v ?? 0) + 1,
        fichierSource: req.fichier,
        importePar: userId,
        anomalies: analyse.anomalies,
      })
      .returning();

    const feuilleIds = new Map<string, string>();
    for (const [ordre, f] of lue.feuilles.entries()) {
      const [feuille] = await tx
        .insert(feuillesEs)
        .values({ listeId: liste!.id, nom: f.nom, titre: f.titre, ordre, groupesTag: f.groupesTag })
        .returning({ id: feuillesEs.id });
      feuilleIds.set(f.nom, feuille!.id);
      const points = f.points.filter((p) => p.type !== null);
      if (points.length > 0) {
        await tx.insert(pointsEs).values(
          points.map((p, i) => ({
            feuilleId: feuille!.id,
            ordre: i,
            ligne: p.ligne,
            carte: p.carte,
            tag: p.tag,
            typeEs: p.type!,
            designation: p.designation,
            adresse: p.adresse,
            reserve: p.reserve,
          })),
        );
      }
    }

    let crees = 0;
    let misAJour = 0;
    for (const e of analyse.equipements) {
      const values = {
        libelle: e.libelle,
        niveauTension: e.niveauTension,
        typeCellule: e.typeCellule,
        equipement: e.equipement,
        modele: e.modele,
        local: e.local,
        tagArmoire: e.tagArmoire,
        referenceConstructeur: e.referenceConstructeur,
        feuilleEsId: e.association.feuille ? (feuilleIds.get(e.association.feuille) ?? null) : null,
        filtreTag: e.association.feuille ? e.association.filtreTag : null,
      };
      const [existant] = await tx
        .select({ id: equipements.id })
        .from(equipements)
        .where(and(eq(equipements.affaireId, affaire.id), eq(equipements.tag, e.tag)));
      if (existant) {
        await tx
          .update(equipements)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(equipements.id, existant.id));
        misAJour++;
      } else {
        await tx.insert(equipements).values({ affaireId: affaire.id, tag: e.tag, ...values });
        crees++;
      }
    }

    return {
      liste: await listeDto(tx as unknown as Db, liste!),
      analyse,
      equipementsCrees: crees,
      equipementsMisAJour: misAJour,
    };
  });
}

async function listeDto(db: Db, l: ListeRow): Promise<ListeEsDto> {
  const [stats] = await db
    .select({ nbFeuilles: count(feuillesEs.id) })
    .from(feuillesEs)
    .where(eq(feuillesEs.listeId, l.id));
  const [pts] = await db
    .select({ n: count(pointsEs.id) })
    .from(pointsEs)
    .innerJoin(feuillesEs, eq(pointsEs.feuilleId, feuillesEs.id))
    .where(eq(feuillesEs.listeId, l.id));
  let importePar: string | null = null;
  if (l.importePar) {
    const [u] = await db.select({ nom: utilisateurs.nom }).from(utilisateurs).where(eq(utilisateurs.id, l.importePar));
    importePar = u?.nom ?? null;
  }
  return {
    id: l.id,
    affaireId: l.affaireId,
    referenceDocument: l.referenceDocument,
    revision: l.revision,
    version: l.version,
    fichierSource: l.fichierSource,
    importeLe: l.createdAt.toISOString(),
    importePar,
    nbFeuilles: Number(stats?.nbFeuilles ?? 0),
    nbPoints: Number(pts?.n ?? 0),
    anomalies: l.anomalies,
  };
}

/** Versions de la liste E/S de l'affaire, la plus récente d'abord. */
export async function listesDeLAffaire(db: Db, affaireId: string): Promise<ListeEsDto[]> {
  const rows = await db
    .select()
    .from(listesEs)
    .where(eq(listesEs.affaireId, affaireId))
    .orderBy(desc(listesEs.version));
  return Promise.all(rows.map((l) => listeDto(db, l)));
}

async function feuillesDeLaListe(db: Db, listeId: string): Promise<FeuilleEsDto[]> {
  const feuilles = await db
    .select()
    .from(feuillesEs)
    .where(eq(feuillesEs.listeId, listeId))
    .orderBy(asc(feuillesEs.ordre));
  if (feuilles.length === 0) return [];
  const points = await db
    .select()
    .from(pointsEs)
    .where(
      inArray(
        pointsEs.feuilleId,
        feuilles.map((f) => f.id),
      ),
    )
    .orderBy(asc(pointsEs.ordre));
  return feuilles.map((f) => ({
    id: f.id,
    nom: f.nom,
    titre: f.titre,
    groupesTag: f.groupesTag,
    points: points
      .filter((p) => p.feuilleId === f.id)
      .map((p) => ({
        id: p.id,
        ordre: p.ordre,
        carte: p.carte,
        tag: p.tag,
        type: p.typeEs,
        designation: p.designation,
        adresse: p.adresse,
        reserve: p.reserve,
      })),
  }));
}

export async function listeDetail(db: Db, listeId: string): Promise<ListeEsDetailDto & { affaireId: string }> {
  const [l] = await db.select().from(listesEs).where(eq(listesEs.id, listeId));
  if (!l) throw notFound("Liste E/S introuvable.");
  return { ...(await listeDto(db, l)), feuilles: await feuillesDeLaListe(db, l.id) };
}

export async function derniereListeDetail(db: Db, affaireId: string): Promise<ListeEsDetailDto | null> {
  const [l] = await db
    .select({ id: listesEs.id })
    .from(listesEs)
    .where(eq(listesEs.affaireId, affaireId))
    .orderBy(desc(listesEs.version))
    .limit(1);
  return l ? listeDetail(db, l.id) : null;
}

/** Liste E/S d'un équipement : version de la liste, feuille et points retenus (filtre TAG). */
export async function esDeLEquipement(
  db: Db,
  e: EquipementRow,
): Promise<{
  listeId: string;
  listeVersion: number;
  referenceDocument: string;
  revision: string;
  feuille: string;
  filtreTag: string | null;
  points: PointEsSource[];
} | null> {
  if (!e.feuilleEsId) return null;
  const [f] = await db
    .select({ feuille: feuillesEs, liste: listesEs })
    .from(feuillesEs)
    .innerJoin(listesEs, eq(feuillesEs.listeId, listesEs.id))
    .where(eq(feuillesEs.id, e.feuilleEsId));
  if (!f) return null;
  const points = await db
    .select()
    .from(pointsEs)
    .where(eq(pointsEs.feuilleId, f.feuille.id))
    .orderBy(asc(pointsEs.ordre));
  return {
    listeId: f.liste.id,
    listeVersion: f.liste.version,
    referenceDocument: f.liste.referenceDocument,
    revision: f.liste.revision,
    feuille: f.feuille.nom,
    filtreTag: e.filtreTag,
    points: pointsPourEquipement(
      points.map((p) => ({
        id: p.id,
        carte: p.carte,
        tag: p.tag,
        adresse: p.adresse,
        type: p.typeEs,
        designation: p.designation,
        reserve: p.reserve,
      })),
      e.filtreTag,
    ),
  };
}

/** Équipements de l'affaire avec leur feuille, le nombre d'E/S et l'avancement des PV (spec §4.6). */
export async function equipementsDeLAffaire(db: Db, affaireId: string): Promise<EquipementDto[]> {
  const rows = await db
    .select({ e: equipements, feuilleNom: feuillesEs.nom })
    .from(equipements)
    .leftJoin(feuillesEs, eq(equipements.feuilleEsId, feuillesEs.id))
    .where(eq(equipements.affaireId, affaireId))
    .orderBy(asc(equipements.tag));
  const feuilleIds = [...new Set(rows.map((r) => r.e.feuilleEsId).filter((x): x is string => x !== null))];
  const comptes =
    feuilleIds.length === 0
      ? []
      : await db
          .select({ feuilleId: pointsEs.feuilleId, tag: pointsEs.tag, n: count(pointsEs.id) })
          .from(pointsEs)
          .where(inArray(pointsEs.feuilleId, feuilleIds))
          .groupBy(pointsEs.feuilleId, pointsEs.tag);
  const statuts = await db
    .select({ equipementId: pvs.equipementId, statut: versionsPv.statut })
    .from(pvs)
    .innerJoin(versionsPv, eq(versionsPv.pvId, pvs.id))
    .where(eq(pvs.affaireId, affaireId));

  return rows.map(({ e, feuilleNom }) => {
    const nbPointsEs = comptes
      .filter((c) => c.feuilleId === e.feuilleEsId && (!e.filtreTag || c.tag === e.filtreTag))
      .reduce((s, c) => s + Number(c.n), 0);
    const pvsEq = statuts.filter((s) => s.equipementId === e.id);
    const deposes = pvsEq.filter((s) => s.statut === "depose").length;
    return {
      id: e.id,
      affaireId: e.affaireId,
      tag: e.tag,
      libelle: e.libelle,
      niveauTension: e.niveauTension,
      typeCellule: e.typeCellule,
      equipement: e.equipement,
      modele: e.modele,
      local: e.local,
      tagArmoire: e.tagArmoire,
      referenceConstructeur: e.referenceConstructeur,
      feuilleEsId: e.feuilleEsId,
      feuilleNom: feuilleNom ?? null,
      filtreTag: e.filtreTag,
      nbPointsEs,
      avancement: { nbPv: pvsEq.length, deposes, enCours: pvsEq.length - deposes },
    };
  });
}
