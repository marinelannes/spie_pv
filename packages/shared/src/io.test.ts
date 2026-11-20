import { describe, expect, it } from "vitest";
import {
  estCommentaireReserve,
  normaliserAdresse,
  normaliserTexte,
  normaliserTypeEs,
  pointsPourEquipement,
} from "./index.js";

describe("normaliserTexte", () => {
  it("retire accents, espaces multiples et met en majuscules", () => {
    expect(normaliserTexte("  Entrée   analogique ")).toBe("ENTREE ANALOGIQUE");
    expect(normaliserTexte("Réserve\tcâblée")).toBe("RESERVE CABLEE");
  });
});

describe("normaliserTypeEs (spec §4.4)", () => {
  it.each([
    ["ENTREE TOR", "entree_tor"],
    ["E TOR", "entree_tor"],
    ["Entrée TOR", "entree_tor"],
    ["SORTIE TOR", "sortie_tor"],
    ["S TOR", "sortie_tor"],
    ["s  tor", "sortie_tor"],
    ["ENTREE ANALOGIQUE", "entree_analogique"],
    ["E ANA", "entree_analogique"],
  ])("« %s » → %s", (brut, attendu) => {
    expect(normaliserTypeEs(brut)).toBe(attendu);
  });

  it("renvoie null pour un type inconnu ou vide", () => {
    expect(normaliserTypeEs("S ANA")).toBeNull();
    expect(normaliserTypeEs("PROTECTION LIGNE")).toBeNull();
    expect(normaliserTypeEs("")).toBeNull();
    expect(normaliserTypeEs(null)).toBeNull();
    expect(normaliserTypeEs(undefined)).toBeNull();
  });
});

describe("estCommentaireReserve", () => {
  it("reconnaît RESERVE et RESERVE CABLEE, quelle que soit la casse ou l'accentuation", () => {
    expect(estCommentaireReserve("RESERVE")).toBe(true);
    expect(estCommentaireReserve("RESERVE CABLEE")).toBe(true);
    expect(estCommentaireReserve(" Réserve  câblée ")).toBe(true);
  });

  it("ne confond pas un libellé qui contient le mot réserve", () => {
    expect(estCommentaireReserve("DEFAUT RESERVE HUILE")).toBe(false);
    expect(estCommentaireReserve("RESERVES")).toBe(false);
    expect(estCommentaireReserve("")).toBe(false);
    expect(estCommentaireReserve(null)).toBe(false);
  });
});

describe("normaliserAdresse", () => {
  it("rend comparables des adresses saisies différemment", () => {
    expect(normaliserAdresse("Q  01")).toBe(normaliserAdresse("q 01"));
    expect(normaliserAdresse("BI 1.01")).not.toBe(normaliserAdresse("BI 1.1"));
  });
});

describe("pointsPourEquipement", () => {
  const points = [
    { tag: "PROTECTION TRANSFO DIF.", id: 1 },
    { tag: "PROTECTION TRANSFO BOBINE POINT NEUTRE", id: 2 },
  ];
  it("garde tout sans filtre", () => {
    expect(pointsPourEquipement(points, null)).toHaveLength(2);
  });
  it("ne garde que le groupe TAG demandé", () => {
    expect(pointsPourEquipement(points, "PROTECTION TRANSFO BOBINE POINT NEUTRE").map((p) => p.id)).toEqual([2]);
  });
});
