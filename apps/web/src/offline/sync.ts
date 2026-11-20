import { versionFigee, type PvVersionStatusDto, type SyncPvDto, type SyncReferenceDto } from "@spie/shared";
import { ApiError, api, type RequestOptions } from "../lib/api";
import { majMeta, type LocalAffaire, type LocalPv, type UserDb } from "./db";

/**
 * Synchronisation de la tablette (spec §3.3, §6.3, §6.5) :
 * 1. signale au serveur les PV préparés dont la saisie a commencé ;
 * 2. envoie la file des PV signés (retrait seulement après accusé de réception) ;
 * 3. récupère le référentiel (affaires, équipements, listes E/S, PV préparés) et le fusionne ;
 * 4. clôt les brouillons signés depuis une autre tablette (PV affecté à plusieurs techniciens) ;
 * 5. rafraîchit le statut des PV reçus jusqu'au dépôt ;
 * 6. purge les PV déposés (ou signés ailleurs) depuis plus de `retentionJours`.
 */

export type Fetcher = <T>(path: string, opts?: RequestOptions) => Promise<T>;

export interface SyncResult {
  /** Référentiel récupéré : la tablette est prête pour le hors ligne. */
  referenceOk: boolean;
  envoyes: number;
  /** PV refusés par le serveur (409, 422…), visibles sur la tablette. */
  refuses: number;
  /** PV en cours de saisie ici, constatés signés depuis une autre tablette pendant cette synchro. */
  closAilleurs: number;
  /** Session expirée : l'utilisateur doit se reconnecter pour envoyer (spec §7.2). */
  authRequise: boolean;
  /** Serveur injoignable : nouvel essai au prochain déclencheur. */
  horsLigne: boolean;
  message: string | null;
  termineLe: string;
}

// --- Fusion du référentiel (fonction pure) ---------------------------------------------------------------------------

export interface FusionReference {
  aAjouter: LocalPv[];
  aMettreAJour: LocalPv[];
  aSupprimer: string[];
}

