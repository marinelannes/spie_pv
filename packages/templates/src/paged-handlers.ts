/**
 * Gestionnaire Paged.js : répète l'en-tête (`<thead>`, et `<colgroup>`) des tableaux coupés entre deux pages.
 * Paged.js 0.4 ne le fait pas seul. Le code est fourni sous forme de chaîne :
 * - côté serveur, il est injecté dans Chromium après la polyfill (`page.addScriptTag({ content })`) ;
 * - côté PWA (CSP `script-src 'self'`), il est écrit dans `/vendor/paged-handlers.js` et chargé juste après
 *   `/vendor/paged.polyfill.js`, en fin de `<body>` : il s'exécute avant que la polyfill ne lance le rendu
 *   (elle attend que le document soit « interactive »).
 *
 * Principe : le crochet `layout` est appelé avant chaque mesure de débordement ; on y insère l'en-tête dans les
 * tableaux de la page qui continuent un tableau commencé plus haut (`data-split-from`), donc la place qu'il occupe
 * est prise en compte dans la pagination. JavaScript simple (ES2017), sans dépendance.
 */
export const PAGED_HANDLERS_JS = String.raw`(function () {
  "use strict";
  var Paged = window.Paged;
  if (!Paged || !Paged.Handler || !Paged.registerHandlers) {
    console.warn("spie-pv : Paged.js absent, en-têtes de tableau non répétés.");
    return;
  }

  function nodeAfter(node, limiter) {
    if (limiter && node === limiter) return null;
    var after = node.nextSibling;
    var current = node;
    while (!after) {
      current = current.parentNode;
      if (!current || (limiter && current === limiter)) return null;
      after = current.nextSibling;
    }
    return after;
  }

  function closestElement(node, selector) {
    var el = node && node.nodeType === 1 ? node : node && node.parentElement;
    return el && el.closest ? el.closest(selector) : null;
  }

  class SpieRepeterEntetesTableaux extends Paged.Handler {
    constructor(chunker, polisher, caller) {
      super(chunker, polisher, caller);
    }

    layout(rendered) {
      var source = this.chunker && this.chunker.source;
      if (!source) return;
      var tables = rendered.querySelectorAll("table[data-split-from]");
      for (var i = 0; i < tables.length; i++) {
        var table = tables[i];
        if (table.getAttribute("data-spie-entete") === "1") continue;
        table.setAttribute("data-spie-entete", "1");
        if (table.querySelector(":scope > thead")) continue;
        var ref = table.getAttribute("data-split-from");
        var src = source.querySelector('table[data-ref="' + ref + '"]');
        if (!src) continue;
        var thead = src.querySelector(":scope > thead");
        if (!thead) continue;
        if (!table.querySelector(":scope > colgroup")) {
          var colgroups = src.querySelectorAll(":scope > colgroup");
          for (var c = colgroups.length - 1; c >= 0; c--) table.insertBefore(colgroups[c].cloneNode(true), table.firstChild);
        }
        var before = table.firstElementChild;
        while (before && before.tagName === "COLGROUP") before = before.nextElementSibling;
        var clone = thead.cloneNode(true);
        clone.setAttribute("data-spie-entete-repete", "1");
        table.insertBefore(clone, before);
      }
    }

    afterPageLayout(pageElement, page, breakToken) {
      // La page se termine dans un en-tête de tableau : on reprend après l'en-tête, qui sera répété.
      if (breakToken && breakToken.node) {
        var thead = closestElement(breakToken.node, "thead");
        if (thead) {
          var table = thead.parentElement;
          var after = nodeAfter(thead, table);
          if (after) {
            breakToken.node = after;
            breakToken.offset = 0;
          }
        }
      }
      // Un tableau réduit à son en-tête en bas de page est masqué (l'en-tête est repris page suivante).
      var tables = pageElement.querySelectorAll("table");
      for (var i = 0; i < tables.length; i++) {
        var t = tables[i];
        if (t.querySelector(":scope > thead") && !t.querySelector(":scope > tbody > tr")) {
          t.style.visibility = "hidden";
        }
      }
    }
  }

  Paged.registerHandlers(SpieRepeterEntetesTableaux);
  window.__spiePagedHandlers = true;
})();
`;

/**
 * Scripts de l'aperçu dans la PWA, servis en fichiers statiques (même origine) : la polyfill Paged.js
 * (copie de `pagedjs/dist/paged.polyfill.js`) puis `PAGED_HANDLERS_JS`.
 */
export const SCRIPTS_APERCU = ["/vendor/paged.polyfill.js", "/vendor/paged-handlers.js"] as const;
