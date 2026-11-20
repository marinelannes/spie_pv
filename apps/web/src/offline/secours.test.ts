import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LOCAL_AFFAIRE, EQ_DIFF } from "../test/fixtures";
import { creerEnregistreurDiffere } from "./autosave";
import { creerBase, type LocalPv, type UserDb } from "./db";
import { creerPvSurSite, enregistrerDonnees } from "./pv-local";
import { ecrireSecours, restaurerSecours, secoursALaFermeture } from "./secours";

const USER = "00000000-0000-4000-8000-000000000001";
const TRACE = { par: "Camille", le: "2026-11-20T10:00:00.000Z" };

let db: UserDb;
let pv: LocalPv;
let n = 0;
beforeEach(async () => {
  db = creerBase(`test-secours-${++n}`);
  await db.open();
  pv = await creerPvSurSite(db, { affaire: LOCAL_AFFAIRE, equipementId: EQ_DIFF.id, auteur: "Camille" });
  // Dernier enregistrement normal du PV : 10 h 00.
  pv = await enregistrerDonnees(db, pv.versionId, pv.donnees, TRACE);
});
afterEach(async () => {
  localStorage.clear();
  db.close();
  await db.delete();
});

/** Les données du PV avec un autre lieu des tests. */
const avecLieu = (lieu: string) => ({ ...pv.donnees, generalites: { ...pv.donnees.generalites, lieu } });
const lieuEnregistre = async () => (await db.pvs.get(pv.versionId))?.donnees.generalites.lieu;

describe("copie de secours de la saisie (fermeture brutale de la page)", () => {
  it("une saisie plus récente que le PV enregistré est reprise à la réouverture, une seule fois", async () => {
    ecrireSecours(USER, pv.versionId, avecLieu("Saisi juste avant la fermeture"), new Date("2026-11-20T10:00:05Z"));

    expect(await restaurerSecours(db, USER, pv.versionId, "Camille")).toBe(true);
    expect(await lieuEnregistre()).toBe("Saisi juste avant la fermeture");
    // La copie est effacée : rien à reprendre la fois suivante.
    expect(await restaurerSecours(db, USER, pv.versionId, "Camille")).toBe(false);
  });

  it("une copie plus ancienne que le PV enregistré est ignorée (elle n'écrase pas une saisie plus récente)", async () => {
    ecrireSecours(USER, pv.versionId, avecLieu("Vieille copie"), new Date("2026-11-20T09:59:00Z"));

    expect(await restaurerSecours(db, USER, pv.versionId, "Camille")).toBe(false);
    expect(await lieuEnregistre()).toBe(pv.donnees.generalites.lieu);
  });

  it("la copie d'un autre utilisateur n'est pas reprise", async () => {
    ecrireSecours("autre-utilisateur", pv.versionId, avecLieu("Pas pour moi"), new Date("2026-11-20T10:00:05Z"));
    expect(await restaurerSecours(db, USER, pv.versionId, "Camille")).toBe(false);
  });

  it("sans copie, ou avec une copie illisible, rien ne change", async () => {
    expect(await restaurerSecours(db, USER, pv.versionId, "Camille")).toBe(false);
    localStorage.setItem(`spie-pv:secours:${USER}:${pv.versionId}`, "{ceci n'est pas du JSON");
    expect(await restaurerSecours(db, USER, pv.versionId, "Camille")).toBe(false);
    expect(await lieuEnregistre()).toBe(pv.donnees.generalites.lieu);
  });

  it("à la fermeture, seule une saisie pas encore enregistrée est copiée", async () => {
    // Un enregistrement lent, que le test termine quand il le décide.
    let enregistrer: () => void = () => undefined;
    const ecritureLente = new Promise<void>((fin) => (enregistrer = fin));
    const enregistreur = creerEnregistreurDiffere<LocalPv["donnees"]>(() => ecritureLente);
    const fenetre = new EventTarget() as unknown as Window;
    secoursALaFermeture(USER, pv.versionId, () => enregistreur.nonEnregistree, fenetre);
    const cle = `spie-pv:secours:${USER}:${pv.versionId}`;

    // Rien de saisi : rien à copier.
    fenetre.dispatchEvent(new Event("pagehide"));
    expect(localStorage.getItem(cle)).toBeNull();

    // Saisie en cours d'écriture au moment de la fermeture : copiée.
    enregistreur.planifier(avecLieu("En cours d'écriture"));
    const ecriture = enregistreur.flush();
    fenetre.dispatchEvent(new Event("pagehide"));
    expect(localStorage.getItem(cle)).toContain("En cours d'écriture");

    // Une fois l'écriture terminée, plus rien n'est « non enregistré ».
    enregistrer();
    await ecriture;
    expect(enregistreur.nonEnregistree).toBeUndefined();
  });
});
