import {
  FAMILLE_RELAIS,
  MODELE_RELAIS_VERSION,
  attribuerNumeroPv,
  controlesAvantSignature,
  controlesSignature,
  creerPvRelais,
  empreintePv,
  majJournalModifications,
  modelePvEquipement,
  pointsPourEquipement,
  pvRelaisDataSchema,
  valeursPrepareesModifiees,
  versionFigee,
  type Manquant,
  type PvDocument,
  type PvRelaisData,
  type Trace,
  type UploadPvVersionRequest,
} from "@spie/shared";
import { formatDateTime, isoDateParis } from "../lib/format";
import { lireMeta, type LocalAffaire, type LocalPv, type PvClotAilleurs, type UserDb } from "./db";

/** Opérations locales sur les PV de la tablette : création sur site, ouverture, enregistrement, signature. */

export class PvLocalError extends Error {
  constructor(
    message: string,
    readonly manquants: Manquant[] = [],
  ) {
    super(message);
    this.name = "PvLocalError";
  }
}

export interface Horloge {
  now: () => Date;
  attendre: (ms: number) => Promise<void>;
}

export const horlogeSysteme: Horloge = {
  now: () => new Date(),
  attendre: (ms) => new Promise((r) => setTimeout(r, ms)),
};

/** Feuille d'E/S de l'équipement dans la dernière liste synchronisée, filtrée par son TAG le cas échéant. */
export function esPourEquipement(affaire: LocalAffaire, equipementId: string) {
  const eq = affaire.equipements.find((e) => e.id === equipementId);
  const liste = affaire.liste;
  if (!eq || !liste || !eq.feuilleEsId) return null;
  const feuille = liste.feuilles.find((f) => f.id === eq.feuilleEsId);
  if (!feuille) return null;
  return {
    listeId: liste.id,
    listeVersion: liste.version,
    referenceDocument: liste.referenceDocument,
    revision: liste.revision,
    feuille: feuille.nom,
    filtreTag: eq.filtreTag,
    points: pointsPourEquipement(feuille.points, eq.filtreTag),
  };
}

let creationEnCours: Promise<unknown> = Promise.resolve();

/**
 * Crée sur site un PV pour un équipement non préparé (spec §3.2) : seule la liste des E/S est pré-remplie.
 * Le numéro est attribué sans réseau ; deux PV du même poste ne partagent jamais la même seconde (spec §4.1).
 */
export function creerPvSurSite(
  db: UserDb,
  args: { affaire: LocalAffaire; equipementId: string; auteur: string },
  horloge: Horloge = horlogeSysteme,
): Promise<LocalPv> {
  // Sérialisé : deux créations rapprochées attendent chacune leur seconde.
  const run = creationEnCours.then(() => creer(db, args, horloge));
  creationEnCours = run.catch(() => undefined);
  return run;
}

