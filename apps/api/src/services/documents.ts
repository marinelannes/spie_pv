import { FAMILLE_RELAIS, type PvDocument } from "@spie/shared";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { affaires, equipements, listesEs, pvs, utilisateurs, versionsPv } from "../db/schema.js";
import { notFound } from "../lib/errors.js";

/**
 * Document complet d'une version (spec §5.1) : contenu du fichier .json déposé et entrée du rendu PDF. Valeurs
 * préparées et saisies, versions du schéma, du modèle et de la liste E/S, empreinte, auteur, horodatages, tablette.
 */
export async function construirePvDocument(db: Db, versionId: string, genereLe: Date): Promise<PvDocument> {
  const [row] = await db
    .select({ v: versionsPv, pv: pvs, a: affaires, e: equipements, l: listesEs })
    .from(versionsPv)
    .innerJoin(pvs, eq(versionsPv.pvId, pvs.id))
    .innerJoin(affaires, eq(pvs.affaireId, affaires.id))
    .leftJoin(equipements, eq(pvs.equipementId, equipements.id))
    .leftJoin(listesEs, eq(versionsPv.listeEsId, listesEs.id))
    .where(eq(versionsPv.id, versionId));
  if (!row) throw notFound("Version de PV introuvable.");
  const { v, pv, a, e, l } = row;
  let signePar: PvDocument["meta"]["signePar"] = null;
  if (v.signePar) {
    const [u] = await db
      .select({ id: utilisateurs.id, nom: utilisateurs.nom })
      .from(utilisateurs)
      .where(eq(utilisateurs.id, v.signePar));
    signePar = u ?? null;
  }
  return {
    format: "spie-pv/1",
    pv: { id: pv.id, numero: pv.numero, modele: pv.modele, modeleVersion: v.modeleVersion, famille: FAMILLE_RELAIS },
    version: {
      id: v.id,
      indice: v.indice,
      statutDocument: v.statutDocument,
      signeLe: v.signeLe?.toISOString() ?? null,
      empreinte: v.empreinte,
    },
    affaire: { numero: a.numero, client: a.client, projet: a.projet, site: a.site },
    equipement: e
      ? {
          tag: e.tag,
          libelle: e.libelle,
          typeCellule: e.typeCellule,
          modele: e.modele,
          local: e.local,
          tagArmoire: e.tagArmoire,
        }
      : null,
    listeEs: l ? { id: l.id, reference: l.referenceDocument, revision: l.revision, version: l.version } : null,
    meta: {
      creeLe: v.creeLe.toISOString(),
      tabletteId: v.tabletteId,
      signePar,
      recuLe: v.recuLe?.toISOString() ?? null,
      genereLe: genereLe.toISOString(),
    },
    donnees: v.donnees,
    donneesPreparees: v.donneesPreparees,
    modifications: v.modifications,
  };
}
