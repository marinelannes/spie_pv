import { describe, expect, it } from "vitest";
import {
  changePasswordRequestSchema,
  createAffaireRequestSchema,
  numeroAffaireSchema,
  parisDateTimeParts,
  passwordSchema,
  sanitizeSharePointFileName,
} from "./index.js";

describe("parisDateTimeParts", () => {
  it("utilise l'heure de Paris (hiver, UTC+1)", () => {
    expect(parisDateTimeParts(new Date("2026-11-19T13:32:05Z"))).toEqual({ date: "20261119", time: "143205" });
  });

  it("utilise l'heure de Paris (été, UTC+2) et change de jour", () => {
    expect(parisDateTimeParts(new Date("2026-07-01T22:30:00Z"))).toEqual({ date: "20260702", time: "003000" });
  });
});

describe("passwordSchema", () => {
  it("exige 12 caractères minimum", () => {
    expect(passwordSchema.safeParse("court").success).toBe(false);
    expect(passwordSchema.safeParse("a".repeat(11)).success).toBe(false);
    expect(passwordSchema.safeParse("a".repeat(12)).success).toBe(true);
  });

  it("refuse les espaces en début ou fin", () => {
    expect(passwordSchema.safeParse(" motdepasse-long").success).toBe(false);
  });
});

describe("changePasswordRequestSchema", () => {
  it("refuse un nouveau mot de passe identique à l'actuel", () => {
    const r = changePasswordRequestSchema.safeParse({
      currentPassword: "identique-123456",
      newPassword: "identique-123456",
    });
    expect(r.success).toBe(false);
  });
});

describe("numeroAffaireSchema", () => {
  it("normalise en majuscules", () => {
    expect(numeroAffaireSchema.parse(" a35173 ")).toBe("A35173");
  });

  it("refuse les caractères non autorisés dans un nom de fichier", () => {
    expect(numeroAffaireSchema.safeParse("A35/173").success).toBe(false);
    expect(numeroAffaireSchema.safeParse("A 35173").success).toBe(false);
  });
});

describe("createAffaireRequestSchema", () => {
  it("applique les valeurs par défaut", () => {
    const a = createAffaireRequestSchema.parse({
      numero: "A35173",
      client: "RTE",
      projet: "Stockage batteries – GAU11",
    });
    expect(a).toMatchObject({ site: "", valideParDefaut: "", approuveParDefaut: "", dossierSharePoint: null });
  });
});

describe("sanitizeSharePointFileName", () => {
  it("remplace les caractères interdits par SharePoint", () => {
    expect(sanitizeSharePointFileName('PV_MES_a"b*c:d<e>f?g/h\\i|j.pdf')).toBe("PV_MES_a_b_c_d_e_f_g_h_i_j.pdf");
  });

  it("supprime les points et espaces finaux", () => {
    expect(sanitizeSharePointFileName("test. . ")).toBe("test");
    expect(sanitizeSharePointFileName("...")).toBe("_");
  });
});