async function creer(
  db: UserDb,
  { affaire, equipementId }: { affaire: LocalAffaire; equipementId: string },
  horloge: Horloge,
): Promise<LocalPv> {
  const eq = affaire.equipements.find((e) => e.id === equipementId);
  if (!eq) throw new PvLocalError("Équipement inconnu dans cette affaire.");
  if (!modelePvEquipement(eq)) throw new PvLocalError(`${eq.tag} : aucun modèle de PV pour cet équipement.`);
  const meta = await lireMeta(db);
  const { numero, creeLe } = await attribuerNumeroPv(
    affaire.affaire.numero,
    meta.dernierNumeroLe ? new Date(meta.dernierNumeroLe) : null,
    horloge.now,
    horloge.attendre,
  );
  const a = affaire.affaire;
  const donnees = creerPvRelais({
    affaire: {
      numero: a.numero,
      client: a.client,
      projet: a.projet,
      valideParDefaut: a.valideParDefaut,
      approuveParDefaut: a.approuveParDefaut,
    },
    es: esPourEquipement(affaire, equipementId),
    date: isoDateParis(creeLe),
    modeleRelais: eq.modele,
  });
  const iso = creeLe.toISOString();
  const pv: LocalPv = {
    versionId: globalThis.crypto.randomUUID(),
    pvId: globalThis.crypto.randomUUID(),
    numero,
    indice: "A",
    modele: "relais",
    modeleVersion: MODELE_RELAIS_VERSION,
    affaireId: a.id,
    equipementId,
    origine: "site",
    statut: "brouillon",
    donnees,
    donneesPreparees: null,
    journal: [],
    creeLe: iso,
    modifieLe: iso,
    bureauMisAJourLe: null,
    saisieCommenceeLe: iso,
    saisieSignalee: true, // rien à signaler : le serveur ne connaît pas encore ce PV
    versionBureauIgnoree: null,
    signeLe: null,
    signePar: null,
    empreinte: null,
    envoyeLe: null,
    deposeLe: null,
    depots: [],
    alerteDoublon: false,
    erreurEnvoi: null,
    clotAilleurs: null,
  };
  await db.transaction("rw", db.pvs, db.meta, async () => {
    await db.pvs.add(pv);
    await db.meta.update("meta", { dernierNumeroLe: iso });
  });
  return pv;
}

/** Ouverture d'un PV préparé sur la tablette : il passe « en cours de saisie » (spec §6.4). */
export async function ouvrirPvPrepare(db: UserDb, versionId: string, now: Date): Promise<LocalPv> {
  return db.transaction("rw", db.pvs, async () => {
    const pv = await db.pvs.get(versionId);
    if (!pv) throw new PvLocalError("PV introuvable sur cette tablette.");
    if (pv.statut !== "prepare") return pv;
    const ouvert: LocalPv = {
      ...pv,
      statut: "brouillon",
      saisieCommenceeLe: now.toISOString(),
      saisieSignalee: false,
      modifieLe: now.toISOString(),
    };
    await db.pvs.put(ouvert);
    return ouvert;
  });
}

/**
 * Enregistre les données saisies (à chaque modification, spec §6.1). Met à jour le journal des valeurs préparées
 * modifiées. Refusé pour un PV signé (figé, spec §3.2 étape 8).
 */
export async function enregistrerDonnees(
  db: UserDb,
  versionId: string,
  donnees: PvRelaisData,
  trace: Trace,
): Promise<LocalPv> {
  return db.transaction("rw", db.pvs, async () => {
    const pv = await db.pvs.get(versionId);
    if (!pv) throw new PvLocalError("PV introuvable sur cette tablette.");
    if (versionFigee(pv.statut)) throw new PvLocalError("Ce PV est signé : il ne peut plus être modifié.");
    if (pv.clotAilleurs) throw new PvLocalError(messageClotAilleurs(pv.clotAilleurs));
    const journal = pv.donneesPreparees
      ? majJournalModifications(pv.journal, valeursPrepareesModifiees(pv.donneesPreparees, donnees), trace)
      : [];
    const maj: LocalPv = {
      ...pv,
      donnees,
      journal,
      modifieLe: trace.le,
      // Modifier un PV préparé, c'est commencer sa saisie.
      ...(pv.statut === "prepare"
        ? { statut: "brouillon" as const, saisieCommenceeLe: trace.le, saisieSignalee: false }
        : {}),
    };
    await db.pvs.put(maj);
    return maj;
  });
}

/** Prépare les données pour la signature : « Écrit par » de la révision courante = le signataire, par défaut. */
export function avecEcritPar(d: PvRelaisData, signataire: string): PvRelaisData {
  return {
    ...d,
    revisions: d.revisions.map((r) =>
      r.indice === d.entete.indice && !r.ecritPar.trim() ? { ...r, ecritPar: signataire } : r,
    ),
  };
}

/** Tous les contrôles bloquants avant de figer le PV. */
export function manquantsBloquants(d: PvRelaisData): Manquant[] {
  return [...controlesAvantSignature(d), ...controlesSignature(d)].filter((m) => m.bloquant);
}

