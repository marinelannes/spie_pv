import { creerPvRelais, saisirResultatEs, type PointEsSource, type PvDocument } from "@spie/shared";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  COLONNES_EXPORT,
  FOND_NC,
  exporterResultatsEs,
  formaterDateHeureParis,
  nomFeuilleExcel,
} from "../src/index.js";

const POINTS: PointEsSource[] = [
  {
    id: "p1",
    carte: "RPN_HTA / PS050_1",
    tag: "-",
    adresse: "BI 1.01",
    type: "entree_tor",
    designation: "SURVEILLANCE CIRCUIT DECLENCHEMENT",
    reserve: false,
  },
  {
    id: "p2",
    carte: "RPN_HTA / IO60_1",
    tag: "-",
    adresse: "BI 2.11",
    type: "entree_tor",
    designation: "RESERVE",
    reserve: true,
  },
  {
    id: "p3",
    carte: "RPN_HTA / PS050_1",
    tag: "-",
    adresse: "BO 1.01",
    type: "sortie_tor",
    designation: "DÉCLENCHEMENT DISJ. MBO1",
    reserve: false,
  },
  {
    id: "p4",
    carte: "RPN_HTA / PS050_1",
    tag: "-",
    adresse: "I1",
    type: "entree_analogique",
    designation: "COURANT PHASE 1",
    reserve: false,
  },
];

function documentPv(opts: { feuille?: string; filtreTag?: string | null; equipement?: boolean } = {}): PvDocument {
  const donnees = creerPvRelais({
    affaire: { numero: "A00001", client: "CLIENT DEMO", projet: "DEMO1", valideParDefaut: "", approuveParDefaut: "" },
    es: {
      listeId: "8a5b1c2d-0000-4000-8000-000000000001",
      listeVersion: 2,
      referenceDocument: "DEMO1_AUT_009",
      revision: "B",
      feuille: opts.feuille ?? "TYPE BATTERIE",
      filtreTag: opts.filtreTag ?? null,
      points: POINTS,
    },
    date: "2026-11-19",
  });
  const [p1, p2, p3, p4] = donnees.es.points;
  donnees.es.points = [
    saisirResultatEs(
      p1!,
      { teste: "C", leds: "OK", relais: "OK", scada: "C", message: "SURV. CIRCUIT DECL.", commentaire: "" },
      { par: "Théo Technicien", le: "2026-11-19T13:32:05.000Z" },
    ),
    p2!,
    saisirResultatEs(
      p3!,
      { teste: "NC", leds: "NOK", relais: "OK", scada: "NC", commentaire: "Pas de remontée" },
      { par: "Théo Technicien", le: "2026-07-01T22:30:00.000Z" },
    ),
    p4!,
  ];
  return {
    format: "spie-pv/1",
    pv: { id: "pv-1", numero: "A00001-20261119-143205", modele: "relais", modeleVersion: "1.0.0", famille: "MES" },
    version: {
      id: "v-1",
      indice: "A",
      statutDocument: "CMS",
      signeLe: "2026-11-19T15:00:00.000Z",
      empreinte: "a".repeat(64),
    },
    affaire: { numero: "A00001", client: "CLIENT DEMO", projet: "DEMO1", site: "" },
    equipement:
      opts.equipement === false
        ? null
        : {
            tag: "RPN_HTA_F1",
            libelle: "RELAIS DE PROTECTION NUMERIQUE DEPART F1",
            typeCellule: "TYPE BATTERIE",
            modele: "",
            local: "",
            tagArmoire: "",
          },
    listeEs: { id: "8a5b1c2d-0000-4000-8000-000000000001", reference: "DEMO1_AUT_009", revision: "B", version: 2 },
    meta: {
      creeLe: "2026-11-19T13:32:05.000Z",
      tabletteId: "t1",
      signePar: null,
      recuLe: null,
      genereLe: "2026-11-19T15:01:00.000Z",
    },
    donnees,
    donneesPreparees: null,
    modifications: [],
  };
}

async function relire(bytes: Uint8Array) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as never);
  return wb;
}

describe("formaterDateHeureParis", () => {
  it("heure de Paris, hiver et été", () => {
    expect(formaterDateHeureParis("2026-11-19T13:32:05.000Z")).toBe("19/11/2026 14:32:05");
    expect(formaterDateHeureParis("2026-07-01T22:30:00.000Z")).toBe("02/07/2026 00:30:00");
    expect(formaterDateHeureParis("pas une date")).toBe("");
  });
});

describe("nomFeuilleExcel", () => {
  it("remplace les caractères interdits, tronque à 31 caractères, nom par défaut", () => {
    expect(nomFeuilleExcel("HTB/TR1:[x]*?\\")).toBe("HTB-TR1--x----");
    expect(nomFeuilleExcel("'TYPE BATTERIE'")).toBe("TYPE BATTERIE");
    expect(nomFeuilleExcel("A".repeat(40))).toHaveLength(31);
    expect(nomFeuilleExcel("")).toBe("E-S");
    expect(nomFeuilleExcel("  ")).toBe("E-S");
  });
});

