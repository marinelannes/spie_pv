import { SECTIONS_RELAIS, creerPvRelais, type PvDocument } from "@spie/shared";
import { describe, expect, it } from "vitest";
import {
  PAGED_HANDLERS_JS,
  SCRIPTS_APERCU,
  SIGNATURE_EXEMPLE_CLIENT,
  SIGNATURE_EXEMPLE_SPIE,
  entreesSommaire,
  exemplePvDocument,
  formatAngle,
  formatDate,
  formatDateHeure,
  formatNombre,
  formatPhaseur,
  formatValeur,
  pointsEsExemple,
  renderPvRelaisHtml,
} from "../src/index.js";

/** Texte visible approximatif (balises retirées, entités courantes décodées). */
function texte(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
}

/** Contenu de l'élément d'en-tête courant (`<div class="entete">…</div>` jusqu'au pied). */
const entete = (html: string) => html.slice(html.indexOf('<div class="entete">'), html.indexOf('<div class="pied">'));

/** PV minimal : sans liste E/S, sans fonction ni observation, non signé. */
function pvMinimal(): PvDocument {
  const donnees = creerPvRelais({
    affaire: { numero: "A1", client: "Client", projet: "Projet", valideParDefaut: "", approuveParDefaut: "" },
    es: null,
    date: "2026-11-19",
  });
  return {
    format: "spie-pv/1",
    pv: { id: "p", numero: "A1-20261119-143205", modele: "relais", modeleVersion: "1.0.0", famille: "MES" },
    version: { id: "v", indice: "A", statutDocument: null, signeLe: null, empreinte: null },
    affaire: { numero: "A1", client: "Client", projet: "Projet", site: "" },
    equipement: null,
    listeEs: null,
    meta: {
      creeLe: "2026-11-19T13:32:05.000Z",
      tabletteId: null,
      signePar: null,
      recuLe: null,
      genereLe: "2026-11-19T13:40:00.000Z",
    },
    donnees,
    donneesPreparees: null,
    modifications: [],
  };
}

describe("formatage", () => {
  it("formatNombre : point décimal, 3 décimales au plus, vide si absent", () => {
    expect(formatNombre(57.74)).toBe("57.74");
    expect(formatNombre(0.1 + 0.2)).toBe("0.3");
    expect(formatNombre(1)).toBe("1");
    expect(formatNombre(null)).toBe("");
    expect(formatNombre(Number.NaN)).toBe("");
  });

  it("formatAngle : signe explicite comme dans le modèle", () => {
    expect(formatAngle(0)).toBe("0°");
    expect(formatAngle(120)).toBe("+120°");
    expect(formatAngle(-120)).toBe("-120°");
    expect(formatAngle(null)).toBe("");
  });

  it("formatPhaseur : amplitude + unité + angle, parties absentes omises", () => {
    expect(formatPhaseur({ amplitude: 57.74, angle: -120 }, "V")).toBe("57.74 V -120°");
    expect(formatPhaseur({ amplitude: 1, angle: null }, "A")).toBe("1 A");
    expect(formatPhaseur({ amplitude: null, angle: 0 }, "A")).toBe("0°");
    expect(formatPhaseur({ amplitude: null, angle: null }, "A")).toBe("");
    expect(formatPhaseur(null, "A")).toBe("");
  });

  it("formatDate et formatDateHeure : format français, heure de Paris", () => {
    expect(formatDate("2026-11-19")).toBe("19/11/2026");
    expect(formatDate("")).toBe("");
    expect(formatDate("2026-07-01T22:30:00Z")).toBe("02/07/2026");
    expect(formatDate("pas une date")).toBe("pas une date");
    expect(formatDateHeure("2026-11-19T15:02:00.000Z")).toBe("19/11/2026 16:02");
    expect(formatDateHeure(null)).toBe("");
  });

  it("formatValeur : valeurs du journal des modifications sur une ligne", () => {
    expect(formatValeur("6300A")).toBe("6300A");
    expect(formatValeur(null)).toBe("—");
    expect(formatValeur(12)).toBe("12");
    expect(formatValeur({ id: "x", fr: "a" })).toBe('{"id":"x","fr":"a"}');
    expect(formatValeur("x".repeat(10)).length).toBe(10);
    expect(formatValeur({ t: "y".repeat(300) }).endsWith("…")).toBe(true);
  });
});