/**
 * Validation du PV (spec §3.2 étape 8) : contrôles, empreinte SHA-256, statut « signé », PV figé et mis dans la
 * file d'envoi. La requête d'envoi est construite ici, une fois pour toutes.
 */
export async function signerPv(
  db: UserDb,
  versionId: string,
  args: { donnees: PvRelaisData; signataire: { id: string; nom: string } },
  now: Date,
): Promise<LocalPv> {
  const pv = await db.pvs.get(versionId);
  if (!pv) throw new PvLocalError("PV introuvable sur cette tablette.");
  if (versionFigee(pv.statut)) throw new PvLocalError("Ce PV est déjà signé.");
  if (pv.clotAilleurs) throw new PvLocalError(messageClotAilleurs(pv.clotAilleurs));
  const donnees = pvRelaisDataSchema.parse(avecEcritPar(args.donnees, args.signataire.nom));
  const manquants = manquantsBloquants(donnees);
  if (manquants.length > 0) throw new PvLocalError("Le PV n'est pas complet.", manquants);

  const meta = await lireMeta(db);
  const signeLe = now.toISOString();
  const empreinte = await empreintePv({
    pvId: pv.pvId,
    versionId: pv.versionId,
    numero: pv.numero,
    indice: pv.indice,
    signeLe,
    donnees,
  });
  const journal = pv.donneesPreparees
    ? majJournalModifications(pv.journal, valeursPrepareesModifiees(pv.donneesPreparees, donnees), {
        par: args.signataire.nom,
        le: signeLe,
      })
    : [];
  const payload: UploadPvVersionRequest = {
    pvId: pv.pvId,
    affaireId: pv.affaireId,
    equipementId: pv.equipementId,
    numero: pv.numero,
    indice: pv.indice,
    modele: "relais",
    modeleVersion: pv.modeleVersion,
    donnees,
    donneesPreparees: pv.origine === "prepare" ? pv.donneesPreparees : null,
    modifications: journal,
    creeLe: pv.creeLe,
    signeLe,
    tabletteId: meta.tabletteId,
    empreinte,
  };
  const signe: LocalPv = {
    ...pv,
    donnees,
    journal,
    statut: "signe",
    signeLe,
    signePar: args.signataire.nom,
    empreinte,
    modifieLe: signeLe,
    erreurEnvoi: null,
  };
  await db.transaction("rw", db.pvs, db.outbox, async () => {
    const actuel = await db.pvs.get(versionId);
    if (!actuel || versionFigee(actuel.statut)) throw new PvLocalError("Ce PV est déjà signé.");
    if (actuel.clotAilleurs) throw new PvLocalError(messageClotAilleurs(actuel.clotAilleurs));
    await db.pvs.put(signe);
    await db.outbox.put({
      versionId,
      ajouteLe: signeLe,
      payload,
      tentatives: 0,
      derniereTentative: null,
      derniereErreur: null,
      bloque: false,
    });
  });
  return signe;
}

/**
 * « Créer un PV sur site » (spec §3.2 étape 1) n'a de sens que pour un équipement sans PV et doté d'un modèle :
 * un PV existant (sur la tablette ou au serveur : préparé, en cours, déposé) se complète ou s'affecte, et le
 * régulateur de tension n'a pas de modèle de PV (spec §4.5).
 */
export function creationSurSite(
  e: Pick<LocalAffaire["equipements"][number], "id" | "tag" | "libelle" | "avancement">,
  locaux: readonly Pick<LocalPv, "equipementId">[],
): { possible: true } | { possible: false; raison: string } {
  if (!modelePvEquipement(e)) {
    return { possible: false, raison: "Pas de modèle de PV pour cet équipement : aucun PV n'est prévu." };
  }
  if (locaux.some((p) => p.equipementId === e.id)) {
    return { possible: false, raison: "Un PV existe déjà pour cet équipement sur cette tablette." };
  }
  if (e.avancement.nbPv > 0) {
    return {
      possible: false,
      raison:
        "Un PV existe déjà pour cet équipement (préparé, en cours ou déposé) : s'il vous revient, demandez au bureau de vous l'affecter.",
    };
  }
  return { possible: true };
}

