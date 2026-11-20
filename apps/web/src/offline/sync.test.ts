import type { PvVersionStatusDto, SyncReferenceDto } from "@spie/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSession } from "../lib/api";
import { AFFAIRE, LOCAL_AFFAIRE, SYNC_AFFAIRE, apiErreur, completer, json, syncPv } from "../test/fixtures";
import { creerBase, lireMeta, type LocalPv, type UserDb } from "./db";
import {
  creerPvSurSite,
  enregistrerDonnees,
  messageClotAilleurs,
  ouvrirPvPrepare,
  retirerPvClotAilleurs,
  signerPv,
} from "./pv-local";
import {
  SyncEngine,
  appliquerStatut,
  brouillonsAVerifier,
  fusionnerReference,
  installerDeclencheurs,
  pvsAPurger,
} from "./sync";

let db: UserDb;
let n = 0;
beforeEach(async () => {
  db = creerBase(`test-sync-${++n}`);
  await db.open();
  setSession({
    accessToken: "jeton",
    expiresIn: 900,
    user: {
      id: "00000000-0000-4000-8000-000000000001",
      email: "t@spie.test",
      nom: "Théo",
      role: "technicien",
      mustChangePassword: false,
    },
  });
});
afterEach(async () => {
  vi.unstubAllGlobals();
  db.close();
  await db.delete();
});

const NOW = "2026-11-19T15:00:00.000Z";

function statut(versionId: string, s: PvVersionStatusDto["statut"] = "recu"): PvVersionStatusDto {
  return {
    versionId,
    pvId: "p",
    numero: "A35173-20261119-143205",
    statut: s,
    signeLe: s === "prepare" || s === "brouillon" ? null : NOW,
    signePar: s === "prepare" || s === "brouillon" ? null : "Théo",
    alerteDoublon: false,
    depots:
      s === "depose"
        ? [
            {
              id: "d1",
              fichier: "pdf",
              nom: "PV.pdf",
              statut: "depose",
              tentatives: 1,
              derniereErreur: null,
              prochaineTentative: null,
              webUrl: "https://sp/PV.pdf",
              cheminSharePoint: "A/PV",
              deposeLe: NOW,
            },
          ]
        : [],
  };
}

const reference = (pvs = [syncPv()]): SyncReferenceDto => ({
  serverTime: "2026-11-19T15:00:02.000Z",
  utilisateur: { id: "u", nom: "Théo" },
  affaires: [SYNC_AFFAIRE],
  pvs,
  deposes: [],
  modeles: [{ code: "relais", version: "1.0.0" }],
});

type Handler = (init: RequestInit | undefined) => Response | Promise<Response>;

/** `fetch` simulé : « MÉTHODE /chemin » → réponse. Les appels sont enregistrés. */
function stubFetch(routes: Record<string, Handler>) {
  const calls: { method: string; path: string; body: unknown; auth: string | null }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      method,
      path,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      auth: headers.Authorization ?? null,
    });
    const h = routes[`${method} ${path}`] ?? routes[`${method} *`];
    if (!h) throw new TypeError("Failed to fetch");
    return h(init);
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

async function pvSigne(): Promise<LocalPv> {
  const pv = await creerPvSurSite(
    db,
    { affaire: LOCAL_AFFAIRE, equipementId: SYNC_AFFAIRE.equipements[0]!.id, auteur: "Théo" },
    { now: () => new Date("2026-11-19T13:32:05.000Z"), attendre: async () => undefined },
  );
  return signerPv(
    db,
    pv.versionId,
    { donnees: completer(pv.donnees), signataire: { id: "u", nom: "Théo" } },
    new Date(NOW),
  );
}

const engine = () => new SyncEngine({ db, now: () => new Date(NOW) });