describe("renderPvRelaisHtml — structure", () => {
  const doc = exemplePvDocument();
  const html = renderPvRelaisHtml(doc);
  const t = texte(html);

  it("produit un document HTML complet, autonome et sans script par défaut", () => {
    expect(html.startsWith('<!DOCTYPE html><html lang="fr">')).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("@page");
    expect(html).not.toContain("<script");
    // Aucune ressource externe : images en data URI uniquement.
    for (const m of html.matchAll(/<img[^>]+src="([^"]+)"/g)) expect(m[1]).toMatch(/^data:image\/(png|jpeg);base64,/);
    expect(html).not.toMatch(/https?:\/\//);
  });

  it("en-tête répété : logo, titre bilingue, N° Document, N° AFF, projet, révision, numéro du PV", () => {
    const e = texte(entete(html));
    expect(entete(html)).toContain('class="entete"');
    expect(entete(html)).toMatch(/<img src="data:image\/png;base64,[^"]+" alt="SPIE"/);
    expect(e).toContain("PV DE TEST RELAIS DE PROTECTION");
    expect(e).toContain("TEST SHEET PROTECTION RELAY");
    expect(e).toContain("N° Document : DEMO1_AUT_009");
    expect(e).toContain("N° AFF : A00001");
    expect(e).toContain("Projet : Stockage batteries – DEMO1");
    expect(e).toContain("Révision : A");
    expect(e).toContain("A00001-20261119-143205");
    expect(e).toContain("BPO : Bon Pour Observation — BPE : Bon Pour Exécution — CMS : Conforme à la Mise en Service");
    expect(html).toContain("position: running(entete)");
  });

  it("cases BPO / BPE / CMS cochées selon le statut du document", () => {
    const cases = (h: string) =>
      [...entete(h).matchAll(/<span class="(case(?: coche)?)"><\/span>(BPO|BPE|CMS)/g)].map((m) => [m[2], m[1]]);
    expect(cases(html)).toEqual([
      ["BPO", "case"],
      ["BPE", "case"],
      ["CMS", "case coche"],
    ]);
    const bpe = exemplePvDocument();
    bpe.donnees.entete.statutDocument = "BPE";
    expect(cases(renderPvRelaisHtml(bpe))).toEqual([
      ["BPO", "case"],
      ["BPE", "case coche"],
      ["CMS", "case"],
    ]);
    expect(cases(renderPvRelaisHtml(pvMinimal())).every(([, c]) => c === "case")).toBe(true);
  });

  it("pied de page : « Page x sur y », confidentialité et entité SPIE", () => {
    expect(html).toContain("position: running(pied)");
    expect(html).toContain('content: "Page " counter(page) " sur " counter(pages)');
    expect(t).toContain(
      "Ce document confidentiel est la propriété de SPIE Industrie. Toute communication à des tiers doit faire l'objet d'un accord écrit de sa part.",
    );
    expect(t).toContain("SPIE Industrie – Département Production Énergie – 64121 Serres-Castet");
  });

  it("page de garde : client, projet et tableau des révisions (lignes vides, révisions, en-tête en bas)", () => {
    expect(t).toContain("Client / Customer : CLIENT DEMO INDUSTRIES SAS");
    expect(t).toContain("Projet / Project : Stockage batteries – DEMO1");
    const rev = html.slice(
      html.indexOf('class="t revisions"'),
      html.indexOf("</table>", html.indexOf('class="t revisions"')),
    );
    const lignes = [...rev.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => texte(m[1]!).trim());
    expect(lignes).toHaveLength(8);
    expect(lignes.slice(0, 6).every((l) => l === "")).toBe(true);
    expect(lignes[6]).toBe("A 19/11/2026 T. TECHNICIEN V. VALIDEUR A. APPROBATEUR Première édition / First issue");
    expect(lignes[7]).toMatch(/^Rév Date Écrit par/);
  });

  it("révisions : la plus récente en haut", () => {
    const d = exemplePvDocument();
    d.donnees.revisions.push({
      indice: "B",
      date: "2026-12-01",
      ecritPar: "X",
      validePar: "",
      approuvePar: "",
      modifications: "Levée de réserves",
    });
    const h = renderPvRelaisHtml(d);
    expect(texte(h).indexOf("Levée de réserves")).toBeLessThan(texte(h).indexOf("Première édition"));
  });

  it("sommaire : une entrée par section et sous-section, liens vers des ancres existantes, numéros paginés", () => {
    const entrees = entreesSommaire(false, 0);
    expect(entrees.filter((e) => e.niveau === 1).map((e) => e.numero)).toEqual(SECTIONS_RELAIS.map((s) => s.numero));
    for (const e of entrees) {
      expect(html).toContain(`href="#${e.id}"`);
      expect(html).toContain(`id="${e.id}"`);
    }
    expect(html).toContain("target-counter(attr(href), page)");
    expect(entreesSommaire(true, 0).some((e) => e.id === "s-annexe")).toBe(false);
    expect(entreesSommaire(true, 2).at(-1)?.id).toBe("s-annexe");
  });

  it("sections 1 à 13 avec titres bilingues, textes fixes d'introduction et de glossaire", () => {
    for (const s of SECTIONS_RELAIS)
      expect(t).toContain(`${s.numero}. ${s.titreFr.toUpperCase()} / ${s.titreEn.toUpperCase()}`);
    expect(t).toContain("Ce document détaille l'ensemble des opérations de contrôles");
    expect(t).toContain("This procedure defines the types of checks");
    expect(t).toContain("IHM — Interface Homme Machine");
    expect(t).toContain("NC — Non Conforme");
  });

  it("généralités, identification, tests préliminaires et configuration", () => {
    expect(t).toContain("Les tests d'armoire sont réalisés sur le site de : Poste DEMO1 — local HTA zone nord");
    expect(t).toContain("Semaine 47 (17 au 19/11/2026)");
    expect(t).toContain("Valise d'injection OMICRON");
    expect(t).toContain("Norme : IEC 60439-1");
    expect(t).toContain("Numéro de série / Serial number BF2511003214");
    expect(t).toMatch(/Mesure de la tension d'alimentation auxiliaire.*112,4 Vcc C/);
    expect(t).toMatch(/Parameters filename DEMO1_RPN_HTA_F1_V3\.dex5 C/);
  });

  it("circuits de mesure : TP/TC/tores, champ tournant, sens de câblage, injections, défaut terre, schéma, tresse", () => {
    expect(t).toMatch(/Caractéristiques TP VTs ratio 33 kV\/√3 \/ 100 V\/√3 0\.5 50 VA C/);
    expect(t).toContain("Champ tournant / Phase rotation Direct (L1-L2-L3) C");
    expect(t).toContain("Vérification sens 1S1-1S2");
    expect(t).toContain("A 57.74 V 0° 1 A 0° 57.7 V 0° 1 A 0° C");
    expect(t).toContain("B 40 V -120° 0.5 A -120° 40 V -120° 0.5 A -120° C");
    expect(t).toContain("N°1 N.A N.A 0.2 A 0° 0.2 A 0° C");
    expect(t).toContain("N°2 N.A N.A N.A N.A NA");
    expect(html).toMatch(/<img src="data:image\/png;base64,[^"]+" alt="Schéma type d&#x27;installation/);
    expect(t).toContain("Contrôle câblage tresse de terre dans les tores suivant schéma");
  });

  it("E/S : colonnes de la spec, regroupement par carte, réserves repérées, avancement", () => {
    const es = html.slice(html.indexOf('class="t es"'), html.indexOf("</table>", html.indexOf('class="t es"')));
    const enTetes = texte(es.slice(es.indexOf("<thead>"), es.indexOf("</thead>")));
    for (const c of [
      "Adresse",
      "Type",
      "Désignation",
      "Testé validé",
      "LED",
      "Relais",
      "SCADA",
      "Message lu en supervision",
      "Commentaire",
    ]) {
      expect(enTetes).toContain(c);
    }
    const groupes = [...es.matchAll(/Carte \/ Card : ([^<]+)</g)].map((m) => m[1]);
    expect(groupes).toEqual(["RPN_HTA / PS050_1", "RPN_HTA / IO60_1", "RPN_HTA / IO60_2", "RPN_HTA / IO208"]);
    expect((es.match(/<tbody>/g) ?? []).length).toBe(4);
    expect((es.match(/class="reserve"/g) ?? []).length).toBe(2);
    expect((es.match(/RÉSERVE/g) ?? []).length).toBe(2);
    expect(texte(es)).toContain("BI 1.05 E TOR POSITION DISJ. OUVERT NC OK NC Libellé absent Remontée SCADA absente");
    expect(es).toContain('<td class="j nc">NC</td>');
    expect(t).toContain("E/S testées / tested : 33 / 33 — NC : 1 — réserves / spare : 2");
    expect(t).toContain("Liste E/S : DEMO1_AUT_009 rév. B (version 1) — feuille « TYPE BATTERIE »");
  });

  it("LED : deux colonnes comme le modèle (A-E à gauche, F-J à droite)", () => {
    const leds = html.slice(html.indexOf('class="t leds"'), html.indexOf("</table>", html.indexOf('class="t leds"')));
    const lignes = [...leds.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].slice(1).map((m) => texte(m[1]!).trim());
    expect(lignes).toHaveLength(15);
    expect(lignes[0]).toBe("Led A Vert Disjoncteur ouvert C Led F Vert");
    expect(lignes[14]).toBe("Led E Rouge Led J Rouge");
  });

  it("plan de protection : un bloc insécable par fonction avec réglages, injections, temps, LED, sorties, messages", () => {
    expect((html.match(/<div class="fonction">/g) ?? []).length).toBe(3);
    expect(html).toContain(".fonction { break-inside: avoid;");
    expect(t).toContain("PHPTOC1 Maximum de courant / Overcurrent");
    expect(t).toContain("51 1 1 6250A DT 100ms");
    expect(t).toContain("V L1 : 57.74 V 0° I L1 : 5 A 0°");
    expect(t).toContain("216 ms");
    expect(t).toContain("Attendu / Expected LED TRIP ; LED C Carte B : /DO2 ; DO1 — Virtuelle : VO1");
    expect(t).toContain("Constaté / Observed CTRLSYNC1 TRIP");
    expect(t).toContain("25 1 1 990V – 5° - 0.1Hz LD DT inst");
    expect(t).toContain("Blocage de fermeture uniquement.");
  });

  it("observations (NA / C / NC, n° de réserve), réserves et récapitulatif", () => {
    expect(t).toContain("1 E/S BI 1.05 — POSITION DISJ. OUVERT X 1 Remontée SCADA absente.");
    expect(t).toContain("2 Contrôle visuel du câblage X RAS");
    expect(t).toContain("Réserves ouvertes / open : 1 — levées / lifted : 0");
    expect(t).toMatch(
      /1 E\/S BI 1\.05 — POSITION DISJ\. OUVERT Remontée SCADA absente\. Non bloquante SPIE — automatisme 30\/11\/2026 Ouverte \/ Open/,
    );
  });

  it("conclusion et signatures : matériel accepté, signatures en image, empreinte et numéro", () => {
    expect(html).toMatch(/<span class="case coche"><\/span>Accepté \/ Accepted<span class="case"><\/span>Refusé/);
    expect(html).toContain(`<img src="${SIGNATURE_EXEMPLE_SPIE}" alt="Signature SPIE"/>`);
    expect(html).toContain(`<img src="${SIGNATURE_EXEMPLE_CLIENT}" alt="Signature client"/>`);
    expect(t).toContain("DATE 19/11/2026 19/11/2026");
    expect(t).toContain("NOM / NAME T. TECHNICIEN J. DUPONT");
    expect(t).toContain("Réserve n°1 à lever avant la mise en service.");
    expect(t).toContain(`SHA-256 fingerprint : ${doc.version.empreinte}`);
    expect(t).toContain(
      "PV n° A00001-20261119-143205 — indice A — modèle relais v1.0.0 — signé le 19/11/2026 16:02 par T. TECHNICIEN",
    );
  });

  it("refus de signer : mention et motif à la place de la signature client", () => {
    const h = renderPvRelaisHtml(exemplePvDocument({ refusClient: true }));
    expect(texte(h)).toContain(
      "Refus de signer / Refused to sign Motif / Reason : Réserve n°1 à lever avant signature.",
    );
    expect(texte(h)).toContain("DATE 19/11/2026 19/11/2026"); // le refus est daté côté client

    expect(h).not.toContain('alt="Signature client"');
    expect(h).toContain('alt="Signature SPIE"');
  });
});

describe("renderPvRelaisHtml — options", () => {
  it("aperçu : bandeau dans l'en-tête et filigrane ; pas d'empreinte avant signature", () => {
    const h = renderPvRelaisHtml(exemplePvDocument({ signe: false }), { apercu: true });
    expect(h).toContain('<body class="apercu">');
    expect(texte(entete(h))).toContain("APERÇU — document non signé / PREVIEW — not signed");
    expect(h).toContain('content: "APERÇU — NON SIGNÉ"');
    expect(texte(h)).toContain("Document non signé : l'empreinte SHA-256 sera calculée à la signature.");
    expect(h).not.toContain('alt="Signature SPIE"');
    const signe = renderPvRelaisHtml(exemplePvDocument());
    expect(signe).toContain("<body>");
    expect(signe).not.toContain('class="apercu-bandeau"');
  });

  it("annexe des valeurs pré-remplies modifiées : absente par défaut, présente sur demande", () => {
    const doc = exemplePvDocument();
    expect(renderPvRelaisHtml(doc)).not.toContain('id="s-annexe"');
    const h = renderPvRelaisHtml(doc, { signalerModifications: true });
    expect(h).toContain('id="s-annexe"');
    expect(texte(h)).toMatch(/fonctions\[ex-\d+\]\.reglages 6250A 6300A T\. TECHNICIEN, 19\/11\/2026 15:20/);
    // Rien à signaler : pas d'annexe vide.
    expect(renderPvRelaisHtml({ ...doc, modifications: [] }, { signalerModifications: true })).not.toContain(
      'id="s-annexe"',
    );
  });

  it("scripts de l'aperçu ajoutés en fin de body, dans l'ordre, attributs échappés", () => {
    const h = renderPvRelaisHtml(exemplePvDocument(), { scripts: SCRIPTS_APERCU });
    expect(h).toMatch(
      /<script src="\/vendor\/paged\.polyfill\.js"><\/script><script src="\/vendor\/paged-handlers\.js"><\/script><\/body><\/html>$/,
    );
    expect(renderPvRelaisHtml(exemplePvDocument(), { scripts: ['x" onload="alert(1)'] })).toContain(
      'src="x&quot; onload=&quot;alert(1)"',
    );
  });

  it("échappe tout texte saisi (pas d'injection HTML ou de script)", () => {
    const doc = exemplePvDocument();
    doc.donnees.generalites.lieu = '<script>alert("x")</script>';
    doc.donnees.es.points[0]!.commentaire = "<img src=x onerror=alert(1)>";
    doc.donnees.observations[0]!.observation = "a & b < c";
    doc.pv.numero = "</title><script>alert(2)</script>";
    const h = renderPvRelaisHtml(doc);
    expect(h).not.toContain("<script");
    expect(h).not.toContain("<img src=x");
    expect(h).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(h).toContain("a &amp; b &lt; c");
  });

  it("PV minimal (sans E/S, fonctions, observations ni signatures) : rendu sans erreur, messages explicites", () => {
    const h = renderPvRelaisHtml(pvMinimal());
    const t = texte(h);
    expect(t).toContain("Aucune entrée/sortie pour cet équipement.");
    expect(t).toContain("Aucune fonction de protection renseignée.");
    expect(t).toContain("Aucune observation / No comment");
    expect(t).toContain("Réserves ouvertes / open : 0 — levées / lifted : 0");
    expect(h).not.toContain('class="t es"');
    expect(t).not.toContain("Équipement :");
  });
});

describe("données d'exemple", () => {
  it("pointsEsExemple : nombre demandé, ids uniques, réserves repérées, cartes contiguës", () => {
    const pts = pointsEsExemple(128);
    expect(pts).toHaveLength(128);
    expect(new Set(pts.map((p) => p.id)).size).toBe(128);
    expect(pts.filter((p) => p.reserve).length).toBeGreaterThan(0);
    const changements = pts.filter((p, i) => i > 0 && p.carte !== pts[i - 1]!.carte).length;
    expect(changements).toBe(3);
  });
});

describe("PAGED_HANDLERS_JS", () => {
  it("est du JavaScript valide, sans dépendance de module", () => {
    expect(() => new Function(PAGED_HANDLERS_JS)).not.toThrow();
    expect(PAGED_HANDLERS_JS).not.toMatch(/\bimport\b|\brequire\(/);
  });

  it("enregistre un gestionnaire Paged.js et ne plante pas si Paged.js est absent", () => {
    const enregistres: unknown[] = [];
    class Handler {
      constructor(public chunker: unknown) {}
    }
    const window = { Paged: { Handler, registerHandlers: (...h: unknown[]) => enregistres.push(...h) } } as Record<
      string,
      unknown
    >;
    new Function("window", "console", PAGED_HANDLERS_JS)(window, console);
    expect(enregistres).toHaveLength(1);
    expect(window.__spiePagedHandlers).toBe(true);
    const avertissements: string[] = [];
    new Function("window", "console", PAGED_HANDLERS_JS)({}, { warn: (m: string) => avertissements.push(m) });
    expect(avertissements[0]).toMatch(/Paged\.js absent/);
  });
});
