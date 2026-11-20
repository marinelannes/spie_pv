import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { creerEnregistreurDiffere, flushALaFermeture } from "./autosave";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("creerEnregistreurDiffere (spec §6.1)", () => {
  it("regroupe les frappes et n'enregistre que la dernière valeur après le délai", async () => {
    const save = vi.fn(async (_v: number) => undefined);
    const e = creerEnregistreurDiffere(save, 250);
    e.planifier(1);
    e.planifier(2);
    expect(e.enAttente).toBe(true);
    await vi.advanceTimersByTimeAsync(249);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledExactlyOnceWith(2);
    expect(e.enAttente).toBe(false);
  });

  it("flush écrit immédiatement, puis plus rien n'est en attente", async () => {
    const save = vi.fn(async (_v: string) => undefined);
    const e = creerEnregistreurDiffere(save, 250);
    e.planifier("a");
    await e.flush();
    expect(save).toHaveBeenCalledExactlyOnceWith("a");
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledOnce();
    await e.flush(); // rien à écrire
    expect(save).toHaveBeenCalledOnce();
  });

  it("enchaîne les écritures dans l'ordre et signale les erreurs sans bloquer les suivantes", async () => {
    const ordre: string[] = [];
    const onErreur = vi.fn();
    const save = vi.fn(async (v: string) => {
      if (v === "x") throw new Error("disque plein");
      ordre.push(v);
    });
    const e = creerEnregistreurDiffere(save, 10, onErreur);
    e.planifier("x");
    const f1 = e.flush();
    e.planifier("y");
    await Promise.all([f1, e.flush()]);
    expect(ordre).toEqual(["y"]);
    expect(onErreur).toHaveBeenCalledOnce();
  });
});

describe("flushALaFermeture", () => {
  it("écrit sur pagehide et quand la page passe en arrière-plan, jusqu'à la désinscription", () => {
    const flush = vi.fn();
    const stop = flushALaFermeture(flush);
    window.dispatchEvent(new Event("pagehide"));
    expect(flush).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(flush).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(flush).toHaveBeenCalledTimes(2);
    stop();
    window.dispatchEvent(new Event("pagehide"));
    expect(flush).toHaveBeenCalledTimes(2);
  });
});