/** PV signé depuis une autre tablette : qui, quand, et ce que cela implique pour la copie locale. */
export function messageClotAilleurs(c: PvClotAilleurs): string {
  const par = c.signePar ? ` par ${c.signePar}` : "";
  const le = c.signeLe ? ` le ${formatDateTime(c.signeLe)}` : "";
  return `Ce PV a été signé${par}${le} depuis une autre tablette et envoyé au serveur : la saisie faite sur cette tablette n'est plus modifiable ni signable.`;
}

/** Retire de la tablette la copie d'un PV signé ailleurs (elle ne peut plus servir). */
export async function retirerPvClotAilleurs(db: UserDb, versionId: string): Promise<void> {
  await db.transaction("rw", db.pvs, async () => {
    const pv = await db.pvs.get(versionId);
    if (!pv) return;
    if (!pv.clotAilleurs) throw new PvLocalError("Seul un PV signé depuis une autre tablette peut être retiré.");
    await db.pvs.delete(versionId);
  });
}

/** Supprime un brouillon créé sur site (erreur d'équipement…). Les PV préparés ou signés ne se suppriment pas. */
export async function supprimerBrouillonSite(db: UserDb, versionId: string): Promise<void> {
  await db.transaction("rw", db.pvs, async () => {
    const pv = await db.pvs.get(versionId);
    if (!pv) return;
    if (pv.origine !== "site" || pv.statut !== "brouillon") {
      throw new PvLocalError("Seul un brouillon créé sur cette tablette peut être supprimé.");
    }
    await db.pvs.delete(versionId);
  });
}

/** La liste E/S de l'affaire a changé depuis la création du PV : il garde sa version, le technicien est averti. */
export function listeEsObsolete(pv: LocalPv, affaire: LocalAffaire | undefined): boolean {
  const v = pv.donnees.es.listeVersion;
  const derniere = affaire?.liste?.version ?? null;
  return v !== null && derniere !== null && derniere !== v;
}

/** Document complet pour l'aperçu (même rendu que le PDF, spec §3.2 étape 5). */
export function construirePvDocument(pv: LocalPv, affaire: LocalAffaire | undefined, now: Date): PvDocument {
  const a = affaire?.affaire;
  const eq = affaire?.equipements.find((e) => e.id === pv.equipementId) ?? null;
  const es = pv.donnees.es;
  return {
    format: "spie-pv/1",
    pv: { id: pv.pvId, numero: pv.numero, modele: pv.modele, modeleVersion: pv.modeleVersion, famille: FAMILLE_RELAIS },
    version: {
      id: pv.versionId,
      indice: pv.indice,
      statutDocument: pv.donnees.entete.statutDocument,
      signeLe: pv.signeLe,
      empreinte: pv.empreinte,
    },
    affaire: {
      numero: a?.numero ?? pv.donnees.entete.numeroAffaire,
      client: a?.client ?? pv.donnees.entete.client,
      projet: a?.projet ?? pv.donnees.entete.projet,
      site: a?.site ?? "",
    },
    equipement: eq
      ? {
          tag: eq.tag,
          libelle: eq.libelle,
          typeCellule: eq.typeCellule,
          modele: eq.modele,
          local: eq.local,
          tagArmoire: eq.tagArmoire,
        }
      : null,
    listeEs:
      es.listeId && es.listeVersion !== null
        ? { id: es.listeId, reference: es.referenceDocument, revision: es.revision, version: es.listeVersion }
        : null,
    meta: {
      creeLe: pv.creeLe,
      tabletteId: null,
      signePar: null,
      recuLe: null,
      genereLe: now.toISOString(),
    },
    donnees: pv.donnees,
    donneesPreparees: pv.donneesPreparees,
    modifications: pv.journal,
  };
}