describe("fusionnerReference (spec §6.5)", () => {
  const T = "2026-11-19T08:00:00.000Z";

  it("ajoute un PV préparé inconnu, statut « prepare », avec sa copie préparée", () => {
    const f = fusionnerReference([], [syncPv()], T);
    expect(f.aAjouter).toHaveLength(1);
    expect(f.aAjouter[0]).toMatchObject({
      statut: "prepare",
      origine: "prepare",
      bureauMisAJourLe: "2026-11-18T09:00:00.000Z",
      // Date de création du PV au bureau (numérotation), pas l'heure de la synchronisation.
      creeLe: "2026-11-18T08:30:00.000Z",
    });
    expect(f.aAjouter[0]!.donneesPreparees).toEqual(f.aAjouter[0]!.donnees);
  });

  it("remplace un PV non commencé modifié au bureau", () => {
    const [local] = fusionnerReference([], [syncPv()], T).aAjouter;
    const nouveau = syncPv({ misAJourLe: "2026-11-19T07:00:00.000Z" });
    nouveau.donnees.generalites.lieu = "Nouveau lieu";
    const f = fusionnerReference([local!], [nouveau], T);
    expect(f.aMettreAJour).toHaveLength(1);
    expect(f.aMettreAJour[0]!.donnees.generalites.lieu).toBe("Nouveau lieu");
    expect(f.aMettreAJour[0]!.bureauMisAJourLe).toBe("2026-11-19T07:00:00.000Z");
    // Rien de nouveau : rien à faire.
    expect(fusionnerReference([local!], [syncPv()], T)).toEqual({ aAjouter: [], aMettreAJour: [], aSupprimer: [] });
  });

  it("une fois la saisie commencée, la tablette fait foi et mémorise la version ignorée", () => {
    const [local] = fusionnerReference([], [syncPv()], T).aAjouter;
    const commence = { ...local!, statut: "brouillon" as const, saisieCommenceeLe: T };
    const nouveau = syncPv({ misAJourLe: "2026-11-19T07:00:00.000Z" });
    nouveau.donnees.generalites.lieu = "Nouveau lieu";
    const f = fusionnerReference([commence], [nouveau], T);
    expect(f.aMettreAJour).toEqual([{ ...commence, versionBureauIgnoree: "2026-11-19T07:00:00.000Z" }]);
    expect(fusionnerReference([f.aMettreAJour[0]!], [nouveau], T).aMettreAJour).toEqual([]);
  });

  it("retire un PV préparé désaffecté non commencé, garde les PV commencés et ceux créés sur site", () => {
    const [local] = fusionnerReference([], [syncPv()], T).aAjouter;
    const commence = { ...local!, versionId: "v2", statut: "brouillon" as const };
    const site = { ...local!, versionId: "v3", origine: "site" as const, statut: "brouillon" as const };
    const f = fusionnerReference([local!, commence, site], [], T);
    expect(f.aSupprimer).toEqual([local!.versionId]);
  });
});

describe("pvsAPurger et appliquerStatut", () => {
  it("purge les PV déposés depuis plus que la durée de conservation", () => {
    const base = fusionnerReference([], [syncPv()], NOW).aAjouter[0]!;
    const vieux = { ...base, versionId: "a", statut: "depose" as const, deposeLe: "2026-10-01T00:00:00.000Z" };
    const recent = { ...base, versionId: "b", statut: "depose" as const, deposeLe: "2026-11-10T00:00:00.000Z" };
    const nonDepose = {
      ...base,
      versionId: "c",
      statut: "recu" as const,
      deposeLe: null,
      envoyeLe: "2026-01-01T00:00:00.000Z",
    };
    expect(pvsAPurger([vieux, recent, nonDepose], new Date(NOW), 30)).toEqual(["a"]);
    expect(pvsAPurger([vieux, recent], new Date(NOW), 5)).toEqual(["a", "b"]);
  });

  it("applique le statut serveur : déposé daté, erreur de dépôt visible", () => {
    const base = fusionnerReference([], [syncPv()], NOW).aAjouter[0]!;
    const depose = appliquerStatut(base, statut(base.versionId, "depose"), NOW);
    expect(depose).toMatchObject({ statut: "depose", deposeLe: NOW, envoyeLe: NOW, erreurEnvoi: null });
    const erreur = appliquerStatut(
      base,
      {
        ...statut(base.versionId, "erreur"),
        depots: [
          {
            id: "d",
            fichier: "pdf",
            nom: "x",
            statut: "erreur",
            tentatives: 6,
            derniereErreur: "accès refusé",
            prochaineTentative: null,
            webUrl: null,
            cheminSharePoint: null,
            deposeLe: null,
          },
        ],
      },
      NOW,
    );
    expect(erreur).toMatchObject({ statut: "erreur", erreurEnvoi: "accès refusé" });
  });
});

