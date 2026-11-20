import {
  ajouterObservation,
  creerPvRelais,
  nouvelleFonction,
  pointsEsDepuisListe,
  type PvRelaisData,
  type SectionRelaisId,
} from "@spie/shared";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useCallback, useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completer, donneesPreparees } from "../../test/fixtures";
import {
  EditeurContext,
  deplacerItem,
  estCorrige,
  formatNombre,
  majItem,
  parseNombre,
  retirerItem,
  type MajPv,
  type ModeEditeur,
} from "./context";
import { ChampNombre, ChoixBoutons, JugementBoutons, textePhaseur } from "./fields";
import { NcPanel } from "./NcPanel";
import { ListeManquants, PvEditor, SECTIONS_EDITABLES, estSectionEditable, manquesParSection } from "./PvEditor";
import { lignesEs } from "./sections/es";
import { copierFonction, libelleInjection } from "./sections/protection";

const TRACE = () => ({ par: "Théo", le: "2026-11-19T10:00:00.000Z" });

/** Éditeur contrôlé, comme les pages : état local + mise à jour fonctionnelle. */
function Harnais({
  initial,
  mode = "saisie",
  lectureSeule = false,
  section = "generalites",
  preparees = null,
  onData,
}: {
  initial: PvRelaisData;
  mode?: ModeEditeur;
  lectureSeule?: boolean;
  section?: SectionRelaisId;
  preparees?: PvRelaisData | null;
  onData?: (d: PvRelaisData) => void;
}) {
  const [d, setD] = useState(initial);
  const [s, setS] = useState<SectionRelaisId>(section);
  const maj: MajPv = useCallback(
    (fn) =>
      setD((x) => {
        const n = fn(x);
        onData?.(n);
        return n;
      }),
    [onData],
  );
  return (
    <PvEditor
      donnees={d}
      preparees={preparees}
      mode={mode}
      lectureSeule={lectureSeule}
      onChange={maj}
      trace={TRACE}
      section={s}
      onSection={setS}
    />
  );
}

function Contexte({
  children,
  d = donneesPreparees(),
  lectureSeule = false,
  maj = vi.fn(),
}: {
  children: ReactNode;
  d?: PvRelaisData;
  lectureSeule?: boolean;
  maj?: MajPv;
}) {
  return (
    <EditeurContext value={{ donnees: d, preparees: null, maj, mode: "saisie", lectureSeule, trace: TRACE }}>
      {children}
    </EditeurContext>
  );
}

