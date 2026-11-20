import { FAMILLE_RELAIS, delaiReprise, segmentsChemin } from "@spie/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { affaires, depots, famillesSharePoint, pvs, versionsPv } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { conflict, notFound } from "../lib/errors.js";
import { SharePointConflictError, ensureFolderPath, type SharePointClient } from "../sharepoint/types.js";
import type { FileArchive } from "../storage/archive.js";
import { construirePvDocument } from "./documents.js";
import { CONTENT_TYPES, type GenerateurFichiers } from "./fichiers.js";

type DepotRow = typeof depots.$inferSelect;

export interface LoggerLike {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface TraitementDeps {
  db: Db;
  sharepoint: SharePointClient | null;
  archive: FileArchive;
  fichiers: GenerateurFichiers;
  now: () => Date;
  /** Sous-dossier manquant : créé (true) ou erreur (false), point ouvert n°13. */
  createMissingFolders: boolean;
  log?: LoggerLike;
  /** Durée du bail d'un dépôt en cours de traitement (un autre worker ne le reprend pas avant). */
  leaseMs?: number;
}

const silence: LoggerLike = { info() {}, warn() {}, error() {} };

/**
 * Génération des fichiers et dépôt SharePoint (spec §3.3, §5.4), tâche asynchrone. La table `depot` sert de file :
 * chaque dépôt échu est réservé (`FOR UPDATE SKIP LOCKED` + bail), traité, puis replanifié en cas d'échec avec un
 * délai croissant (1 min, 5 min, 30 min, 2 h, 6 h) avant de passer en Erreur (alerte dans le back-office).
 */
export class TraitementDepots {
  private timer: ReturnType<typeof setInterval> | null = null;
  private courant: Promise<void> | null = null;
  private encore = false;
  private readonly log: LoggerLike;

  constructor(private readonly deps: TraitementDeps) {
    this.log = deps.log ?? silence;
  }

  /** Réserve les dépôts échus (au plus `limit`) et les traite. Renvoie le nombre de dépôts traités. */
  async traiterEchus(limit = 5): Promise<number> {
    const { db } = this.deps;
    const now = this.deps.now();
    const bail = new Date(now.getTime() + (this.deps.leaseMs ?? 5 * 60_000));
    const res = (await db.execute(sql`
      update depot set verrou_jusqua = ${bail.toISOString()}::timestamptz
      where id in (
        select id from depot
        where statut = 'en_attente'
          and prochaine_tentative <= ${now.toISOString()}::timestamptz
          and (verrou_jusqua is null or verrou_jusqua < ${now.toISOString()}::timestamptz)
        order by prochaine_tentative
        limit ${limit}
        for update skip locked
      )
      returning id`)) as unknown as { rows: { id: string }[] };
    const ids = res.rows.map((r) => r.id);
    if (ids.length === 0) return 0;
    const rows = await db.select().from(depots).where(inArray(depots.id, ids));
    for (const d of rows) await this.traiterDepot(d);
    return rows.length;
  }

  /** Fichier de la version : copie d'archive s'il a déjà été produit, sinon génération puis archivage. */
  private async contenu(d: DepotRow, affaireNumero: string, numero: string): Promise<Uint8Array> {
    const { db, archive, fichiers } = this.deps;
    if (d.archiveKey) {
      const copie = await archive.get(d.archiveKey);
      if (copie) return copie;
    }
    const doc = await construirePvDocument(db, d.versionId, this.deps.now());
    const contenu = await fichiers.generer(d.fichier, doc);
    const key = `pv/${affaireNumero}/${numero}/${d.nom}`;
    await archive.put(key, contenu, CONTENT_TYPES[d.fichier]);
    await db.update(depots).set({ archiveKey: key, taille: contenu.byteLength }).where(eq(depots.id, d.id));
    return contenu;
  }

  async traiterDepot(d: DepotRow): Promise<void> {
    const { db } = this.deps;
    const [ctx] = await db
      .select({ pv: pvs, affaire: affaires })
      .from(versionsPv)
      .innerJoin(pvs, eq(versionsPv.pvId, pvs.id))
      .innerJoin(affaires, eq(pvs.affaireId, affaires.id))
      .where(eq(versionsPv.id, d.versionId));
    if (!ctx) return;
    const { pv, affaire } = ctx;
    try {
      const contenu = await this.contenu(d, affaire.numero, pv.numero);
      const sp = this.deps.sharepoint;
      if (!sp) throw new Error("SharePoint n'est pas configuré sur ce serveur.");
      if (!affaire.sharepointDriveId || !affaire.sharepointItemId) {
        throw new Error(`L'affaire ${affaire.numero} n'a pas de dossier SharePoint cible.`);
      }
      const [famille] = await db
        .select()
        .from(famillesSharePoint)
        .where(eq(famillesSharePoint.famille, FAMILLE_RELAIS));
      const dossier = await ensureFolderPath(
        sp,
        affaire.sharepointDriveId,
        affaire.sharepointItemId,
        segmentsChemin(famille?.cheminRelatif ?? ""),
        this.deps.createMissingFolders,
      );
      let depose: { id: string; webUrl: string | null };
      try {
        depose = await sp.uploadFile({
          driveId: dossier.driveId,
          parentItemId: dossier.itemId,
          fileName: d.nom,
          content: contenu,
          contentType: CONTENT_TYPES[d.fichier],
        });
      } catch (err) {
        if (!(err instanceof SharePointConflictError)) throw err;
        // Un fichier n'est jamais écrasé (spec §5.4). Même nom et même taille : c'est notre dépôt précédent, dont
        // l'accusé a été perdu (arrêt du worker). Sinon, un autre fichier porte ce nom : erreur à traiter par l'admin.
        const existant = await sp.getChild(dossier.driveId, dossier.itemId, d.nom);
        if (!existant || existant.isFolder || existant.size !== contenu.byteLength) {
          throw new Error(`Un autre fichier nommé « ${d.nom} » existe déjà dans « ${dossier.path} ».`);
        }
        depose = { id: existant.id, webUrl: existant.webUrl };
      }
      const now = this.deps.now();
      await db
        .update(depots)
        .set({
          statut: "depose",
          deposeLe: now,
          itemId: depose.id,
          webUrl: depose.webUrl,
          cheminSharePoint: `${dossier.path} / ${d.nom}`,
          derniereErreur: null,
          prochaineTentative: null,
          verrouJusqua: null,
          updatedAt: now,
        })
        .where(eq(depots.id, d.id));
      await audit(db, {
        action: "depot.reussi",
        targetType: "pv",
        targetId: pv.id,
        details: { numero: pv.numero, fichier: d.nom, dossier: dossier.path, webUrl: depose.webUrl },
      });
      await this.majStatutVersion(d.versionId, now);
      this.log.info({ depot: d.id, fichier: d.nom }, "fichier déposé dans SharePoint");
    } catch (err) {
      await this.echec(d, pv, err as Error);
    }
  }

