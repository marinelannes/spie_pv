import { describe, expect, it, vi } from "vitest";
import {
  DELAIS_REPRISE_MS,
  ajouterObservation,
  attribuerNumeroPv,
  avancementEs,
  canonicalJson,
  controlesAvantSignature,
  controlesSignature,
  creerPvRelais,
  delaiAvantNumero,
  delaiReprise,
  elementsJuges,
  empreintePv,
  filtrerEs,
  grouperParCarte,
  jugementEs,
  majJournalModifications,
  nomFichierPv,
  nouvelleFonction,
  numeroPv,
  parseNumeroPv,
  pointsEsDepuisListe,
  pvRelaisDataSchema,
  recapReserves,
  saisirResultatEs,
  segmentsChemin,
  cheminRelatifSchema,
  sha256Hex,
  transformerEnReserve,
  supprimerObservation,
  supprimerReserve,
  reserveSupprimable,
  transitionPvPermise,
  uploadPvVersionRequestSchema,
  valeursPrepareesModifiees,
  versionFigee,
  type ContexteCreationPv,
  type PointEsSource,
  type PvRelaisData,
} from "./index.js";

const SOURCE: PointEsSource[] = [
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
];

const CTX: ContexteCreationPv = {
  affaire: {
    numero: "A00001",
    client: "CLIENT DEMO",
    projet: "Stockage batteries – DEMO1",
    valideParDefaut: "V. VALIDEUR",
    approuveParDefaut: "A. APPROBATEUR",
  },
  es: {
    listeId: "8a5b1c2d-0000-4000-8000-000000000001",
    listeVersion: 1,
    referenceDocument: "DEMO1_AUT_009",
    revision: "B",
    feuille: "TYPE BATTERIE",
    filtreTag: null,
    points: SOURCE,
  },
  date: "2026-11-19",
  modeleRelais: "COMPACT - 7SX8000",
};

let seq = 0;
const ids = () => `id-${++seq}`;

/** PV complètement renseigné, prêt à signer. */
function pvComplet(): PvRelaisData {
  const d = creerPvRelais(CTX);
  const j = <T extends { jugement: unknown }>(x: T) => ({ ...x, jugement: "C" as const });
  return {
    ...d,
    generalites: { ...d.generalites, lieu: "Poste DEMO1", dates: "Semaine 47" },
    identification: d.identification.map((f) => (f.id === "numero-serie" ? { ...f, valeur: "BF2511" } : f)),
    testsPreliminaires: d.testsPreliminaires.map(j),
    configuration: { nomFichier: "DEMO1_F1.dex5", jugement: "C" },
    circuitsMesure: {
      ...d.circuitsMesure,
      transformateurs: d.circuitsMesure.transformateurs.map(j),
      champTournant: { valeur: "Direct", jugement: "C" },
      sensCablage: d.circuitsMesure.sensCablage.map(j),
      systemeEquilibre: {
        ...d.circuitsMesure.systemeEquilibre,
        lignes: d.circuitsMesure.systemeEquilibre.lignes.map(j),
      },
      systemeDesequilibre: {
        ...d.circuitsMesure.systemeDesequilibre,
        lignes: d.circuitsMesure.systemeDesequilibre.lignes.map(j),
      },
      defautTerre: d.circuitsMesure.defautTerre.map(j),
      controleTresse: j(d.circuitsMesure.controleTresse),
    },
    es: { ...d.es, points: d.es.points.map((p) => (p.reserve ? p : { ...p, teste: "C" as const })) },
    conclusion: { materiel: "accepte" },
  };
}

