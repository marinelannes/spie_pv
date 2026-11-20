import type { AuthUser } from "@spie/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, apiFetch, setSession } from "./api";
import { offlineState } from "./auth";
import { fileNameFromDisposition, fileToBase64 } from "./files";
import { formatDateIso, formatOctets, isoDateParis } from "./format";
import { clearLastUser, loadLastUser, saveLastUser } from "./last-user";

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
});

describe("dernier utilisateur (hors ligne, spec §7.2)", () => {
  it("enregistre, relit et efface", () => {
    expect(loadLastUser()).toBeNull();
    saveLastUser(USER);
    expect(loadLastUser()).toEqual(USER);
    clearLastUser();
    expect(loadLastUser()).toBeNull();
  });

  it("ignore une valeur corrompue", () => {
    localStorage.setItem("spie-pv:dernier-utilisateur", "{pas du json");
    expect(loadLastUser()).toBeNull();
    localStorage.setItem("spie-pv:dernier-utilisateur", JSON.stringify({ id: "x" }));
    expect(loadLastUser()).toBeNull();
  });

  it("offlineState : mode hors ligne avec le dernier utilisateur, sauf mot de passe provisoire", () => {
    expect(offlineState()).toEqual({ status: "offline", user: null });
    saveLastUser(USER);
    expect(offlineState()).toEqual({ status: "offline", user: USER });
    saveLastUser({ ...USER, mustChangePassword: true });
    expect(offlineState()).toEqual({ status: "offline", user: null });
  });
});

describe("fichiers", () => {
  it("fileToBase64 encode le contenu sans le préfixe data URL", async () => {
    const b64 = await fileToBase64(new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff])]));
    expect(b64).toBe("UEsDBP8=");
  });

  it("fileNameFromDisposition préfère filename* et retombe sur filename ou la valeur par défaut", () => {
    const star = "attachment; filename=\"a.pdf\"; filename*=UTF-8''PV%20%C3%A9t%C3%A9.pdf";
    expect(fileNameFromDisposition(star, "x")).toBe("PV été.pdf");
    expect(fileNameFromDisposition('attachment; filename="PV_MES_A.pdf"', "x")).toBe("PV_MES_A.pdf");
    expect(fileNameFromDisposition(null, "defaut.pdf")).toBe("defaut.pdf");
    expect(fileNameFromDisposition("attachment", "defaut.pdf")).toBe("defaut.pdf");
  });
});

describe("format", () => {
  it("isoDateParis utilise le jour de Paris", () => {
    expect(isoDateParis(new Date("2026-07-01T22:30:00Z"))).toBe("2026-07-02");
    expect(isoDateParis(new Date("2026-11-19T13:32:05Z"))).toBe("2026-11-19");
  });
  it("formatDateIso", () => {
    expect(formatDateIso("2026-11-19")).toBe("19/11/2026");
    expect(formatDateIso("")).toBe("");
  });
  it("formatOctets", () => {
    expect(formatOctets(512)).toBe("512 o");
    expect(formatOctets(1536)).toBe("1,5 Ko");
    expect(formatOctets(3 * 1024 * 1024)).toBe("3 Mo");
    expect(formatOctets(null)).toBe("—");
  });
});

describe("api / apiFetch", () => {
  it("ajoute le jeton, rafraîchit la session sur 401 et rejoue la requête", async () => {
    setSession({ accessToken: "ancien", expiresIn: 900, user: USER });
    const vus: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? "";
        vus.push(`${init?.method} ${String(input)} ${auth}`.trim());
        if (String(input) === "/api/auth/refresh") {
          return new Response(JSON.stringify({ accessToken: "neuf", expiresIn: 900, user: USER }), { status: 200 });
        }
        return auth === "Bearer neuf"
          ? new Response(JSON.stringify({ ok: 1 }), { status: 200 })
          : new Response("", { status: 401 });
      }),
    );
    expect(await api<{ ok: number }>("/api/x")).toEqual({ ok: 1 });
    expect(vus).toEqual(["GET /api/x Bearer ancien", "POST /api/auth/refresh", "GET /api/x Bearer neuf"]);
  });

  it("réseau absent : ApiError « network »", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))),
    );
    const err = await apiFetch("/api/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("network");
  });

  it("renvoie l'erreur structurée de l'API", async () => {
    setSession({ accessToken: "t", expiresIn: 900, user: USER });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: "conflict", message: "Déjà reçu." } }), { status: 409 }),
      ),
    );
    await expect(api("/api/x")).rejects.toMatchObject({ status: 409, code: "conflict", message: "Déjà reçu." });
  });
});