describe("utilitaires de l'éditeur", () => {
  const liste = [
    { id: "a", v: 1 },
    { id: "b", v: 2 },
    { id: "c", v: 3 },
  ];
  it("majItem, retirerItem, deplacerItem", () => {
    expect(majItem(liste, "b", { v: 9 }).map((x) => x.v)).toEqual([1, 9, 3]);
    expect(retirerItem(liste, "a").map((x) => x.id)).toEqual(["b", "c"]);
    expect(deplacerItem(liste, "b", -1).map((x) => x.id)).toEqual(["b", "a", "c"]);
    expect(deplacerItem(liste, "c", 1).map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(deplacerItem(liste, "x", 1).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("estCorrige : seulement une valeur préparée non vide et différente", () => {
    expect(estCorrige("6250A", "6300A")).toBe(true);
    expect(estCorrige("6250A", "6250A")).toBe(false);
    expect(estCorrige("", "x")).toBe(false);
    expect(estCorrige(null, "x")).toBe(false);
    expect(estCorrige({ amplitude: 1, angle: 0 }, { amplitude: 1, angle: 0 })).toBe(false);
    expect(estCorrige({ amplitude: 1, angle: 0 }, { amplitude: 2, angle: 0 })).toBe(true);
  });

  it("parseNombre accepte la virgule, signale l'invalide, vide = null", () => {
    expect(parseNombre("57,74")).toBe(57.74);
    expect(parseNombre(" -120 ")).toBe(-120);
    expect(parseNombre("+120")).toBe(120);
    expect(parseNombre(".5")).toBe(0.5);
    expect(parseNombre("1 250")).toBe(1250);
    expect(parseNombre("")).toBeNull();
    expect(parseNombre("12a")).toBeUndefined();
    expect(parseNombre("-")).toBeUndefined();
    expect(parseNombre("1,2,3")).toBeUndefined();
  });

  it("formatNombre et textePhaseur", () => {
    expect(formatNombre(57.74)).toBe("57,74");
    expect(formatNombre(null)).toBe("");
    expect(textePhaseur({ amplitude: 57.74, angle: -120 }, "V")).toBe("57,74 V -120°");
    expect(textePhaseur({ amplitude: 1, angle: 120 }, "A")).toBe("1 A +120°");
    expect(textePhaseur({ amplitude: null, angle: null }, "A")).toBe("—");
  });

  it("copierFonction : nouveaux identifiants, réglages gardés, constats vidés", () => {
    let n = 0;
    const ids = () => `x${++n}`;
    const f = {
      ...nouvelleFonction(ids),
      nomLogique: "PHPTOC1",
      reglages: "6250A",
      leds: { attendu: "LED C", constate: "LED C" },
    };
    f.tempsMesures[0]!.declenchement = "216 ms";
    const c = copierFonction(f, ids);
    expect(c.id).not.toBe(f.id);
    expect(c).toMatchObject({ nomLogique: "PHPTOC1", reglages: "6250A", leds: { attendu: "LED C", constate: "" } });
    expect(c.tempsMesures[0]!.declenchement).toBe("");
    const tous = [
      c.id,
      ...c.injections.flatMap((g) => [g.id, ...g.lignes.map((l) => l.id)]),
      ...c.tempsMesures.map((t) => t.id),
    ];
    const origine = new Set([
      f.id,
      ...f.injections.flatMap((g) => [g.id, ...g.lignes.map((l) => l.id)]),
      ...f.tempsMesures.map((t) => t.id),
    ]);
    expect(tous.some((id) => origine.has(id))).toBe(false);
  });

  it("manquesParSection et estSectionEditable", () => {
    expect(
      manquesParSection([
        { ref: "a", section: "es", message: "", bloquant: true },
        { ref: "b", section: "es", message: "", bloquant: true },
        { ref: "c", section: "protection", message: "", bloquant: false },
      ]),
    ).toEqual({ es: 2 });
    expect(estSectionEditable("es")).toBe(true);
    expect(estSectionEditable("introduction")).toBe(false);
    expect(estSectionEditable(null)).toBe(false);
  });

  it("lignesEs : en-têtes de carte puis E/S filtrées", () => {
    const pts = donneesPreparees().es.points;
    expect(
      lignesEs(pts, "toutes", "").map((l) => (l.kind === "carte" ? `#${l.carte}:${l.nb}` : l.point.adresse)),
    ).toEqual(["#RPN_HTB / PS050:2", "BI 1.01", "BI 1.02"]);
    expect(lignesEs(pts, "non_testees", "")).toHaveLength(2);
    expect(lignesEs(pts, "toutes", "introuvable")).toEqual([]);
  });
});

describe("ChoixBoutons et JugementBoutons", () => {
  it("sélectionne, puis efface au second appui", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ChoixBoutons label="Test" valeur={null} options={["C", "NC", "NA"] as const} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "NC" }));
    expect(onChange).toHaveBeenLastCalledWith("NC");
    rerender(<ChoixBoutons label="Test" valeur="NC" options={["C", "NC", "NA"] as const} onChange={onChange} />);
    expect(screen.getByRole("radio", { name: "NC" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "NC" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("JugementBoutons est désactivé en lecture seule et peut exclure NA", () => {
    render(
      <Contexte lectureSeule>
        <JugementBoutons label="SCADA" valeur={null} onChange={vi.fn()} sansNa />
      </Contexte>,
    );
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["C", "NC"]);
    expect(radios.every((r) => (r as HTMLButtonElement).disabled)).toBe(true);
  });
});

describe("ChampNombre (pavé numérique)", () => {
  it("convertit la virgule décimale et garde un texte invalide sans changer la valeur", () => {
    const onChange = vi.fn();
    render(
      <Contexte>
        <ChampNombre label="Amplitude" valeur={null} onChange={onChange} unite="V" />
      </Contexte>,
    );
    const input = screen.getByLabelText("Amplitude") as HTMLInputElement;
    expect(input.inputMode).toBe("decimal");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "57,7" } });
    expect(onChange).toHaveBeenLastCalledWith(57.7);
    fireEvent.change(input, { target: { value: "57,7x" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("texte invalide en quittant le champ : conservé, avec un message (jamais effacé en silence)", () => {
    const onChange = vi.fn();
    render(
      <Contexte>
        <ChampNombre label="Amplitude" valeur={57.7} onChange={onChange} unite="V" />
      </Contexte>,
    );
    const input = screen.getByLabelText("Amplitude") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "5x" } });
    expect(screen.queryByRole("alert")).toBeNull(); // pas de message pendant la frappe
    fireEvent.blur(input);
    expect(input.value).toBe("5x");
    expect(screen.getByRole("alert").textContent).toBe("Nombre attendu (ex. 57,7) : valeur enregistrée « 57,7 ».");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "58" } });
    expect(onChange).toHaveBeenLastCalledWith(58);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("libelleInjection (anomalie 23)", () => {
  it("jamais d'espace en tête ni de partie vide", () => {
    const g = { titreFr: "Injection 1" };
    expect(libelleInjection({ nomLogique: "PHPTOC1", libelleFr: "" }, g, { libelle: "Ia" }, 0, "amplitude")).toBe(
      "PHPTOC1 — Injection 1 — Ia — amplitude",
    );
    const vide = libelleInjection({ nomLogique: "", libelleFr: "" }, g, { libelle: " " }, 1, "angle");
    expect(vide).toBe("Fonction — Injection 1 — ligne 2 — angle");
    expect(vide).not.toMatch(/^\s|\s{2}/);
    expect(
      libelleInjection(
        { nomLogique: "", libelleFr: "Maximum de courant" },
        { titreFr: "" },
        { libelle: "Ia" },
        0,
        "unité",
      ),
    ).toBe("Maximum de courant — Ia — unité");
  });
});

describe("section 9 : TP / TC et injections (anomalie 14)", () => {
  it("libellés visibles et exemples sur les champs TP / TC ; injections en tableau tension / courant", () => {
    render(<Harnais initial={donneesPreparees()} section="mesures" mode="preparation" />);
    expect(screen.getAllByText("Rapport").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Classe").length).toBeGreaterThan(0);
    const rapport = screen.getAllByLabelText(/— rapport$/)[0] as HTMLInputElement;
    expect(rapport.placeholder).toBe("ex. 20000/100 V");
    expect(screen.getAllByText("Tension (V, °)").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Courant (A, °)").length).toBeGreaterThan(0);
  });
});

describe("liste des E/S", () => {
  // jsdom ne calcule pas la mise en page : on donne une hauteur à la zone de défilement de la liste virtualisée
  // (clientHeight) et aux lignes mesurées (offsetHeight).
  const proto = HTMLElement.prototype;
  const origine = {
    clientHeight: Object.getOwnPropertyDescriptor(proto, "clientHeight"),
    clientWidth: Object.getOwnPropertyDescriptor(proto, "clientWidth"),
    offsetHeight: Object.getOwnPropertyDescriptor(proto, "offsetHeight"),
  };
  beforeEach(() => {
    Object.defineProperty(proto, "clientHeight", { configurable: true, get: () => 800 });
    Object.defineProperty(proto, "clientWidth", { configurable: true, get: () => 900 });
    Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 60 });
  });
  afterEach(() => {
    for (const [k, d] of Object.entries(origine)) {
      if (d) Object.defineProperty(proto, k, d);
      else delete (proto as unknown as Record<string, unknown>)[k];
    }
  });

  it("compteur, filtres, recherche et saisie horodatée", () => {
    const d = donneesPreparees();
    const onData = vi.fn();
    render(<Harnais initial={d} section="es" onData={onData} />);
    expect(screen.getByTestId("compteur-es").textContent).toContain("1 / 2");
    const liste = screen.getByTestId("liste-es");
    expect(within(liste).getByText("BI 1.01")).toBeTruthy();

    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "BI 1.01 testé / validé" })).getByRole("radio", { name: "C" }),
    );
    const n = onData.mock.lastCall![0] as PvRelaisData;
    expect(n.es.points[0]).toMatchObject({ teste: "C", saisie: { par: "Théo", le: "2026-11-19T10:00:00.000Z" } });
    expect(screen.getByTestId("compteur-es").textContent).toContain("2 / 2");

    fireEvent.click(screen.getByRole("button", { name: "Réserves" }));
    expect(within(liste).queryByText("BI 1.01")).toBeNull();
    expect(within(liste).getByText("BI 1.02")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Toutes" }));
    fireEvent.change(screen.getByLabelText(/Rechercher une E\/S/), { target: { value: "disj" } });
    expect(within(liste).getByText("BI 1.01")).toBeTruthy();
    expect(within(liste).queryByText("BI 1.02")).toBeNull();
  });

  it("une E/S NC peut être transformée en réserve", () => {
    const d = donneesPreparees();
    d.es.points[0] = { ...d.es.points[0]!, teste: "NC", commentaire: "Pas de remontée" };
    const onData = vi.fn();
    render(<Harnais initial={d} section="es" onData={onData} />);
    fireEvent.click(screen.getByRole("button", { name: "Créer une réserve" }));
    const n = onData.mock.lastCall![0] as PvRelaisData;
    expect(n.reserves[0]).toMatchObject({ numero: 1, ref: `es.${d.es.points[0].id}`, description: "Pas de remontée" });
    expect(screen.getByRole("button", { name: "Réserve créée" })).toBeTruthy();
  });

  it("E/S NC sans commentaire : pas de réserve en un geste, le commentaire est demandé", () => {
    const d = donneesPreparees();
    d.es.points[0] = { ...d.es.points[0]!, teste: "NC", commentaire: "" };
    const onData = vi.fn();
    render(<Harnais initial={d} section="es" onData={onData} />);
    const bouton = screen.getByRole("button", { name: "Créer une réserve" }) as HTMLButtonElement;
    expect(bouton.disabled).toBe(true);
    expect(screen.getByText(/décrivez la non-conformité dans le commentaire/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("BI 1.01 commentaire"), { target: { value: "Pas de remontée" } });
    expect((screen.getByRole("button", { name: "Créer une réserve" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Créer une réserve" }));
    const n = onData.mock.lastCall![0] as PvRelaisData;
    expect(n.observations[0]).toMatchObject({ observation: "Pas de remontée", reserveNumero: 1 });
  });

  it("sans E/S : message explicite", () => {
    const d = creerPvRelais({
      affaire: { numero: "A1", client: "", projet: "", valideParDefaut: "", approuveParDefaut: "" },
      date: "2026-11-19",
    });
    render(<Harnais initial={d} section="es" />);
    expect(screen.getByText(/Aucune E\/S/)).toBeTruthy();
  });
});

describe("NcPanel", () => {
  it("ajoute une observation liée, et une réserve en un geste", () => {
    const onData = vi.fn();
    const d = donneesPreparees();
    d.testsPreliminaires[0] = { ...d.testsPreliminaires[0]!, jugement: "NC" };
    render(<Harnais initial={d} section="tests" onData={onData} />);
    const zone = screen.getByLabelText(/Observation pour Mesure de la tension/);
    fireEvent.change(zone, { target: { value: "110 V au lieu de 125 V" } });
    fireEvent.click(screen.getByRole("button", { name: "Ajouter et créer une réserve" }));
    const n = onData.mock.lastCall![0] as PvRelaisData;
    expect(n.observations[0]).toMatchObject({
      ref: "tests.tension-aux",
      jugement: "NC",
      observation: "110 V au lieu de 125 V",
      reserveNumero: 1,
    });
    expect(screen.getByText(/réserve n°1/)).toBeTruthy();
  });

  it("section Observations : supprimer une réserve (l'observation reste), puis une observation avec sa réserve", () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    const onData = vi.fn();
    let d = donneesPreparees();
    for (const libelle of ["Contrôle A", "Contrôle B"]) {
      d = ajouterObservation(d, { ref: null, libelle, jugement: "NC", observation: `Constat ${libelle}`, reserve: {} });
    }
    d = ajouterObservation(d, { ref: null, libelle: "Contrôle C", jugement: "NC", observation: "" });
    render(<Harnais initial={d} section="observations" onData={onData} />);

    // Observation vide : pas de transformation en réserve.
    const transformer = screen.getAllByRole("button", { name: "Transformer en réserve" });
    expect(transformer.map((b) => (b as HTMLButtonElement).disabled)).toEqual([true]);

    fireEvent.click(screen.getAllByRole("button", { name: "Supprimer la réserve" })[0]!);
    expect(confirm).toHaveBeenLastCalledWith(
      "Supprimer la réserve n°1 ? L'observation n°1 est conservée, sans réserve.",
    );
    let n = onData.mock.lastCall![0] as PvRelaisData;
    expect(n.reserves.map((r) => [r.numero, r.controle])).toEqual([[1, "Contrôle B"]]);
    expect(n.observations.map((o) => o.reserveNumero)).toEqual([null, 1, null]);

    fireEvent.click(screen.getAllByRole("button", { name: "Supprimer" })[1]!);
    expect(confirm).toHaveBeenLastCalledWith("Supprimer l'observation n°2 et la réserve n°1 qui lui est liée ?");
    n = onData.mock.lastCall![0] as PvRelaisData;
    expect(n.reserves).toEqual([]);
    expect(n.observations.map((o) => [o.numero, o.libelle])).toEqual([
      [1, "Contrôle A"],
      [2, "Contrôle C"],
    ]);

    // Refus de la confirmation : rien ne change.
    confirm.mockReturnValue(false);
    const appels = onData.mock.calls.length;
    fireEvent.click(screen.getAllByRole("button", { name: "Supprimer" })[0]!);
    expect(onData.mock.calls.length).toBe(appels);
    vi.unstubAllGlobals();
  });

  it("n'apparaît pas en mode préparation", () => {
    render(
      <EditeurContext
        value={{
          donnees: donneesPreparees(),
          preparees: null,
          maj: vi.fn(),
          mode: "preparation",
          lectureSeule: false,
          trace: TRACE,
        }}
      >
        <NcPanel refControle="x" libelle="X" />
      </EditeurContext>,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("ListeManquants", () => {
  it("regroupe par section et permet d'y aller", () => {
    const onAller = vi.fn();
    render(
      <ListeManquants
        manquants={[
          { ref: "a", section: "es", message: "E/S non testée : BI 1.01", bloquant: true },
          { ref: "b", section: "protection", message: "Temps mesurés non renseignés : PHPTOC1.", bloquant: false },
        ]}
        onAller={onAller}
      />,
    );
    expect(screen.getByText("1 point(s) à compléter avant la signature, 1 avertissement(s)")).toBeTruthy();
    expect(screen.getByText("10. Affectation cartes E/S (1)")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Aller à la section" })[0]!);
    expect(onAller).toHaveBeenCalledWith("es");
  });

  it("indique qu'un PV complet peut être signé", () => {
    render(<ListeManquants manquants={[]} onAller={vi.fn()} />);
    expect(screen.getByText(/peut être signé/)).toBeTruthy();
  });
});

describe("PvEditor", () => {
  it.each(SECTIONS_EDITABLES.map((s) => s.id))("affiche la section %s en saisie et en préparation", (id) => {
    const d = completer(donneesPreparees());
    d.fonctions = [{ ...nouvelleFonction(), nomLogique: "PHPTOC1" }];
    d.observations = [
      { id: "o1", numero: 1, ref: null, libelle: "Visuel", jugement: "C", reserveNumero: null, observation: "RAS" },
    ];
    const { unmount } = render(<Harnais initial={d} section={id} />);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toContain(
      SECTIONS_EDITABLES.find((s) => s.id === id)!.titreFr,
    );
    unmount();
    render(<Harnais initial={d} section={id} mode="preparation" />);
    expect(screen.queryAllByRole("radio", { name: /^C$/ }).length).toBe(0); // pas de jugement au bureau
  });

  it("repère une valeur préparée corrigée sur site et navigue entre sections", () => {
    const prep = donneesPreparees();
    const site = { ...prep, generalites: { ...prep.generalites, lieu: "Poste GAU11 bis" } };
    render(<Harnais initial={site} preparees={prep} section="generalites" />);
    expect(screen.getByText("Corrigé sur site — préparé : « Poste GAU11 »")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Matériel de test →/ }));
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("4. Matériel de test");
  });

  it("les pastilles de navigation comptent ce qui manque", () => {
    render(<Harnais initial={donneesPreparees()} section="generalites" />);
    const nav = screen.getByRole("navigation", { name: "Sections du PV" });
    expect(within(nav).getAllByLabelText(/à compléter/).length).toBeGreaterThan(3);
  });

  it("tablette en portrait : grille à une colonne compressible, la section courante défile dans la barre", () => {
    const vue = vi.fn();
    const avant = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
    Element.prototype.scrollIntoView = vue;
    try {
      render(<Harnais initial={donneesPreparees()} section="generalites" />);
      const nav = screen.getByRole("navigation", { name: "Sections du PV" });
      // Sans grid-cols-1, la colonne implicite prend la largeur de toute la barre des sections (anomalie corrigée).
      expect(nav.parentElement!.className).toMatch(/(^| )grid-cols-1( |$)/);
      expect(nav.className).toMatch(/(^| )min-w-0( |$)/);
      vue.mockClear();
      fireEvent.click(within(nav).getByRole("button", { name: /Affectation cartes E\/S/ }));
      expect(vue).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
      expect(vue.mock.contexts.at(-1)).toBe(within(nav).getByRole("button", { current: "step" }));
    } finally {
      if (avant) Object.defineProperty(Element.prototype, "scrollIntoView", avant);
      else delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });

  it("en lecture seule, les champs sont désactivés", () => {
    render(<Harnais initial={donneesPreparees()} section="generalites" lectureSeule />);
    expect((screen.getByLabelText("Lieu des tests") as HTMLInputElement).disabled).toBe(true);
  });

  it("saisie d'un relevé et d'une fonction ajoutée", () => {
    const onData = vi.fn();
    render(<Harnais initial={donneesPreparees()} section="protection" onData={onData} />);
    fireEvent.click(screen.getByRole("button", { name: "Ajouter une fonction de protection" }));
    fireEvent.change(screen.getByLabelText("Nom logique (ex. PHPTOC1)"), { target: { value: "PHPTOC1" } });
    expect((onData.mock.lastCall![0] as PvRelaisData).fonctions[0]!.nomLogique).toBe("PHPTOC1");
    expect(pointsEsDepuisListe([])).toEqual([]);
  });
});