describe("creerPvRelais", () => {
  it("produit des données conformes au schéma", () => {
    const d = creerPvRelais(CTX);
    expect(pvRelaisDataSchema.parse(d)).toEqual(d);
  });

  it("pré-remplit l'en-tête, la révision A et les noms par défaut de l'affaire", () => {
    const d = creerPvRelais(CTX);
    expect(d.entete).toEqual({
      numeroDocument: "DEMO1_AUT_009",
      numeroAffaire: "A00001",
      client: "CLIENT DEMO",
      projet: "Stockage batteries – DEMO1",
      indice: "A",
      statutDocument: null,
    });
    expect(d.revisions).toEqual([
      {
        indice: "A",
        date: "2026-11-19",
        ecritPar: "",
        validePar: "V. VALIDEUR",
        approuvePar: "A. APPROBATEUR",
        modifications: "Première édition / First issue",
      },
    ]);
    expect(d.identification.find((f) => f.id === "modele")?.valeur).toBe("COMPACT - 7SX8000");
  });

  it("reprend la liste E/S et coche NA les E/S de réserve", () => {
    const d = creerPvRelais(CTX);
    expect(d.es).toMatchObject({
      referenceDocument: "DEMO1_AUT_009",
      revision: "B",
      feuille: "TYPE BATTERIE",
      listeVersion: 1,
    });
    expect(d.es.points.map((p) => [p.adresse, p.teste])).toEqual([
      ["BI 1.01", null],
      ["BI 2.11", "NA"],
      ["BO 1.01", null],
    ]);
  });

  it("sans liste E/S : bloc E/S vide", () => {
    const d = creerPvRelais({ ...CTX, es: null });
    expect(d.es.points).toEqual([]);
    expect(d.entete.numeroDocument).toBe("");
  });

  it("contient les 10 LED × 3 couleurs du modèle et les tableaux d'injection", () => {
    const d = creerPvRelais(CTX);
    expect(d.leds).toHaveLength(30);
    expect(new Set(d.leds.map((l) => l.id)).size).toBe(30);
    expect(d.circuitsMesure.systemeDesequilibre.lignes[1]).toMatchObject({
      phase: "B",
      injecteV: { amplitude: 40, angle: -120 },
      injecteI: { amplitude: 0.5, angle: -120 },
    });
  });
});