describe("exporterResultatsEs", () => {
  it("produit la feuille d'E/S de l'équipement complétée des colonnes de résultats", async () => {
    const wb = await relire(await exporterResultatsEs(documentPv()));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["TYPE BATTERIE"]);
    const ws = wb.worksheets[0]!;
    expect(ws.getCell("A1").value).toBe("LISTE DES ENTRÉES / SORTIES — RÉSULTATS DES ESSAIS — TYPE BATTERIE");
    expect(ws.getCell("A2").value).toBe("N° Document : DEMO1_AUT_009");
    expect(ws.getCell("A3").value).toBe("N° AFF : A00001");
    expect(ws.getCell("A4").value).toBe("Liste E/S : révision B (version 2)");
    expect(ws.getCell("A5").value).toBe(
      "PV n° A00001-20261119-143205 — indice A — équipement RPN_HTA_F1 (RELAIS DE PROTECTION NUMERIQUE DEPART F1)",
    );
    expect(ws.getRow(6).values).toEqual([undefined, ...COLONNES_EXPORT.map((c) => c.titre)]);
    const ligne = (r: number) => (ws.getRow(r).values as unknown[]).slice(1);
    expect(ligne(7)).toEqual([
      "RPN_HTA / PS050_1",
      "-",
      "Entrée TOR",
      "SURVEILLANCE CIRCUIT DECLENCHEMENT",
      "BI 1.01",
      "",
      "C",
      "OK",
      "OK",
      "C",
      "SURV. CIRCUIT DECL.",
      "",
      "Théo Technicien",
      "19/11/2026 14:32:05",
    ]);
    // Réserve pré-cochée NA, non saisie.
    expect(ligne(8)).toEqual([
      "RPN_HTA / IO60_1",
      "-",
      "Entrée TOR",
      "RESERVE",
      "BI 2.11",
      "Oui",
      "NA",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ]);
    expect(ligne(9).slice(6)).toEqual([
      "NC",
      "NOK",
      "OK",
      "NC",
      "",
      "Pas de remontée",
      "Théo Technicien",
      "02/07/2026 00:30:00",
    ]);
    expect(ligne(10).slice(2, 7)).toEqual(["Entrée analogique", "COURANT PHASE 1", "I1", "", ""]);
    expect(ws.getRow(11).values).toEqual([]);
  });

  it("met les NC et NOK sur fond rouge clair, pas les autres cellules", async () => {
    const ws = (await relire(await exporterResultatsEs(documentPv()))).worksheets[0]!;
    const fond = (ref: string) => {
      const f = ws.getCell(ref).fill;
      return f && f.type === "pattern" ? f.fgColor?.argb : undefined;
    };
    expect(fond("G9")).toBe(FOND_NC); // testé NC
    expect(fond("H9")).toBe(FOND_NC); // LED NOK
    expect(fond("J9")).toBe(FOND_NC); // SCADA NC
    expect(fond("I9")).toBeUndefined(); // relais OK
    expect(fond("G7")).toBeUndefined();
    expect(ws.getCell("G9").font?.bold).toBe(true);
  });

  it("en-têtes en gras avec bordures, volet figé sous l'en-tête, filtre automatique, largeurs", async () => {
    const ws = (await relire(await exporterResultatsEs(documentPv()))).worksheets[0]!;
    expect(ws.getCell("A6").font?.bold).toBe(true);
    expect(ws.getCell("N6").border?.bottom?.style).toBe("thin");
    expect(ws.getCell("D9").border?.left?.style).toBe("thin");
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 6 });
    expect(ws.autoFilter).toBe("A6:N10");
    expect(ws.getColumn(4).width).toBe(48);
  });

  it("précise le filtre TAG ; sans équipement ni feuille : nom de feuille par défaut", async () => {
    const ws = (
      await relire(
        await exporterResultatsEs(documentPv({ feuille: "", filtreTag: "PROTECTION TRANSFO DIF.", equipement: false })),
      )
    ).worksheets[0]!;
    expect(ws.name).toBe("E-S");
    expect(ws.getCell("A1").value).toBe("LISTE DES ENTRÉES / SORTIES — RÉSULTATS DES ESSAIS");
    expect(ws.getCell("A4").value).toBe("Liste E/S : révision B (version 2) — partie « PROTECTION TRANSFO DIF. »");
    expect(ws.getCell("A5").value).toBe("PV n° A00001-20261119-143205 — indice A");
  });

  it("PV sans E/S : classeur valide avec la seule ligne d'en-tête", async () => {
    const doc = documentPv();
    doc.donnees.es.points = [];
    const ws = (await relire(await exporterResultatsEs(doc))).worksheets[0]!;
    expect(ws.getCell("A6").value).toBe("CARTES");
    expect(ws.getRow(7).values).toEqual([]);
    expect(ws.autoFilter).toBe("A6:N6");
  });

  it("date de création du classeur = date de génération du document", async () => {
    const wb = await relire(await exporterResultatsEs(documentPv()));
    expect(wb.created?.toISOString()).toBe("2026-11-19T15:01:00.000Z");
  });
});