function pvDepuisReference(dto: SyncPvDto, now: string): LocalPv {
  return {
    versionId: dto.versionId,
    pvId: dto.pvId,
    numero: dto.numero,
    indice: dto.indice,
    modele: "relais",
    modeleVersion: dto.modeleVersion,
    affaireId: dto.affaireId,
    equipementId: dto.equipementId,
    origine: "prepare",
    statut: "prepare",
    donnees: dto.donnees,
    donneesPreparees: dto.donnees,
    journal: [],
    creeLe: dto.creeLe,
    modifieLe: now,
    bureauMisAJourLe: dto.misAJourLe,
    saisieCommenceeLe: null,
    saisieSignalee: false,
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
}

/**
 * Règles du §6.5 : un PV préparé modifié au bureau remplace la copie de la tablette tant que la saisie n'a pas
 * commencé ; ensuite la tablette fait foi et l'on mémorise que le bureau a une version plus récente. Un PV préparé
 * qui n'est plus affecté (ou supprimé) disparaît s'il n'a pas été commencé. Les PV créés sur site ne sont pas touchés.
 */
export function fusionnerReference(
  locaux: readonly LocalPv[],
  pvs: readonly SyncPvDto[],
  now: string,
): FusionReference {
  const parVersion = new Map(locaux.map((p) => [p.versionId, p] as const));
  const recus = new Set(pvs.map((p) => p.versionId));
  const out: FusionReference = { aAjouter: [], aMettreAJour: [], aSupprimer: [] };

  for (const dto of pvs) {
    const local = parVersion.get(dto.versionId);
    if (!local) {
      out.aAjouter.push(pvDepuisReference(dto, now));
      continue;
    }
    if (local.statut === "prepare") {
      if (dto.misAJourLe !== local.bureauMisAJourLe) {
        out.aMettreAJour.push({
          ...local,
          numero: dto.numero,
          equipementId: dto.equipementId,
          modeleVersion: dto.modeleVersion,
          donnees: dto.donnees,
          donneesPreparees: dto.donnees,
          bureauMisAJourLe: dto.misAJourLe,
          modifieLe: now,
        });
      }
    } else if (
      local.statut === "brouillon" &&
      local.bureauMisAJourLe !== null &&
      dto.misAJourLe > local.bureauMisAJourLe &&
      local.versionBureauIgnoree !== dto.misAJourLe
    ) {
      out.aMettreAJour.push({ ...local, versionBureauIgnoree: dto.misAJourLe });
    }
  }
  for (const local of locaux) {
    if (local.origine === "prepare" && local.statut === "prepare" && !recus.has(local.versionId)) {
      out.aSupprimer.push(local.versionId);
    }
  }
  return out;
}

/**
 * PV en cours de saisie ici que le serveur ne propose plus comme « préparés » : peut-être signés depuis une autre
 * tablette (PV affecté à plusieurs techniciens). Leur statut est à demander au serveur.
 */
export function brouillonsAVerifier(locaux: readonly LocalPv[], recus: readonly SyncPvDto[]): LocalPv[] {
  const ids = new Set(recus.map((p) => p.versionId));
  return locaux.filter(
    (p) => p.origine === "prepare" && p.statut === "brouillon" && !p.clotAilleurs && !ids.has(p.versionId),
  );
}

/** PV déposés, ou signés ailleurs, dont la durée de conservation sur la tablette est écoulée (spec §6.3). */
export function pvsAPurger(pvs: readonly LocalPv[], now: Date, retentionJours: number): string[] {
  const limite = now.getTime() - retentionJours * 86_400_000;
  const date = (p: LocalPv) =>
    p.clotAilleurs
      ? p.clotAilleurs.constateLe
      : p.statut === "depose"
        ? (p.deposeLe ?? p.envoyeLe ?? p.modifieLe)
        : null;
  return pvs
    .filter((p) => {
      const d = date(p);
      return d !== null && new Date(d).getTime() < limite;
    })
    .map((p) => p.versionId);
}

/** Applique un statut renvoyé par le serveur à la copie locale. */
export function appliquerStatut(pv: LocalPv, s: PvVersionStatusDto, now: string): LocalPv {
  const erreurDepot = s.depots.find((d) => d.statut === "erreur")?.derniereErreur ?? null;
  return {
    ...pv,
    statut: s.statut,
    depots: s.depots,
    alerteDoublon: s.alerteDoublon,
    envoyeLe: pv.envoyeLe ?? now,
    deposeLe: s.statut === "depose" ? (pv.deposeLe ?? now) : pv.deposeLe,
    erreurEnvoi: s.statut === "erreur" ? (erreurDepot ?? "Erreur de dépôt dans SharePoint.") : null,
  };
}

const REFUS_DEFINITIFS = new Set([400, 403, 404, 409, 413, 422]);

// --- Moteur ----------------------------------------------------------------------------------------------------------

export interface SyncEngineOptions {
  db: UserDb;
  fetcher?: Fetcher;
  now?: () => Date;
  retentionJours?: number;
}

export class SyncEngine {
  private readonly db: UserDb;
  private readonly fetcher: Fetcher;
  private readonly now: () => Date;
  private readonly retentionJours: number;
  private courante: Promise<SyncResult> | null = null;

  constructor(opts: SyncEngineOptions) {
    this.db = opts.db;
    this.fetcher = opts.fetcher ?? api;
    this.now = opts.now ?? (() => new Date());
    this.retentionJours = opts.retentionJours ?? 30;
  }

  /** Une seule synchronisation à la fois : un appel pendant une synchro renvoie la synchro en cours. */
  synchroniser(): Promise<SyncResult> {
    this.courante ??= this.executer().finally(() => {
      this.courante = null;
    });
    return this.courante;
  }

  get enCours(): boolean {
    return this.courante !== null;
  }

  private async executer(): Promise<SyncResult> {
    const r: SyncResult = {
      referenceOk: false,
      envoyes: 0,
      refuses: 0,
      closAilleurs: 0,
      authRequise: false,
      horsLigne: false,
      message: null,
      termineLe: "",
    };
    try {
      await this.signalerSaisiesCommencees();
      await this.envoyerFile(r);
      if (!r.authRequise && !r.horsLigne) {
        const ref = await this.recupererReference();
        r.referenceOk = true;
        r.closAilleurs = await this.verifierBrouillons(ref);
        await this.rafraichirStatuts();
      }
    } catch (err) {
      this.noterErreur(r, err);
    }
    await this.purger();
    r.termineLe = this.now().toISOString();
    if (r.authRequise) r.message = "Session expirée : reconnectez-vous pour envoyer les PV signés.";
    else if (r.horsLigne) r.message = "Serveur injoignable : les PV restent sur la tablette, nouvel essai automatique.";
    else if (r.refuses > 0) r.message = `${r.refuses} PV refusé(s) par le serveur : voir le détail sur le PV.`;
    else if (r.closAilleurs > 0) {
      r.message = `${r.closAilleurs} PV en cours de saisie signé(s) depuis une autre tablette : ils ne sont plus modifiables.`;
    }
    return r;
  }

  private noterErreur(r: SyncResult, err: unknown) {
    if (err instanceof ApiError && err.status === 401) r.authRequise = true;
    else if (err instanceof ApiError && err.code === "network") r.horsLigne = true;
    else r.message = err instanceof Error ? err.message : "Erreur de synchronisation.";
  }

  async signalerSaisiesCommencees(): Promise<number> {
    const aSignaler = await this.db.pvs
      .filter((p) => p.origine === "prepare" && p.saisieCommenceeLe !== null && !p.saisieSignalee)
      .toArray();
    if (aSignaler.length === 0) return 0;
    await this.fetcher("/api/sync/started", {
      method: "POST",
      body: { versionIds: aSignaler.map((p) => p.versionId) },
    });
    await this.db.pvs.bulkUpdate(aSignaler.map((p) => ({ key: p.versionId, changes: { saisieSignalee: true } })));
    return aSignaler.length;
  }

  /** Envoie la file, dans l'ordre de signature. S'arrête au premier problème de réseau ou de session. */
  async envoyerFile(r: SyncResult): Promise<void> {
    const items = await this.db.outbox.orderBy("ajouteLe").toArray();
    for (const item of items) {
      if (item.bloque) continue;
      const tentative = this.now().toISOString();
      try {
        const status = await this.fetcher<PvVersionStatusDto>(`/api/pv-versions/${item.versionId}`, {
          method: "PUT",
          body: item.payload,
        });
        await this.db.transaction("rw", this.db.pvs, this.db.outbox, async () => {
          const pv = await this.db.pvs.get(item.versionId);
          if (pv) await this.db.pvs.put(appliquerStatut(pv, status, tentative));
          await this.db.outbox.delete(item.versionId);
        });
        r.envoyes++;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          r.authRequise = true;
          await this.marquerEchec(item.versionId, tentative, "Session expirée : reconnectez-vous pour envoyer.", false);
          return;
        }
        if (err instanceof ApiError && REFUS_DEFINITIFS.has(err.status)) {
          r.refuses++;
          const msg =
            err.code === "integrity"
              ? `Empreinte refusée par le serveur : ${err.message}`
              : err.status === 409
                ? `Conflit : ${err.message}`
                : err.message;
          await this.marquerEchec(item.versionId, tentative, msg, true);
          continue;
        }
        // Réseau ou erreur serveur : on garde le PV dans la file et on réessaiera.
        if (err instanceof ApiError && err.code === "network") r.horsLigne = true;
        await this.marquerEchec(
          item.versionId,
          tentative,
          err instanceof Error ? err.message : "Erreur d'envoi.",
          false,
        );
        return;
      }
    }
  }

  private async marquerEchec(versionId: string, le: string, message: string, bloque: boolean) {
    await this.db.transaction("rw", this.db.pvs, this.db.outbox, async () => {
      const item = await this.db.outbox.get(versionId);
      if (item) {
        await this.db.outbox.put({
          ...item,
          tentatives: item.tentatives + 1,
          derniereTentative: le,
          derniereErreur: message,
          bloque,
        });
      }
      await this.db.pvs.update(versionId, { erreurEnvoi: message });
    });
  }

  /** Remet un PV refusé dans la file (après correction côté serveur, par exemple). */
  async reessayer(versionId: string): Promise<void> {
    await this.db.outbox.update(versionId, { bloque: false, derniereErreur: null });
    await this.db.pvs.update(versionId, { erreurEnvoi: null });
  }

  async recupererReference(): Promise<SyncReferenceDto> {
    const ref = await this.fetcher<SyncReferenceDto>("/api/sync/reference");
    const now = this.now();
    const iso = now.toISOString();
    const affaires: LocalAffaire[] = ref.affaires.map((a) => ({
      id: a.affaire.id,
      affaire: a.affaire,
      equipements: a.equipements,
      liste: a.liste,
      synchroLe: iso,
    }));
    await this.db.transaction("rw", this.db.affaires, this.db.pvs, this.db.meta, async () => {
      // Affaires désaffectées : retirées du référentiel local (les PV locaux restent jusqu'à leur envoi).
      await this.db.affaires.clear();
      await this.db.affaires.bulkPut(affaires);
      const f = fusionnerReference(await this.db.pvs.toArray(), ref.pvs, iso);
      if (f.aAjouter.length) await this.db.pvs.bulkAdd(f.aAjouter);
      if (f.aMettreAJour.length) await this.db.pvs.bulkPut(f.aMettreAJour);
      if (f.aSupprimer.length) await this.db.pvs.bulkDelete(f.aSupprimer);
      await majMeta(this.db, {
        derniereSynchro: iso,
        decalageHorlogeMs: new Date(ref.serverTime).getTime() - now.getTime(),
      });
    });
    return ref;
  }

  /**
   * PV affecté à plusieurs techniciens : un brouillon local que le serveur ne propose plus est peut-être signé par
   * quelqu'un d'autre. Si oui, la copie locale est close (lecture seule, signature impossible) et le technicien averti,
   * au lieu de découvrir un refus (409) après avoir signé. PV retiré ou désaffecté : rien ne change ici.
   */
  async verifierBrouillons(ref: SyncReferenceDto): Promise<number> {
    let clos = 0;
    for (const pv of brouillonsAVerifier(await this.db.pvs.toArray(), ref.pvs)) {
      let s: PvVersionStatusDto;
      try {
        s = await this.fetcher<PvVersionStatusDto>(`/api/pv-versions/${pv.versionId}/status`);
      } catch (err) {
        if (err instanceof ApiError && (err.code === "network" || err.status === 401)) throw err;
        continue;
      }
      if (!versionFigee(s.statut)) continue;
      const clotAilleurs = {
        statut: s.statut,
        signePar: s.signePar,
        signeLe: s.signeLe,
        constateLe: this.now().toISOString(),
      };
      await this.db.pvs.update(pv.versionId, { clotAilleurs });
      clos++;
    }
    return clos;
  }

  /** Statut des PV reçus (et en erreur : l'administrateur peut relancer) jusqu'au dépôt. */
  async rafraichirStatuts(): Promise<void> {
    const suivis = await this.db.pvs.filter((p) => p.statut === "recu" || p.statut === "erreur").toArray();
    for (const pv of suivis) {
      if (await this.db.outbox.get(pv.versionId)) continue;
      try {
        const s = await this.fetcher<PvVersionStatusDto>(`/api/pv-versions/${pv.versionId}/status`);
        await this.db.pvs.put(appliquerStatut(pv, s, this.now().toISOString()));
      } catch (err) {
        // Réseau ou session : on arrête ; autre erreur (PV inconnu…) : on passe au suivant.
        if (err instanceof ApiError && (err.code === "network" || err.status === 401)) throw err;
      }
    }
  }

  async purger(): Promise<number> {
    const ids = pvsAPurger(await this.db.pvs.toArray(), this.now(), this.retentionJours);
    if (ids.length) await this.db.pvs.bulkDelete(ids);
    return ids.length;
  }
}

/**
 * Déclencheurs de l'envoi (spec §6.3) : ouverture de l'application, retour du réseau (`online`), périodiquement
 * tant que l'application est ouverte. Le bouton « Synchroniser » appelle directement `synchroniser`.
 */
export function installerDeclencheurs(
  cible: { synchroniser: () => Promise<unknown> },
  opts: { intervalleMs?: number; win?: Pick<Window, "addEventListener" | "removeEventListener"> } = {},
): () => void {
  const win = opts.win ?? window;
  const lancer = () => void cible.synchroniser().catch(() => undefined);
  lancer();
  win.addEventListener("online", lancer);
  const timer = setInterval(lancer, opts.intervalleMs ?? 2 * 60_000);
  return () => {
    win.removeEventListener("online", lancer);
    clearInterval(timer);
  };
}