describe("nouvelleFonction", () => {
  it("crée deux groupes d'injection L1-L3 et deux lignes de temps mesurés, ids uniques", () => {
    const f = nouvelleFonction(ids);
    expect(f.injections.map((g) => g.lignes.map((l) => l.libelle))).toEqual([
      ["V L1", "V L2", "V L3"],
      ["I L1", "I L2", "I L3"],
    ]);
    expect(f.injections[0]!.lignes.map((l) => l.angle)).toEqual([0, 120, -120]);
    expect(f.tempsMesures).toHaveLength(2);
    const all = [
      f.id,
      ...f.injections.flatMap((g) => [g.id, ...g.lignes.map((l) => l.id)]),
      ...f.tempsMesures.map((t) => t.id),
    ];
    expect(new Set(all).size).toBe(all.length);
  });

  it("utilise crypto.randomUUID par défaut", () => {
    expect(nouvelleFonction().id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("pvRelaisDataSchema", () => {
  it("refuse une signature qui n'est pas un PNG en data URL", () => {
    const d = creerPvRelais(CTX);
    d.signatures.spie.signature = "data:image/svg+xml;base64,PHN2Zz4=";
    expect(pvRelaisDataSchema.safeParse(d).success).toBe(false);
    d.signatures.spie.signature = "data:image/png;base64,iVBORw0KGgo=";
    expect(pvRelaisDataSchema.safeParse(d).success).toBe(true);
  });

  it("refuse un jugement inconnu et une mesure non numérique", () => {
    const d = creerPvRelais(CTX) as unknown as {
      configuration: { jugement: string };
      circuitsMesure: { systemeEquilibre: { lignes: { mesureV: { amplitude: unknown } }[] } };
    };
    d.configuration.jugement = "OK";
    expect(pvRelaisDataSchema.safeParse(d).success).toBe(false);
    d.configuration.jugement = "C";
    d.circuitsMesure.systemeEquilibre.lignes[0]!.mesureV.amplitude = "57,7";
    expect(pvRelaisDataSchema.safeParse(d).success).toBe(false);
  });
});

describe("numéro de PV (spec §4.1)", () => {
  it("numéro d'affaire + date et heure de Paris", () => {
    expect(numeroPv("A00001", new Date("2026-11-19T13:32:05Z"))).toBe("A00001-20261119-143205");
  });

  it("parseNumeroPv décompose un numéro valide et refuse le reste", () => {
    expect(parseNumeroPv("A00001-20261119-143205")).toEqual({ affaire: "A00001", date: "20261119", heure: "143205" });
    expect(parseNumeroPv("A00001-20261119-1432")).toBeNull();
    expect(parseNumeroPv("a00001-20261119-143205")).toBeNull();
  });

  it("delaiAvantNumero : 0 pour une nouvelle seconde, attente jusqu'à la seconde suivante sinon", () => {
    const dernier = new Date("2026-11-19T13:32:05.200Z");
    expect(delaiAvantNumero(null, dernier)).toBe(0);
    expect(delaiAvantNumero(dernier, new Date("2026-11-19T13:32:06.000Z"))).toBe(0);
    expect(delaiAvantNumero(dernier, new Date("2026-11-19T13:32:05.700Z"))).toBe(300);
    // Horloge revenue en arrière : on attend quand même la seconde suivant le dernier numéro.
    expect(delaiAvantNumero(dernier, new Date("2026-11-19T13:32:04.500Z"))).toBe(1500);
  });

  it("attribuerNumeroPv attend la seconde suivante quand deux PV sont créés dans la même seconde", async () => {
    let t = new Date("2026-11-19T13:32:05.400Z").getTime();
    const attendre = vi.fn(async (ms: number) => {
      t += ms;
    });
    const r = await attribuerNumeroPv("A00001", new Date("2026-11-19T13:32:05.100Z"), () => new Date(t), attendre);
    expect(attendre).toHaveBeenCalledWith(600);
    expect(r.numero).toBe("A00001-20261119-143206");
  });

  it("attribuerNumeroPv ne boucle pas si l'horloge est bloquée", async () => {
    const fige = new Date("2026-11-19T13:32:05.400Z");
    const r = await attribuerNumeroPv(
      "A00001",
      fige,
      () => fige,
      async () => undefined,
    );
    expect(r.numero).toBe("A00001-20261119-143206");
  });
});

describe("nomFichierPv (spec §5.3)", () => {
  it("compose famille, tag, numéro et indice", () => {
    expect(
      nomFichierPv({
        famille: "MES",
        tag: "RPN_HTA_F1",
        numero: "A00001-20261119-143205",
        indice: "A",
        extension: "pdf",
      }),
    ).toBe("PV_MES_RPN_HTA_F1_A00001-20261119-143205_indA.pdf");
  });

  it("remplace les caractères interdits et les espaces du tag ; omet un tag absent", () => {
    expect(
      nomFichierPv({ famille: "MES", tag: "RPN/HTA F1", numero: "A1-20261119-143205", indice: "B", extension: "xlsx" }),
    ).toBe("PV_MES_RPN_HTA_F1_A1-20261119-143205_indB.xlsx");
    expect(
      nomFichierPv({ famille: "MES", tag: null, numero: "A1-20261119-143205", indice: "A", extension: "json" }),
    ).toBe("PV_MES_A1-20261119-143205_indA.json");
  });
});

describe("empreinte SHA-256", () => {
  it("canonicalJson trie les clés et ignore undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, "x", null], c: undefined } })).toBe('{"a":{"d":[1,"x",null]},"b":1}');
    expect(canonicalJson([undefined])).toBe("[null]");
    expect(canonicalJson("é")).toBe('"é"');
  });

  it("canonicalJson refuse les nombres non finis", () => {
    expect(() => canonicalJson({ x: Number.NaN })).toThrow();
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow();
  });

  it("sha256Hex correspond au vecteur de test standard", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("empreintePv ne dépend pas de l'ordre des clés et change avec les données", async () => {
    const d = creerPvRelais(CTX);
    const base = {
      pvId: "p",
      versionId: "v",
      numero: "A00001-20261119-143205",
      indice: "A",
      signeLe: "2026-11-19T15:00:00.000Z",
    };
    const h1 = await empreintePv({ ...base, donnees: d });
    const reordonne = JSON.parse(JSON.stringify(d), (_k, v) =>
      v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v,
    );
    expect(await empreintePv({ ...base, donnees: reordonne })).toBe(h1);
    const modifie = { ...d, generalites: { ...d.generalites, lieu: "Autre" } };
    expect(await empreintePv({ ...base, donnees: modifie })).not.toBe(h1);
    expect(await empreintePv({ ...base, indice: "B", donnees: d })).not.toBe(h1);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("contrôles avant signature (spec §3.2 étape 4)", () => {
  it("un PV complet n'a aucun manque bloquant", () => {
    const manques = controlesAvantSignature(pvComplet());
    expect(manques.filter((m) => m.bloquant)).toEqual([]);
  });

  it("liste champs obligatoires, E/S non testées et conclusions absentes d'un PV vierge", () => {
    const manques = controlesAvantSignature(creerPvRelais(CTX));
    const messages = manques.map((m) => m.message);
    expect(messages).toContain("Lieu des tests non renseigné.");
    expect(messages).toContain("Dates des tests non renseignées.");
    expect(messages).toContain("Conclusion générale (matériel accepté / refusé) absente.");
    expect(messages.filter((m) => m.startsWith("E/S non testée"))).toHaveLength(2); // la réserve est déjà NA
    expect(messages).toContain("Conclusion absente : Mesure de la tension d'alimentation auxiliaire");
    // La ligne N, sans valeur injectée, n'est pas exigée.
    expect(manques.some((m) => m.ref === "injection.equilibre.eq-n")).toBe(false);
    expect(manques.some((m) => m.ref === "injection.equilibre.eq-a")).toBe(true);
    // LED non affectées : pas à vérifier.
    expect(manques.some((m) => m.ref.startsWith("led."))).toBe(false);
  });

  it("une LED affectée doit être vérifiée", () => {
    const d = pvComplet();
    d.leds[0] = { ...d.leds[0]!, designation: "Disjoncteur ouvert" };
    expect(controlesAvantSignature(d).map((m) => m.ref)).toContain(`led.${d.leds[0].id}`);
  });

  it("un NC exige une observation : commentaire sur l'élément ou ligne d'observation liée", () => {
    const d = pvComplet();
    d.testsPreliminaires[0] = { ...d.testsPreliminaires[0]!, jugement: "NC" };
    expect(controlesAvantSignature(d).map((m) => m.message)).toContain(
      "NC sans observation : Mesure de la tension d'alimentation auxiliaire",
    );
    const avecObs = ajouterObservation(
      d,
      {
        ref: "tests.tension-aux",
        libelle: "Tension auxiliaire",
        jugement: "NC",
        observation: "110 V relevé au lieu de 125 V",
      },
      ids,
    );
    expect(controlesAvantSignature(avecObs).filter((m) => m.bloquant)).toEqual([]);
    d.testsPreliminaires[0] = { ...d.testsPreliminaires[0], observation: "Tension basse" };
    expect(controlesAvantSignature(d).filter((m) => m.bloquant)).toEqual([]);
  });

  it("l'exigence d'observation sur NC peut être désactivée (point ouvert n°9)", () => {
    const d = pvComplet();
    d.configuration = { ...d.configuration, jugement: "NC" };
    expect(controlesAvantSignature(d, { observationObligatoireSurNc: false }).filter((m) => m.bloquant)).toEqual([]);
  });

  it("une E/S NC en SCADA sans commentaire est signalée", () => {
    const d = pvComplet();
    d.es.points[0] = { ...d.es.points[0]!, scada: "NC" };
    expect(
      controlesAvantSignature(d).some((m) => m.ref === "es.p1" && m.message.startsWith("NC sans observation")),
    ).toBe(true);
    d.es.points[0] = { ...d.es.points[0], commentaire: "Libellé SCADA erroné" };
    expect(controlesAvantSignature(d).some((m) => m.ref === "es.p1")).toBe(false);
  });

  it("une ligne d'observation NC vide est bloquante ; une fonction sans temps mesuré est un avertissement", () => {
    let d = pvComplet();
    d = ajouterObservation(d, { ref: null, libelle: "Contrôle visuel", jugement: "NC", observation: "" }, ids);
    d = { ...d, fonctions: [{ ...nouvelleFonction(ids), nomLogique: "PHPTOC1" }] };
    const manques = controlesAvantSignature(d);
    expect(manques.find((m) => m.section === "observations")).toMatchObject({ bloquant: true });
    expect(manques.find((m) => m.section === "protection")).toMatchObject({
      bloquant: false,
      message: "Temps mesurés non renseignés : PHPTOC1.",
    });
  });

  it("le numéro de série manquant est un simple avertissement", () => {
    const d = pvComplet();
    d.identification = d.identification.map((f) => (f.id === "numero-serie" ? { ...f, valeur: "" } : f));
    expect(controlesAvantSignature(d).find((m) => m.ref === "identification.numero-serie")).toMatchObject({
      bloquant: false,
    });
  });
});

describe("controlesSignature", () => {
  const PNG = "data:image/png;base64,iVBORw0KGgo=";
  it("exige statut, signature SPIE et signature client", () => {
    const refs = controlesSignature(pvComplet()).map((m) => m.ref);
    expect(refs).toEqual([
      "entete.statutDocument",
      "signatures.spie.nom",
      "signatures.spie.date",
      "signatures.spie.signature",
      "signatures.client.nom",
      "signatures.client.date",
      "signatures.client.signature",
    ]);
  });

  it("accepte un refus de signer motivé à la place de la signature client", () => {
    const d = pvComplet();
    d.entete.statutDocument = "CMS";
    d.signatures.spie = { nom: "T. Technicien", date: "2026-11-19", signature: PNG, commentaires: "" };
    d.signatures.client.date = "2026-11-19";
    d.signatures.client.refus = { motif: "" };
    expect(controlesSignature(d).map((m) => m.ref)).toEqual(["signatures.client.refus"]);
    d.signatures.client.refus = { motif: "Désaccord sur la réserve n°1" };
    expect(controlesSignature(d)).toEqual([]);
  });

  it("exige la date du refus de signer (nom et visa client facultatifs)", () => {
    const d = pvComplet();
    d.entete.statutDocument = "BPE";
    d.signatures.spie = { nom: "T. Technicien", date: "2026-11-19", signature: PNG, commentaires: "" };
    d.signatures.client = {
      nom: "",
      date: "",
      signature: null,
      commentaires: "",
      refus: { motif: "Désaccord sur la réserve n°1" },
    };
    expect(controlesSignature(d)).toEqual([
      {
        ref: "signatures.client.date",
        section: "conclusion",
        message: "Date du refus de signer manquante.",
        bloquant: true,
      },
    ]);
    d.signatures.client.date = "2026-11-20";
    expect(controlesSignature(d)).toEqual([]);
  });
});

describe("E/S : avancement, saisie, filtres", () => {
  it("avancementEs compte testées, NC et réserves", () => {
    const pts = pointsEsDepuisListe(SOURCE);
    pts[0] = { ...pts[0]!, teste: "NC" };
    expect(avancementEs(pts)).toEqual({ total: 3, testees: 2, nc: 1, reserves: 1, restantes: 1 });
  });

  it("jugementEs agrège test et SCADA", () => {
    const [p] = pointsEsDepuisListe(SOURCE);
    expect(jugementEs(p!)).toBeNull();
    expect(jugementEs({ ...p!, teste: "C", scada: "NC" })).toBe("NC");
    expect(jugementEs({ ...p!, teste: "C", scada: "C" })).toBe("C");
  });

  it("saisirResultatEs ajoute auteur et date sans modifier l'original", () => {
    const [p] = pointsEsDepuisListe(SOURCE);
    const r = saisirResultatEs(
      p!,
      { teste: "C", leds: "OK", message: "DISJ OUVERT" },
      { par: "Théo", le: "2026-11-19T14:00:00.000Z" },
    );
    expect(r).toMatchObject({ teste: "C", leds: "OK", message: "DISJ OUVERT", saisie: { par: "Théo" } });
    expect(p!.teste).toBeNull();
  });

  it("filtrerEs : non testées, NC, réserves et recherche sans accents", () => {
    const pts = pointsEsDepuisListe(SOURCE);
    pts[2] = { ...pts[2]!, teste: "NC" };
    expect(filtrerEs(pts, "non_testees").map((p) => p.id)).toEqual(["p1"]);
    expect(filtrerEs(pts, "nc").map((p) => p.id)).toEqual(["p3"]);
    expect(filtrerEs(pts, "reserves").map((p) => p.id)).toEqual(["p2"]);
    expect(filtrerEs(pts, "toutes", "declenchement").map((p) => p.id)).toEqual(["p1", "p3"]);
    expect(filtrerEs(pts, "toutes", "bo 1.0").map((p) => p.id)).toEqual(["p3"]);
  });

  it("grouperParCarte garde l'ordre d'apparition des cartes", () => {
    const g = grouperParCarte(pointsEsDepuisListe(SOURCE));
    expect(g.map((x) => [x.carte, x.points.map((p) => p.id)])).toEqual([
      ["RPN_HTA / PS050_1", ["p1", "p3"]],
      ["RPN_HTA / IO60_1", ["p2"]],
    ]);
  });
});

describe("observations et réserves (spec §4.3)", () => {
  it("numérote automatiquement observations et réserves", () => {
    let d = creerPvRelais(CTX);
    d = ajouterObservation(
      d,
      {
        ref: "es.p1",
        libelle: "E/S BI 1.01",
        jugement: "NC",
        observation: "Pas de remontée",
        reserve: { criticite: "bloquante" },
      },
      ids,
    );
    d = ajouterObservation(d, { ref: null, libelle: "Visuel", jugement: "C", observation: "" }, ids);
    expect(d.observations.map((o) => [o.numero, o.reserveNumero])).toEqual([
      [1, 1],
      [2, null],
    ]);
    expect(d.reserves[0]).toMatchObject({
      numero: 1,
      ref: "es.p1",
      controle: "E/S BI 1.01",
      description: "Pas de remontée",
      criticite: "bloquante",
      statut: "ouverte",
      indiceCreation: "A",
    });
    expect(recapReserves(d)).toEqual({ ouvertes: 1, levees: 0 });
  });

  it("transformerEnReserve lie une observation existante à une nouvelle réserve, une seule fois", () => {
    let d = ajouterObservation(
      creerPvRelais(CTX),
      { ref: "configuration", libelle: "Configuration", jugement: "NC", observation: "Mauvais fichier" },
      ids,
    );
    const obsId = d.observations[0]!.id;
    d = transformerEnReserve(d, obsId, { responsable: "SPIE" }, ids);
    expect(d.observations[0]!.reserveNumero).toBe(1);
    expect(d.reserves).toHaveLength(1);
    expect(transformerEnReserve(d, obsId, {}, ids)).toBe(d);
    expect(transformerEnReserve(d, "inconnu", {}, ids)).toBe(d);
  });

  it("pas de réserve sans texte saisi : ni en un geste, ni par transformation d'une observation vide", () => {
    const d = creerPvRelais(CTX);
    const nc = { ref: "es.p1", libelle: "E/S BI 1.01", jugement: "NC" as const };
    expect(ajouterObservation(d, { ...nc, observation: "  ", reserve: {} }, ids)).toBe(d);
    expect(
      ajouterObservation(d, { ...nc, observation: "", reserve: { description: "Pas de remontée" } }, ids).reserves,
    ).toHaveLength(1);
    const vide = ajouterObservation(d, { ...nc, observation: "" }, ids);
    expect(transformerEnReserve(vide, vide.observations[0]!.id, {}, ids)).toBe(vide);
  });

  /** Trois observations, les deux premières avec une réserve (n°1 et n°2). */
  function troisObservations(): PvRelaisData {
    let d = creerPvRelais(CTX);
    for (const [libelle, reserve] of [
      ["E/S BI 1.01", true],
      ["E/S BI 1.02", true],
      ["Visuel", false],
    ] as const) {
      d = ajouterObservation(
        d,
        { ref: null, libelle, jugement: "NC", observation: `Constat ${libelle}`, reserve: reserve ? {} : undefined },
        ids,
      );
    }
    return d;
  }

  it("supprimerReserve : l'observation reste sans réserve, les réserves suivantes sont renumérotées", () => {
    const d = troisObservations();
    const apres = supprimerReserve(d, d.reserves[0]!.id);
    expect(apres.reserves.map((r) => [r.numero, r.controle])).toEqual([[1, "E/S BI 1.02"]]);
    expect(apres.observations.map((o) => [o.numero, o.libelle, o.reserveNumero])).toEqual([
      [1, "E/S BI 1.01", null],
      [2, "E/S BI 1.02", 1],
      [3, "Visuel", null],
    ]);
    expect(supprimerReserve(d, "inconnue")).toBe(d);
  });

  it("supprimerObservation retire aussi sa réserve et renumérote ; une réserve d'une révision précédente est protégée", () => {
    const d = troisObservations();
    const apres = supprimerObservation(d, d.observations[0]!.id);
    expect(apres.observations.map((o) => [o.numero, o.libelle, o.reserveNumero])).toEqual([
      [1, "E/S BI 1.02", 1],
      [2, "Visuel", null],
    ]);
    expect(apres.reserves.map((r) => [r.numero, r.controle])).toEqual([[1, "E/S BI 1.02"]]);
    expect(supprimerObservation(apres, apres.observations[1]!.id).observations).toHaveLength(1);

    // Révision B : la réserve n°1 (indice A) se lève, elle ne se supprime pas.
    const revB = { ...d, entete: { ...d.entete, indice: "B" } };
    expect(reserveSupprimable(revB, revB.reserves[0]!)).toBe(false);
    expect(supprimerReserve(revB, revB.reserves[0]!.id)).toBe(revB);
    expect(supprimerObservation(revB, revB.observations[0]!.id)).toBe(revB);
    expect(reserveSupprimable(d, { indiceCreation: "A", statut: "levee" })).toBe(false);
  });
});

describe("valeurs préparées modifiées sur site (spec §4.2)", () => {
  it("signale les valeurs préparées changées, pas les valeurs vides complétées", () => {
    const prep = creerPvRelais(CTX);
    prep.fonctions = [{ ...nouvelleFonction(ids), id: "f1", nomLogique: "PHPTOC1", reglages: "6250A" }];
    const site: PvRelaisData = structuredClone(prep);
    site.generalites.lieu = "Poste DEMO1"; // vide au bureau : pas une modification
    site.fonctions[0]!.reglages = "6300A";
    site.identification = site.identification.map((f) => (f.id === "modele" ? { ...f, valeur: "7SX82" } : f));
    site.es.points[1] = { ...site.es.points[1]!, teste: "C" }; // réserve pré-cochée NA
    const modifs = valeursPrepareesModifiees(prep, site);
    expect(modifs).toEqual([
      { chemin: "identification[modele].valeur", avant: "COMPACT - 7SX8000", apres: "7SX82" },
      { chemin: "es.points[p2].teste", avant: "NA", apres: "C" },
      { chemin: "fonctions[f1].reglages", avant: "6250A", apres: "6300A" },
    ]);
  });

  it("signale un élément préparé supprimé", () => {
    const prep = creerPvRelais(CTX);
    const site = { ...prep, materielTest: prep.materielTest.filter((l) => l.id !== "mt-3") };
    expect(valeursPrepareesModifiees(prep, site)).toEqual([
      { chemin: "materielTest[mt-3]", avant: prep.materielTest[2], apres: null },
    ]);
  });

  it("tableau des révisions : « Écrit par » complété sur site n'est pas une modification, un nom changé l'est", () => {
    const prep = creerPvRelais(CTX);
    const site: PvRelaisData = structuredClone(prep);
    site.revisions[0] = { ...site.revisions[0]!, ecritPar: "Théo Technicien" };
    expect(valeursPrepareesModifiees(prep, site)).toEqual([]);
    site.revisions[0] = { ...site.revisions[0], validePar: "M. Martin" };
    expect(valeursPrepareesModifiees(prep, site)).toEqual([
      { chemin: "revisions[0].validePar", avant: "V. VALIDEUR", apres: "M. Martin" },
    ]);
    expect(valeursPrepareesModifiees(prep, { ...site, revisions: [] })).toEqual([
      { chemin: "revisions[0]", avant: prep.revisions[0], apres: null },
    ]);
  });

  it("liste de valeurs simples : comparée d'un bloc", () => {
    expect(valeursPrepareesModifiees({ tags: ["a", "b"] }, { tags: ["a", "c"] })).toEqual([
      { chemin: "tags", avant: ["a", "b"], apres: ["a", "c"] },
    ]);
  });

  it("aucune modification quand rien n'a changé", () => {
    const prep = creerPvRelais(CTX);
    expect(valeursPrepareesModifiees(prep, structuredClone(prep))).toEqual([]);
  });

  it("majJournalModifications garde l'auteur d'une modification inchangée et date les nouvelles", () => {
    const t1 = { par: "Théo", le: "2026-11-19T10:00:00.000Z" };
    const t2 = { par: "Théo", le: "2026-11-19T11:00:00.000Z" };
    const j1 = majJournalModifications([], [{ chemin: "a", avant: 1, apres: 2 }], t1);
    expect(j1).toEqual([{ chemin: "a", avant: 1, apres: 2, par: "Théo", le: t1.le }]);
    const j2 = majJournalModifications(
      j1,
      [
        { chemin: "a", avant: 1, apres: 2 },
        { chemin: "b", avant: "x", apres: "y" },
      ],
      t2,
    );
    expect(j2.map((m) => [m.chemin, m.le])).toEqual([
      ["a", t1.le],
      ["b", t2.le],
    ]);
    const j3 = majJournalModifications(j2, [{ chemin: "a", avant: 1, apres: 3 }], t2);
    expect(j3).toEqual([{ chemin: "a", avant: 1, apres: 3, par: "Théo", le: t2.le }]);
  });
});

describe("statuts et reprises (spec §5.4, §6.4)", () => {
  it("respecte le diagramme d'états", () => {
    expect(transitionPvPermise("prepare", "brouillon")).toBe(true);
    expect(transitionPvPermise("brouillon", "signe")).toBe(true);
    expect(transitionPvPermise("signe", "recu")).toBe(true);
    expect(transitionPvPermise("recu", "depose")).toBe(true);
    expect(transitionPvPermise("recu", "erreur")).toBe(true);
    expect(transitionPvPermise("erreur", "depose")).toBe(true);
    expect(transitionPvPermise("depose", "brouillon")).toBe(false); // révision suivante : nouvelle version (lot 2)
    expect(transitionPvPermise("prepare", "signe")).toBe(false);
  });

  it("versionFigee : plus modifiable après signature", () => {
    expect(versionFigee("prepare")).toBe(false);
    expect(versionFigee("brouillon")).toBe(false);
    expect(versionFigee("signe")).toBe(true);
    expect(versionFigee("depose")).toBe(true);
  });

  it("délais de reprise 1 min, 5 min, 30 min, 2 h, 6 h puis abandon", () => {
    expect(DELAIS_REPRISE_MS).toEqual([60_000, 300_000, 1_800_000, 7_200_000, 21_600_000]);
    expect([0, 1, 2, 3, 4, 5, 6].map(delaiReprise)).toEqual([
      0,
      60_000,
      300_000,
      1_800_000,
      7_200_000,
      21_600_000,
      null,
    ]);
  });
});

describe("chemins SharePoint relatifs", () => {
  it("découpe en segments et refuse . et ..", () => {
    expect(segmentsChemin(" 03 - Mise en service / PV/ ")).toEqual(["03 - Mise en service", "PV"]);
    expect(segmentsChemin("")).toEqual([]);
    expect(cheminRelatifSchema.safeParse("03 - Mise en service/PV").success).toBe(true);
    expect(cheminRelatifSchema.safeParse("../autre").success).toBe(false);
    expect(cheminRelatifSchema.safeParse("a/./b").success).toBe(false);
    expect(cheminRelatifSchema.safeParse("a:b").success).toBe(false);
  });
});

describe("uploadPvVersionRequestSchema", () => {
  it("valide une requête d'envoi complète et refuse une empreinte mal formée", () => {
    const req = {
      pvId: "8a5b1c2d-0000-4000-8000-0000000000aa",
      affaireId: "8a5b1c2d-0000-4000-8000-0000000000bb",
      equipementId: null,
      numero: "A00001-20261119-143205",
      indice: "A",
      modele: "relais",
      modeleVersion: "1.0.0",
      donnees: pvComplet(),
      donneesPreparees: null,
      modifications: [],
      creeLe: "2026-11-19T13:32:05.000Z",
      signeLe: "2026-11-19T15:00:00.000Z",
      tabletteId: "tablette-1",
      empreinte: "a".repeat(64),
    };
    expect(uploadPvVersionRequestSchema.safeParse(req).success).toBe(true);
    expect(uploadPvVersionRequestSchema.safeParse({ ...req, empreinte: "XYZ" }).success).toBe(false);
  });
});

describe("elementsJuges", () => {
  it("donne une référence unique à chaque contrôle", () => {
    const refs = elementsJuges(creerPvRelais(CTX)).map((e) => e.ref);
    expect(new Set(refs).size).toBe(refs.length);
    expect(refs).toContain("es.p1");
    expect(refs).toContain("transfo.tc-a");
    expect(refs).toContain("tresse");
  });
});