  private async echec(d: DepotRow, pv: typeof pvs.$inferSelect, err: Error): Promise<void> {
    const { db } = this.deps;
    const now = this.deps.now();
    const tentatives = d.tentatives + 1;
    const delai = delaiReprise(tentatives);
    const message = err.message.slice(0, 2000);
    if (delai === null) {
      await db
        .update(depots)
        .set({
          statut: "erreur",
          tentatives,
          derniereErreur: message,
          prochaineTentative: null,
          verrouJusqua: null,
          updatedAt: now,
        })
        .where(eq(depots.id, d.id));
      await db.update(versionsPv).set({ statut: "erreur", updatedAt: now }).where(eq(versionsPv.id, d.versionId));
      await audit(db, {
        action: "depot.erreur",
        targetType: "pv",
        targetId: pv.id,
        details: { numero: pv.numero, fichier: d.nom, tentatives, erreur: message },
      });
      this.log.error(
        { depot: d.id, fichier: d.nom, err: message },
        "dépôt SharePoint en erreur après toutes les reprises",
      );
      return;
    }
    await db
      .update(depots)
      .set({
        tentatives,
        derniereErreur: message,
        prochaineTentative: new Date(now.getTime() + delai),
        verrouJusqua: null,
        updatedAt: now,
      })
      .where(eq(depots.id, d.id));
    this.log.warn(
      { depot: d.id, fichier: d.nom, tentatives, err: message },
      "échec du dépôt, nouvelle tentative planifiée",
    );
  }

  /** La version est « déposée » quand tous ses fichiers le sont. */
  private async majStatutVersion(versionId: string, now: Date): Promise<void> {
    const { db } = this.deps;
    const rows = await db.select({ statut: depots.statut }).from(depots).where(eq(depots.versionId, versionId));
    if (rows.length > 0 && rows.every((r) => r.statut === "depose")) {
      await db
        .update(versionsPv)
        .set({ statut: "depose", deposeLe: now, updatedAt: now })
        .where(eq(versionsPv.id, versionId));
    }
  }

  /** Relance d'un dépôt par l'administrateur (spec §3.3, §5.4) : reprise immédiate, compteur remis à zéro. */
  async relancer(depotId: string, actorId: string, ip?: string): Promise<void> {
    const { db } = this.deps;
    const now = this.deps.now();
    const [d] = await db.select().from(depots).where(eq(depots.id, depotId));
    if (!d) throw notFound("Dépôt introuvable.");
    if (d.statut === "depose") throw conflict("Ce fichier est déjà déposé.");
    await db
      .update(depots)
      .set({ statut: "en_attente", tentatives: 0, prochaineTentative: now, verrouJusqua: null, updatedAt: now })
      .where(eq(depots.id, depotId));
    await db
      .update(versionsPv)
      .set({ statut: "recu", updatedAt: now })
      .where(and(eq(versionsPv.id, d.versionId), eq(versionsPv.statut, "erreur")));
    const [pv] = await db
      .select({ id: pvs.id, numero: pvs.numero })
      .from(versionsPv)
      .innerJoin(pvs, eq(versionsPv.pvId, pvs.id))
      .where(eq(versionsPv.id, d.versionId));
    await audit(db, {
      action: "depot.relance",
      actorId,
      targetType: "pv",
      targetId: pv?.id,
      details: { numero: pv?.numero, fichier: d.nom, derniereErreur: d.derniereErreur },
      ip,
    });
    this.reveiller();
  }

  /** Boucle de traitement (worker, ou API en développement). */
  demarrer(intervalMs: number): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.reveiller(), intervalMs);
    this.timer.unref?.();
    this.reveiller();
  }

  /** Lance un passage immédiat si la boucle tourne (ex. juste après la réception d'un PV). */
  reveiller(): void {
    if (!this.timer) return;
    if (this.courant) {
      this.encore = true;
      return;
    }
    this.courant = (async () => {
      try {
        do {
          this.encore = false;
          while ((await this.traiterEchus()) > 0) {
            // on vide la file
          }
        } while (this.encore);
      } catch (err) {
        this.log.error({ err: (err as Error).message }, "erreur de la boucle de traitement des dépôts");
      } finally {
        this.courant = null;
      }
    })();
  }

  async arreter(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.courant;
    await this.deps.fichiers.close();
  }
}
