import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LOCAL_AFFAIRE } from "../test/fixtures";
import { creerBase, lireMeta, majMeta, metaEnLecture, type UserDb } from "./db";
import { useLive } from "./live";

let db: UserDb;
beforeEach(async () => {
  db = creerBase("test-live");
  await db.open();
});
afterEach(async () => {
  db.close();
  await db.delete();
});

function Compteur({ base }: { base: UserDb }) {
  const n = useLive(() => base.affaires.count(), [base]);
  return <p>{n === undefined ? "chargement" : `${n} affaire(s)`}</p>;
}

describe("useLive", () => {
  it("affiche le résultat de la requête puis suit les modifications de la base", async () => {
    render(<Compteur base={db} />);
    expect(await screen.findByText("0 affaire(s)")).toBeTruthy();
    await act(async () => {
      await db.affaires.put(LOCAL_AFFAIRE);
    });
    expect(await screen.findByText("1 affaire(s)")).toBeTruthy();
  });
});

function DerniereSynchro({ base }: { base: UserDb }) {
  const meta = useLive(() => metaEnLecture(base), [base]);
  return <p>{meta === undefined ? "chargement" : (meta?.derniereSynchro ?? "jamais")}</p>;
}

describe("metaEnLecture dans une requête live (« Prêt pour le hors ligne »)", () => {
  it("suit la date de dernière synchronisation, sans écrire dans la base", async () => {
    render(<DerniereSynchro base={db} />);
    expect(await screen.findByText("jamais")).toBeTruthy();
    await act(async () => {
      await lireMeta(db);
      await majMeta(db, { derniereSynchro: "2026-11-19T14:54:12.083Z" });
    });
    expect(await screen.findByText("2026-11-19T14:54:12.083Z")).toBeTruthy();
  });

  it("lireMeta, qui écrit, est refusé par Dexie dans une requête live (cause du bug corrigé)", async () => {
    const erreurs: unknown[] = [];
    const { liveQuery } = await import("dexie");
    const sub = liveQuery(() => lireMeta(db)).subscribe({ error: (e) => erreurs.push(e) });
    await new Promise((r) => setTimeout(r, 50));
    sub.unsubscribe();
    expect(String((erreurs[0] as Error | undefined)?.name)).toBe("ReadOnlyError");
  });
});