describe("SyncEngine — file d'envoi (spec §6.3)", () => {
  it("2xx : retire de la file après accusé de réception et applique le statut", async () => {
    const pv = await pvSigne();
    const calls = stubFetch({
      [`PUT /api/pv-versions/${pv.versionId}`]: () => json(201, statut(pv.versionId)),
      "GET /api/sync/reference": () => json(200, reference()),
      [`GET /api/pv-versions/${pv.versionId}/status`]: () => json(200, statut(pv.versionId, "depose")),
    });
    const r = await engine().synchroniser();
    expect(r).toMatchObject({
      envoyes: 1,
      refuses: 0,
      referenceOk: true,
      authRequise: false,
      horsLigne: false,
      message: null,
    });
    expect(await db.outbox.count()).toBe(0);
    expect((await db.pvs.get(pv.versionId))?.statut).toBe("depose");
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.auth).toBe("Bearer jeton");
    expect(put.body).toMatchObject({ numero: pv.numero, empreinte: pv.empreinte });
  });

  it("409 et 422 : erreur visible, le PV reste dans la file sans nouvel essai automatique ; les suivants partent", async () => {
    const a = await pvSigne();
    const b = await pvSigne();
    stubFetch({
      [`PUT /api/pv-versions/${a.versionId}`]: () => apiErreur(422, "integrity", "Empreinte différente."),
      [`PUT /api/pv-versions/${b.versionId}`]: () => apiErreur(409, "conflict", "Version déjà reçue."),
      "GET /api/sync/reference": () => json(200, reference([])),
    });
    const r = await engine().synchroniser();
    expect(r.refuses).toBe(2);
    expect(r.message).toContain("2 PV refusé");
    expect(await db.outbox.get(a.versionId)).toMatchObject({ bloque: true, tentatives: 1 });
    expect((await db.pvs.get(a.versionId))?.erreurEnvoi).toBe(
      "Empreinte refusée par le serveur : Empreinte différente.",
    );
    expect((await db.pvs.get(b.versionId))?.erreurEnvoi).toBe("Conflit : Version déjà reçue.");
    // Un PV bloqué n'est plus renvoyé…
    const calls = stubFetch({ "GET /api/sync/reference": () => json(200, reference([])) });
    await engine().synchroniser();
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
    // …sauf si l'utilisateur le demande.
    await engine().reessayer(a.versionId);
    expect(await db.outbox.get(a.versionId)).toMatchObject({ bloque: false, derniereErreur: null });
    expect((await db.pvs.get(a.versionId))?.erreurEnvoi).toBeNull();
  });

  it("401 : session expirée, rien n'est perdu et le référentiel n'est pas demandé", async () => {
    const pv = await pvSigne();
    const calls = stubFetch({
      [`PUT /api/pv-versions/${pv.versionId}`]: () => apiErreur(401, "unauthorized", "Session expirée."),
      "POST /api/auth/refresh": () => apiErreur(401, "unauthorized", "Session expirée."),
    });
    const r = await engine().synchroniser();
    expect(r).toMatchObject({ authRequise: true, referenceOk: false, envoyes: 0 });
    expect(r.message).toContain("reconnectez-vous");
    expect(await db.outbox.get(pv.versionId)).toMatchObject({ bloque: false, tentatives: 1 });
    expect((await db.pvs.get(pv.versionId))?.statut).toBe("signe");
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      `PUT /api/pv-versions/${pv.versionId}`,
      "POST /api/auth/refresh",
    ]);
  });

  it("réseau absent : hors ligne, le PV reste dans la file et repart à la synchro suivante", async () => {
    const pv = await pvSigne();
    stubFetch({});
    const r = await engine().synchroniser();
    expect(r).toMatchObject({ horsLigne: true, referenceOk: false });
    expect(r.message).toContain("injoignable");
    expect(await db.outbox.get(pv.versionId)).toMatchObject({ bloque: false, tentatives: 1 });

    stubFetch({
      [`PUT /api/pv-versions/${pv.versionId}`]: () => json(200, statut(pv.versionId)),
      "GET /api/sync/reference": () => json(200, reference([])),
      [`GET /api/pv-versions/${pv.versionId}/status`]: () => json(200, statut(pv.versionId)),
    });
    expect((await engine().synchroniser()).envoyes).toBe(1);
    expect(await db.outbox.count()).toBe(0);
  });

  it("erreur serveur 500 : nouvel essai plus tard", async () => {
    const pv = await pvSigne();
    stubFetch({
      [`PUT /api/pv-versions/${pv.versionId}`]: () => apiErreur(500, "internal", "Erreur interne du serveur."),
    });
    const r = await engine().synchroniser();
    expect(r.envoyes).toBe(0);
    expect(await db.outbox.get(pv.versionId)).toMatchObject({
      bloque: false,
      derniereErreur: "Erreur interne du serveur.",
    });
  });
});

