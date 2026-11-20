import { FILIGRANE_SPIE } from "./assets.js";

/**
 * CSS d'impression du PV relais. Mise en page A4 du modèle Word (marges 12,7 mm, Arial), paginée par Paged.js :
 * en-tête et pied de page en éléments courants (`position: running`), « Page x sur y » par compteurs, sommaire
 * par `target-counter`. Le logo d'arrière-plan reprend le filigrane de l'en-tête Word (sphère SPIE éclaircie).
 */
export const CSS_PV_RELAIS = String.raw`
@page {
  size: A4;
  margin: 44mm 12.7mm 21mm 12.7mm;
  @top-center { content: element(entete); vertical-align: bottom; padding-bottom: 3mm; }
  @bottom-center { content: element(pied); vertical-align: top; padding-top: 2mm; }
}

:root {
  --trait: #222;
  --fond-titre: #dfe6f1;
  --fond-groupe: #eef1f6;
  --bleu: #0b2f6b;
  --rouge: #c0001a;
}

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: Arial, "Liberation Sans", Helvetica, sans-serif;
  font-size: 8.5pt;
  line-height: 1.25;
  color: #000;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

/* Arrière-plan de chaque page (Paged.js), comme le filigrane de l'en-tête Word. */
.pagedjs_page .pagedjs_sheet {
  background-image: url("${FILIGRANE_SPIE}");
  background-repeat: no-repeat;
  background-position: 8mm 30mm;
  background-size: 142mm 205mm;
}

/* ---------- En-tête et pied (éléments courants) ---------- */
.entete { position: running(entete); width: 100%; }
.pied { position: running(pied); width: 100%; }
.pagedjs_margin-top-center, .pagedjs_margin-bottom-center { width: 100%; }
.pagedjs_margin-top-center > .pagedjs_margin-content, .pagedjs_margin-bottom-center > .pagedjs_margin-content { width: 100%; }

.entete table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.entete td { border: 0.75pt solid var(--trait); padding: 1mm 1.5mm; vertical-align: middle; }
.entete .logo { width: 34mm; text-align: center; }
.entete .logo img { width: 29mm; height: auto; display: block; margin: 0 auto; }
.entete .titre { text-align: center; font-weight: bold; font-size: 11pt; color: var(--bleu); }
.entete .titre .en { display: block; font-size: 9.5pt; font-style: italic; color: #333; margin-top: 1mm; }
.entete .droite { width: 52mm; font-size: 8pt; }
.entete .droite strong { font-size: 9pt; }
.entete .statuts { white-space: nowrap; }
.entete .legende { font-size: 6.5pt; text-align: center; margin-top: 0.8mm; color: #333; }
.entete .apercu-bandeau {
  margin-top: 1mm; text-align: center; font-weight: bold; color: #fff; background: var(--rouge);
  font-size: 8.5pt; padding: 0.6mm 0; letter-spacing: 0.5pt;
}

.case {
  display: inline-block; width: 3.2mm; height: 3.2mm; border: 0.75pt solid #000; vertical-align: -0.5mm;
  margin: 0 0.8mm 0 2.5mm; text-align: center; line-height: 2.8mm; font-size: 7pt; font-weight: bold;
}
.statuts > span + span { margin-left: 3mm; }
.statuts .case { margin-left: 0; }
.nowrap { white-space: nowrap; }
.case.coche::before { content: "X"; }

.pied { text-align: center; font-size: 7pt; color: #222; }
.pied .page-num { font-size: 8pt; font-weight: bold; }
.pied .page-num::after { content: "Page " counter(page) " sur " counter(pages); }
.pied .pv-num { float: right; font-size: 6.5pt; color: #444; }
.pied p { margin: 0.4mm 0; }

/* ---------- Mise en page générale ---------- */
.saut-avant { break-before: page; }
h1 {
  font-size: 10.5pt; font-weight: bold; text-transform: uppercase; margin: 5mm 0 2.5mm; padding: 1mm 1.5mm;
  background: var(--fond-titre); border-left: 2mm solid var(--bleu); break-after: avoid;
}
h1 .num { margin-right: 2mm; }
h2 { font-size: 9.5pt; font-weight: bold; margin: 4mm 0 2mm; break-after: avoid; }
h3 { font-size: 9pt; font-weight: bold; margin: 3mm 0 1.5mm; break-after: avoid; }
h2 .num, h3 .num { margin-right: 2mm; }
p { margin: 1mm 0; }
.en { font-style: italic; color: #333; }
.note { font-size: 7.5pt; color: #222; margin: 1mm 0 2mm; }
.vide { color: #666; font-style: italic; }

table.t { width: 100%; border-collapse: collapse; margin: 1mm 0 3mm; }
table.t th, table.t td { border: 0.75pt solid var(--trait); padding: 0.8mm 1.2mm; vertical-align: middle; }
table.t thead th, table.t th.entete-ligne { background: var(--fond-titre); font-weight: bold; text-align: center; }
table.t tr { break-inside: avoid; }
/* Petits tableaux et sous-sections gardés sur une seule page. */
.insecable { break-inside: avoid; }
table.t td.c, table.t th.c { text-align: center; }
table.t td.j { text-align: center; font-weight: bold; width: 11mm; }
table.t td.j.nc { color: var(--rouge); }
table.t .libelle { font-weight: bold; }
table.bilingue td { width: 50%; vertical-align: top; }
table.ident td:first-child { width: 45%; font-weight: bold; background: #f6f7f9; }

/* Page de garde */
.garde { padding-top: 6mm; }
.garde .bloc-client { border: 0.75pt solid var(--trait); padding: 3mm 4mm; font-size: 10pt; margin-bottom: 8mm; }
.garde .bloc-client p { margin: 1.5mm 0; }
.garde .bloc-client .lib { display: inline-block; min-width: 42mm; font-weight: bold; }
.garde .titre-garde { text-align: center; font-size: 15pt; font-weight: bold; color: var(--bleu); margin: 18mm 0 4mm; }
.garde .titre-garde .en { display: block; font-size: 11pt; margin-top: 2mm; }
.garde .equipement { text-align: center; font-size: 11pt; margin-bottom: 20mm; }
table.revisions td, table.revisions th { height: 6.5mm; font-size: 8pt; }
table.revisions th { background: var(--fond-titre); }

/* Sommaire */
.sommaire h1 { text-align: center; border-left: 0; }
.sommaire ol { list-style: none; margin: 0; padding: 0; }
.sommaire li { margin: 1.4mm 0; }
.sommaire li.n2 { margin-left: 8mm; }
.sommaire li.n1 { font-weight: bold; margin-top: 2.5mm; }
.sommaire a { color: #000; text-decoration: none; display: flex; align-items: baseline; }
.sommaire a .num { min-width: 12mm; }
.sommaire a .points { flex: 1; border-bottom: 0.75pt dotted #555; margin: 0 1.5mm; }
.sommaire a::after { content: target-counter(attr(href), page); min-width: 7mm; text-align: right; }

/* Circuits de mesure */
.schema { text-align: center; margin: 2mm 0 3mm; break-inside: avoid; }
.schema img { width: 85mm; height: auto; }

/* E/S */
table.es { font-size: 7pt; table-layout: fixed; }
table.es th { font-size: 6.8pt; }
table.es td { padding: 0.6mm 0.9mm; word-wrap: break-word; overflow-wrap: anywhere; }
table.es tr.groupe th {
  background: var(--fond-groupe); text-align: left; font-size: 7.5pt; padding: 0.8mm 1.5mm;
}
table.es tr.reserve td { color: #555; }
table.es .tag-reserve {
  display: inline-block; border: 0.5pt solid #777; border-radius: 1mm; padding: 0 0.8mm; margin-left: 1mm;
  font-size: 6pt; font-weight: bold; color: #444;
}
.avancement { font-size: 8pt; margin: 1mm 0 2mm; }
table.leds td { font-size: 7.5pt; }
table.leds td.sep { border-top: 0; border-bottom: 0; width: 4mm; background: transparent; }

/* Plan de protection */
.fonction { break-inside: avoid; margin-bottom: 4mm; }
.fonction table.t { margin: 0; }
.fonction table.t + table.t { border-top: 0; }
.fonction table.t + table.t tr:first-child td, .fonction table.t + table.t tr:first-child th { border-top: 0; }
.fonction .nom-logique { font-weight: bold; font-size: 9.5pt; color: var(--bleu); text-align: center; }
.fonction .titre-fonction { font-weight: bold; font-size: 9pt; }
.fonction td, .fonction th { font-size: 7.8pt; }
.fonction th { background: var(--fond-titre); text-align: center; font-weight: bold; }
.fonction td.lib-ligne { font-weight: bold; width: 16mm; }

/* Observations et conclusion */
.recap { font-weight: bold; margin: 1mm 0 3mm; }
.conclusion-materiel { border: 0.75pt solid var(--trait); padding: 3mm; font-size: 10pt; font-weight: bold; margin: 2mm 0 5mm; }
.conclusion-materiel .case { margin-left: 8mm; }
table.signatures td, table.signatures th { height: 9mm; }
table.signatures th.entete-ligne { width: 34mm; text-align: left; }
table.signatures td.visa { height: 30mm; text-align: center; }
table.signatures td.visa img { max-height: 27mm; max-width: 70mm; }
table.signatures td.commentaires { height: 18mm; vertical-align: top; }
.refus { color: var(--rouge); font-weight: bold; }
.empreinte {
  margin-top: 6mm; border-top: 0.75pt solid #555; padding-top: 2mm; font-size: 7pt; color: #222;
  break-inside: avoid;
}
.empreinte code { font-family: "Courier New", "Liberation Mono", monospace; font-size: 7pt; word-break: break-all; }

/* Annexe : valeurs pré-remplies modifiées */
table.modifs td { font-size: 7.5pt; vertical-align: top; }
table.modifs td.chemin { font-family: "Courier New", "Liberation Mono", monospace; font-size: 6.8pt; word-break: break-all; }

/* Aperçu non signé : filigrane diagonal sur chaque page. */
.apercu .pagedjs_page .pagedjs_sheet::after {
  content: "APERÇU — NON SIGNÉ"; position: absolute; top: 45%; left: 0; right: 0; text-align: center;
  transform: rotate(-35deg); font-size: 44pt; font-weight: bold; color: rgba(192, 0, 26, 0.12);
  pointer-events: none; white-space: nowrap;
}
.pagedjs_page .pagedjs_sheet { position: relative; }

/* Aperçu à l'écran (tablette) : pages séparées sur fond gris. */
@media screen {
  body { background: #e5e7eb; }
  .pagedjs_pages { padding: 6mm 0; }
  .pagedjs_page { background: #fff; margin: 0 auto 6mm; box-shadow: 0 1mm 4mm rgba(0, 0, 0, 0.25); }
}
`;
