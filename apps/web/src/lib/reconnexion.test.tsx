import type { AuthUser } from "@spie/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setSession } from "./api";
import { AuthProvider, installerReconnexionAuto, useAuth } from "./auth";
import { saveLastUser } from "./last-user";

const USER: AuthUser = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "t@spie.test",
  nom: "Théo",
  role: "technicien",
  mustChangePassword: false,
};

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setSession(null);
});

describe("installerReconnexionAuto (retour du réseau, spec §3.3)", () => {
  it("retente au retour du réseau et périodiquement, sans appels concurrents, et se désinstalle", async () => {
    vi.useFakeTimers();
    const win = new EventTarget();
    let fin: () => void = () => undefined;
    const retenter = vi.fn(() => new Promise<void>((r) => (fin = r)));
    const desinstaller = installerReconnexionAuto(retenter, { intervalleMs: 1000, win: win as unknown as Window });

    win.dispatchEvent(new Event("online"));
    expect(retenter).toHaveBeenCalledTimes(1);
    win.dispatchEvent(new Event("online")); // tentative encore en cours : pas de second appel
    expect(retenter).toHaveBeenCalledTimes(1);
    fin();
    await vi.advanceTimersByTimeAsync(1000);
    expect(retenter).toHaveBeenCalledTimes(2);
    fin();

    desinstaller();
    await vi.advanceTimersByTimeAsync(5000);
    win.dispatchEvent(new Event("online"));
    expect(retenter).toHaveBeenCalledTimes(2);
  });

  it("une tentative en échec n'interrompt pas les suivantes", async () => {
    vi.useFakeTimers();
    const win = new EventTarget();
    const retenter = vi.fn(async () => {
      throw new Error("réseau");
    });
    const desinstaller = installerReconnexionAuto(retenter, { intervalleMs: 1000, win: win as unknown as Window });
    await vi.advanceTimersByTimeAsync(3000);
    expect(retenter).toHaveBeenCalledTimes(3);
    desinstaller();
  });
});

function Etat() {
  const { state } = useAuth();
  return <p>{`${state.status}${state.user ? ` ${state.user.nom}` : ""}`}</p>;
}

describe("AuthProvider : de « hors ligne » à « connecté » sans intervention", () => {
  it("démarre hors ligne avec le dernier utilisateur, puis rétablit la session au retour du réseau", async () => {
    saveLastUser(USER);
    let serveurJoignable = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (!serveurJoignable) throw new TypeError("Failed to fetch");
        return new Response(JSON.stringify({ accessToken: "jeton", expiresIn: 900, user: USER }), { status: 200 });
      }),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <Etat />
        </AuthProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("offline Théo")).toBeTruthy();

    serveurJoignable = true;
    // Un signal « online » reçu pendant qu'une tentative est encore en cours est ignoré (la suivante est périodique) :
    // on le répète jusqu'au rétablissement, au lieu de compter sur un seul envoi au bon moment.
    await waitFor(() => {
      window.dispatchEvent(new Event("online"));
      expect(screen.getByText("authenticated Théo")).toBeTruthy();
    });
  });

  it("session expirée au retour du réseau : retour à la connexion (les données locales restent)", async () => {
    saveLastUser(USER);
    let serveurJoignable = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (!serveurJoignable) throw new TypeError("Failed to fetch");
        return new Response(JSON.stringify({ error: { code: "unauthorized", message: "Session expirée." } }), {
          status: 401,
        });
      }),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <Etat />
        </AuthProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("offline Théo")).toBeTruthy();
    serveurJoignable = true;
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(await screen.findByText("anonymous")).toBeTruthy();
  });
});