describe("SyncEngine — référentiel, saisie commencée, statuts, purge", () => {
  it("enregistre affaires et PV préparés, et la date de dernière synchro", async () => {
    await db.affaires.put({ ...LOCAL_AFFAIRE, id: "ancienne" });
    stubFetch({ "GET /api/sync/reference": () => json(200, reference()) });
    const r = await engine().synchroniser();
    expect(r.referenceOk).toBe(true);
    expect((await db.affaires.toArray()).map((a) => a.id)).toEqual([AFFAIRE.id]);
    expect(await db.pvs.count()).toBe(1);
    const meta = await lireMeta(db);
    expect(meta.derniereSynchro).toBe(NOW);
    expect(meta.decalageHorlogeMs).toBe(2000);
  });

  it("signale une seule fois les PV préparés dont la saisie a commencé", async () => {
    stubFetch({ "GET /api/sync/reference": () => json(200, reference()) });
    await engine().synchroniser();
    const [pv] = await db.pvs.toArray();
    await ouvrirPvPrepare(db, pv!.versionId, new Date(NOW));
    const calls = stubFetch({
      "POST /api/sync/started": () => json(204),
      "GET /api/sync/reference": () => json(200, reference()),
    });
    await engine().synchroniser();
    expect(calls.find((c) => c.path === "/api/sync/started")?.body).toEqual({ versionIds: [pv!.versionId] });
    expect((await db.pvs.get(pv!.versionId))?.saisieSignalee).toBe(true);
    const encore = stubFetch({ "GET /api/sync/reference": () => json(200, reference()) });
    await engine().synchroniser();
    expect(encore.some((c) => c.path === "/api/sync/started")).toBe(false);
  });

  it("suit le statut des PV reçus jusqu'au dépôt et ignore un PV inconnu du serveur", async () => {
    const pv = await pvSigne();
    await db.outbox.clear();
    await db.pvs.update(pv.versionId, { statut: "recu" });
    stubFetch({
      "GET /api/sync/reference": () => json(200, reference([])),
      [`GET /api/pv-versions/${pv.versionId}/status`]: () => json(200, statut(pv.versionId, "depose")),
    });
    await engine().synchroniser();
    expect(await db.pvs.get(pv.versionId)).toMatchObject({ statut: "depose", deposeLe: NOW });

    await db.pvs.update(pv.versionId, { statut: "recu" });
    stubFetch({
      "GET /api/sync/reference": () => json(200, reference([])),
      [`GET /api/pv-versions/${pv.versionId}/status`]: () => apiErreur(404, "not_found", "Inconnu."),
    });
    expect((await engine().synchroniser()).referenceOk).toBe(true);
  });

  it("purge les PV déposés anciens, même hors ligne", async () => {
    const pv = await pvSigne();
    await db.outbox.clear();
    await db.pvs.update(pv.versionId, { statut: "depose", deposeLe: "2026-09-01T00:00:00.000Z" });
    stubFetch({});
    await engine().synchroniser();
    expect(await db.pvs.get(pv.versionId)).toBeUndefined();
  });

  it("une seule synchronisation à la fois", async () => {
    let resoudre!: (r: Response) => void;
    const calls = stubFetch({ "GET /api/sync/reference": () => new Promise<Response>((r) => (resoudre = r)) });
    const e = engine();
    const p1 = e.synchroniser();
    const p2 = e.synchroniser();
    expect(p2).toBe(p1);
    expect(e.enCours).toBe(true);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    resoudre(json(200, reference([])));
    await p1;
    expect(e.enCours).toBe(false);
    expect(calls.filter((c) => c.path === "/api/sync/reference")).toHaveLength(1);
  });
});

