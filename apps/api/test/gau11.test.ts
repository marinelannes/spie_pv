import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  IoImportAnalyseDto,
  IoImportResultDto,
  PrepAffaireDto,
  PvDetailDto,
  PvVersionStatusDto,
} from "@spie/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./helpers.js";
import { as, envoiDuPrepare, scenario, type Scenario } from "./lot1.js";

/**
 * Critère de fin du lot 1 (spec §11), côté API, sur le fichier fourni par SPIE : « La liste GAU11_AUT_009 est importée.
 * Un PV est préparé pour un relais, […] signé, puis déposé automatiquement ». Le fichier client n'est pas versionné :
 * il est lu à côté du dépôt (ou via SPIE_IO_FIXTURE) et le test est sauté s'il est absent.
 */
const FICHIER =
  process.env.SPIE_IO_FIXTURE ??
  fileURLToPath(new URL("../../../../GAU11_AUT_009_LISTE ENTREES SORTIES RPN_B.xlsx", import.meta.url));

describe.skipIf(!existsSync(FICHIER))("liste GAU11_AUT_009 réelle (affaire A35173)", () => {
  let t: TestApp;
  let s: Scenario;
  let contenuBase64: string;

  beforeAll(async () => {
    t = await createTestApp();
    s = await scenario(t, "A35173"); // numéro d'affaire du fichier réel
    contenuBase64 = (await readFile(FICHIER)).toString("base64");
  });
  afterAll(() => t.close());

  const prep = () => as(t, s.prepToken);
  const ASSOCIATIONS = [
    { tag: "RGU_HTB_TR", feuille: "HTB_RGU", filtreTag: null },
    { tag: "RPN_HTB_DIFF_TL", feuille: "HTB-TL", filtreTag: null },
    { tag: "RPN_HTB_DIFF_TR", feuille: "HTB_TR1", filtreTag: "PROTECTION TRANSFO DIF." },
    // Point ouvert n°10 : la feuille HTB_TR1 contient les E/S de la protection bobine point neutre.
    { tag: "RPN_HTB_MCN_TR", feuille: "HTB_TR1", filtreTag: "PROTECTION TRANSFO BOBINE POINT NEUTRE" },
  ];

  it("analyse : 12 équipements, 6 feuilles, associations automatiques pour les relais HTA", async () => {
    const a = (
      await prep().post(`/api/prep/affaires/${s.affaire.id}/io-lists/analyse`, { fichier: "GAU11.xlsx", contenuBase64 })
    ).json<IoImportAnalyseDto>();
    expect(a).toMatchObject({ reference: "GAU11_AUT_009", revision: "B", numeroAffaire: "A35173", bloquant: false });
    expect(a.equipements).toHaveLength(12);
    expect(a.feuilles.map((f) => [f.nom, f.nbPoints])).toEqual([
      ["TYPE ARRIVEE TR1", 33],
      ["TYPE BATTERIE", 33],
      ["TYPE TR AUX", 33],
      ["HTB-TL", 104],
      ["HTB_TR1", 128],
      ["HTB_RGU", 35],
    ]);
    const auto = a.equipements.filter((e) => e.association.mode === "auto").map((e) => e.tag);
    expect(auto).toHaveLength(8);
    expect(
      a.equipements
        .filter((e) => e.association.mode === "aucune")
        .map((e) => e.tag)
        .sort(),
    ).toEqual(["RGU_HTB_TR", "RPN_HTB_DIFF_TL", "RPN_HTB_DIFF_TR", "RPN_HTB_MCN_TR"].sort());
    expect(a.anomalies.some((x) => x.code === "libelle_equipement_en_double")).toBe(true);
  });

  it("import avec les associations du préparateur : tous les équipements ont leur feuille", async () => {
    const res = await prep().post(`/api/prep/affaires/${s.affaire.id}/io-lists`, {
      fichier: "GAU11_AUT_009_LISTE ENTREES SORTIES RPN_B.xlsx",
      contenuBase64,
      associations: ASSOCIATIONS,
    });
    expect(res.statusCode).toBe(201);
    const r = res.json<IoImportResultDto>();
    expect(r.liste).toMatchObject({ version: 1, nbFeuilles: 6, nbPoints: 366 });
    expect(r.equipementsCrees).toBe(12);
    const a = (await prep().get(`/api/prep/affaires/${s.affaire.id}`)).json<PrepAffaireDto>();
    const nb = Object.fromEntries(a.equipements.map((e) => [e.tag, e.nbPointsEs]));
    expect(nb).toMatchObject({
      RPN_HTA_F1: 33,
      RPN_HTA_AR_RTE: 33,
      RPN_HTA_TAUX_NORD: 33,
      RPN_HTB_DIFF_TL: 104,
      RPN_HTB_DIFF_TR: 101,
      RPN_HTB_MCN_TR: 27,
      RGU_HTB_TR: 35,
    });
    expect(a.equipements.every((e) => e.feuilleEsId !== null)).toBe(true);
  });

  it("PV préparé pour RPN_HTA_F1, dupliqué vers les 4 autres départs batterie, signé puis déposé", async () => {
    const a = (await prep().get(`/api/prep/affaires/${s.affaire.id}`)).json<PrepAffaireDto>();
    const id = (tag: string) => a.equipements.find((e) => e.tag === tag)!.id;
    const pv = (
      await prep().post("/api/prep/pv", { affaireId: s.affaire.id, equipementId: id("RPN_HTA_F1") })
    ).json<PvDetailDto>();
    expect(pv.donnees.es.points).toHaveLength(33);
    expect(pv.donnees.es.points.filter((p) => p.teste === "NA")).toHaveLength(2); // E/S de réserve cochées NA
    await prep().put(`/api/prep/pv/${pv.pvId}/affectations`, { userIds: [s.techId] });
    const dup = await prep().post(`/api/prep/pv/${pv.pvId}/duplicate`, {
      equipementIds: ["RPN_HTA_F2", "RPN_HTA_F3", "RPN_HTA_F4", "RPN_HTA_F5"].map(id),
    });
    expect(dup.json<unknown[]>()).toHaveLength(4);

    const res = await as(t, s.techToken).put(
      `/api/pv-versions/${pv.versionId}`,
      await envoiDuPrepare(pv, "Théo Technicien"),
    );
    expect(res.statusCode).toBe(201);
    expect(await t.traitement.traiterEchus()).toBe(3);
    const st = (await as(t, s.techToken).get(`/api/pv-versions/${pv.versionId}/status`)).json<PvVersionStatusDto>();
    expect(st.statut).toBe("depose");
    const dossier = join(t.dir, "sharepoint", "Documents partagés", "Affaires", "A00001 - Stockage batteries DEMO1");
    expect(existsSync(join(dossier, `PV_MES_RPN_HTA_F1_${pv.numero}_indA.pdf`))).toBe(true);
    expect(existsSync(join(dossier, `PV_MES_RPN_HTA_F1_${pv.numero}_indA.xlsx`))).toBe(true);
  });
});