describe("PV affecté à plusieurs techniciens : signé depuis une autre tablette", () => {
  const SIGNE_PAR_PAUL = { signeLe: "2026-11-19T14:40:00.000Z", signePar: "Paul Préparateur" };

  /** Un PV préparé reçu puis ouvert sur cette tablette (saisie commencée, déjà signalée). */
  async function brouillonPrepare(): Promise<LocalPv> {
    stubFetch({ "GET /api/sync/reference": () => json(200, reference()) });
    await engine().synchroniser();
    const [pv] = await db.pvs.toArray();
    await ouvrirPvPrepare(db, pv!.versionId, new Date(NOW));
    await enregistrerDonnees(
      db,
      pv!.versionId,
      { ...pv!.donnees, generalites: { ...pv!.donnees.generalites, lieu: "Ma saisie" } },
      {
        par: "Théo",
        le: NOW,
      },
    );
    await db.pvs.update(pv!.versionId, { saisieSignalee: true });
    return (await db.pvs.get(pv!.versionId))!;
  }

  it("brouillonsAVerifier : brouillons préparés absents du référentiel, pas encore clos", () => {
    const base = fusionnerReference([], [syncPv()], NOW).aAjouter[0]!;
    const brouillon = { ...base, versionId: "b", statut: "brouillon" as const };
    const clos = {
      ...base,
      versionId: "c",
      statut: "brouillon" as const,
      clotAilleurs: { statut: "recu" as const, signePar: "Paul", signeLe: NOW, constateLe: NOW },
    };
    const site = { ...base, versionId: "s", origine: "site" as const, statut: "brouillon" as const };
    const toujoursPrepare = { ...base, statut: "brouillon" as const };
    expect(
      brouillonsAVerifier([base, brouillon, clos, site, toujoursPrepare], [syncPv()]).map((p) => p.versionId),
    ).toEqual(["b"]);
  });

  it("purge la copie close après la durée de conservation, comptée depuis le constat", () => {
    const base = fusionnerReference([], [syncPv()], NOW).aAjouter[0]!;
    const clos = (versionId: string, constateLe: string) => ({
      ...base,
      versionId,
      statut: "brouillon" as const,
      clotAilleurs: { statut: "depose" as const, signePar: "Paul", signeLe: constateLe, constateLe },
    });
    expect(
      pvsAPurger(
        [clos("vieux", "2026-10-01T00:00:00.000Z"), clos("recent", "2026-11-18T00:00:00.000Z")],
        new Date(NOW),
        30,
      ),
    ).toEqual(["vieux"]);
  });

  it("clôt le brouillon signé ailleurs : message, lecture seule, signature impossible, saisie conservée", async () => {
    const pv = await brouillonPrepare();
    const calls = stubFetch({
      "GET /api/sync/reference": () => json(200, reference([])),
      [`GET /api/pv-versions/${pv.versionId}/status`]: () =>
        json(200, { ...statut(pv.versionId, "depose"), ...SIGNE_PAR_PAUL }),
    });
    const r = await engine().synchroniser();
    expect(r).toMatchObject({ referenceOk: true, closAilleurs: 1, refuses: 0 });
    expect(r.message).toBe(
      "1 PV en cours de saisie signé(s) depuis une autre tablette : ils ne sont plus modifiables.",
    );
    expect(calls.map((c) => `${c.method} ${c.path}`)).toContain(`GET /api/pv-versions/${pv.versionId}/status`);
    const clos = (await db.pvs.get(pv.versionId))!;
    expect(clos).toMatchObject({
      statut: "brouillon",
      clotAilleurs: { statut: "depose", ...SIGNE_PAR_PAUL, constateLe: NOW },
    });
    expect(clos.donnees.generalites.lieu).toBe("Ma saisie");
    const message = messageClotAilleurs(clos.clotAilleurs!);
    expect(message).toMatch(/^Ce PV a été signé par Paul Préparateur le 19\/11\/2026 15:40 depuis une autre tablette/);
    await expect(enregistrerDonnees(db, pv.versionId, clos.donnees, { par: "Théo", le: NOW })).rejects.toThrow(message);
    await expect(
      signerPv(
        db,
        pv.versionId,
        { donnees: completer(clos.donnees), signataire: { id: "u", nom: "Théo" } },
        new Date(NOW),
      ),
    ).rejects.toThrow(message);
    expect(await db.outbox.count()).toBe(0);

    // Déjà clos : plus de vérification aux synchros suivantes.
    const ensuite = stubFetch({ "GET /api/sync/reference": () => json(200, reference([])) });
    expect((await engine().synchroniser()).closAilleurs).toBe(0);
    expect(ensuite.some((c) => c.path.endsWith("/status"))).toBe(false);

    // Le technicien peut retirer la copie de la tablette.
    await retirerPvClotAilleurs(db, pv.versionId);
    expect(await db.pvs.get(pv.versionId)).toBeUndefined();
  });

  it("PV encore préparé (désaffecté) ou inaccessible : la saisie locale reste modifiable", async () => {
    const pv = await brouillonPrepare();
    stubFetch({
      "GET /api/sync/reference": () => json(200, reference([])),
      [`GET /api/pv-versions/${pv.versionId}/status`]: () => json(200, statut(pv.versionId, "prepare")),
    });
    expect((await engine().synchroniser()).closAilleurs).toBe(0);
    stubFetch({
      "GET /api/sync/reference": () => json(200, reference([])),
      [`GET /api/pv-versions/${pv.versionId}/status`]: () => apiErreur(403, "forbidden", "Accès refusé."),
    });
    const r = await engine().synchroniser();
    expect(r).toMatchObject({ referenceOk: true, closAilleurs: 0, message: null });
    expect((await db.pvs.get(pv.versionId))?.clotAilleurs ?? null).toBeNull();
    await expect(retirerPvClotAilleurs(db, pv.versionId)).rejects.toThrow(
      "Seul un PV signé depuis une autre tablette peut être retiré.",
    );
  });

  it("réseau coupé pendant la vérification : hors ligne, rien n'est clos", async () => {
    const pv = await brouillonPrepare();
    stubFetch({ "GET /api/sync/reference": () => json(200, reference([])) });
    const r = await engine().synchroniser();
    expect(r).toMatchObject({ horsLigne: true, closAilleurs: 0 });
    expect((await db.pvs.get(pv.versionId))?.clotAilleurs ?? null).toBeNull();
  });
});

describe("installerDeclencheurs (spec §6.3)", () => {
  it("synchronise à l'ouverture, au retour du réseau et périodiquement, jusqu'au nettoyage", () => {
    vi.useFakeTimers();
    try {
      const cible = { synchroniser: vi.fn(async () => undefined) };
      const win = new EventTarget() as unknown as Window;
      const stop = installerDeclencheurs(cible, { intervalleMs: 1000, win });
      expect(cible.synchroniser).toHaveBeenCalledTimes(1);
      win.dispatchEvent(new Event("online"));
      expect(cible.synchroniser).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(2500);
      expect(cible.synchroniser).toHaveBeenCalledTimes(4);
      stop();
      win.dispatchEvent(new Event("online"));
      vi.advanceTimersByTime(5000);
      expect(cible.synchroniser).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("une synchro en échec ne lève pas d'erreur non gérée", () => {
    const cible = { synchroniser: vi.fn(async () => Promise.reject(new Error("x"))) };
    const stop = installerDeclencheurs(cible, { win: new EventTarget() as unknown as Window });
    stop();
    expect(cible.synchroniser).toHaveBeenCalledOnce();
  });
});
