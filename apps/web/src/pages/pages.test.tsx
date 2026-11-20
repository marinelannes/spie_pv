import type { AuthUser, EquipementDto, IoImportAnalyseDto, ListeEsDetailDto, PvResumeDto } from "@spie/shared";
import { exemplePvDocument } from "@spie/templates";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RequireAuth } from "../components/Layout";
import { BadgePvLocal, BadgesDepots, LiensSharePoint } from "../components/statuts";
import { TemporaryPassword } from "../components/ui";
import { lienSharePoint } from "../lib/sharepoint";
import { AuthProvider } from "../lib/auth";
import { saveLastUser } from "../lib/last-user";
import { htmlApercu } from "../pv/Apercu";
import { RapportAnomalies, associationsAEnvoyer, choixInitiaux, rapportAJour } from "./prep/IoImportPage";
import { IoListePage } from "./prep/IoListePage";
import { ciblesDuplication } from "./prep/PvPrepPage";
import { detailsLisibles } from "./admin/AuditPage";
import { optionsSansAffaire, querySuivi } from "./prep/SuiviPage";

const TECH: AuthUser = {
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

function app(path: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/connexion" element={<p>Page de connexion</p>} />
            <Route element={<RequireAuth />}>
              <Route path="/" element={<p>Mes affaires</p>} />
              <Route element={<RequireAuth roles={["preparateur", "admin"]} />}>
                <Route path="/preparation" element={<p>Préparation</p>} />
              </Route>
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const session = (user: AuthUser) => ({ accessToken: "t", expiresIn: 900, user });

describe("RequireAuth et repli hors ligne (spec §7.2)", () => {
  it("serveur injoignable : le dernier utilisateur accède à la saisie", async () => {
    saveLastUser(TECH);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))),
    );
    app("/");
    expect(await screen.findByText("Mes affaires")).toBeTruthy();
  });

  it("serveur injoignable : pas de back-office hors ligne", async () => {
    saveLastUser({ ...TECH, role: "preparateur" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))),
    );
    app("/preparation");
    expect(await screen.findByText("Indisponible hors ligne")).toBeTruthy();
  });

  it("serveur injoignable sans utilisateur connu : écran « Serveur injoignable »", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))),
    );
    app("/");
    expect(await screen.findByText("Serveur injoignable")).toBeTruthy();
  });

  it("session expirée en ligne : page de connexion", async () => {
    saveLastUser(TECH);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ error: { code: "unauthorized", message: "x" } }), { status: 401 }),
      ),
    );
    app("/");
    expect(await screen.findByText("Page de connexion")).toBeTruthy();
  });

  it("garde de rôle : un technicien connecté est renvoyé à l'accueil", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(session(TECH)), { status: 200 })),
    );
    app("/preparation");
    expect(await screen.findByText("Mes affaires")).toBeTruthy();
  });

  it("un préparateur connecté accède à la préparation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(session({ ...TECH, role: "preparateur" })), { status: 200 })),
    );
    app("/preparation");
    expect(await screen.findByText("Préparation")).toBeTruthy();
  });
});

const ANALYSE: IoImportAnalyseDto = {
  fichier: "GAU11.xlsx",
  reference: "GAU11_AUT_009",
  revision: "B",
  numeroAffaire: "A35173",
  feuilles: [
    { nom: "TYPE BATTERIE", titre: "", nbPoints: 33, nbReserves: 2, groupesTag: [] },
    {
      nom: "HTB_TR1",
      titre: "",
      nbPoints: 128,
      nbReserves: 27,
      groupesTag: ["PROTECTION TRANSFO DIF.", "PROTECTION TRANSFO BOBINE POINT NEUTRE"],
    },
  ],
  equipements: [
    {
      ligne: 9,
      libelle: "DEPART F1",
      niveauTension: "HTA",
      typeCellule: "TYPE BATTERIE",
      tag: "RPN_HTA_F1",
      equipement: "",
      modele: "",
      local: "",
      tagArmoire: "",
      referenceConstructeur: "",
      association: { tag: "RPN_HTA_F1", feuille: "TYPE BATTERIE", filtreTag: null, mode: "auto" },
    },
    {
      ligne: 18,
      libelle: "BOBINE POINT NEUTRE",
      niveauTension: "HTB",
      typeCellule: "HTB",
      tag: "RPN_HTB_MCN_TR",
      equipement: "",
      modele: "",
      local: "",
      tagArmoire: "",
      referenceConstructeur: "",
      association: { tag: "RPN_HTB_MCN_TR", feuille: null, filtreTag: null, mode: "aucune" },
    },
  ],
  anomalies: [
    {
      code: "equipement_sans_feuille",
      severite: "avertissement",
      feuille: null,
      ligne: 18,
      message: "RPN_HTB_MCN_TR sans feuille.",
    },
    { code: "affaire_differente", severite: "erreur", feuille: "REV", ligne: 4, message: "Affaire différente." },
    {
      code: "feuille_multi_equipements",
      severite: "info",
      feuille: "HTB_TR1",
      ligne: null,
      message: "Plusieurs équipements.",
    },
  ],
  bloquant: true,
};

describe("import de liste E/S", () => {
  it("choixInitiaux reprend la proposition ; associationsAEnvoyer valide feuille et filtre", () => {
    const choix = choixInitiaux(ANALYSE);
    expect(choix).toEqual({
      RPN_HTA_F1: { feuille: "TYPE BATTERIE", filtreTag: null },
      RPN_HTB_MCN_TR: { feuille: null, filtreTag: null },
    });
    choix.RPN_HTB_MCN_TR = { feuille: "HTB_TR1", filtreTag: "PROTECTION TRANSFO BOBINE POINT NEUTRE" };
    choix.RPN_HTA_F1 = { feuille: "TYPE BATTERIE", filtreTag: "inexistant" };
    expect(associationsAEnvoyer(ANALYSE, choix)).toEqual([
      { tag: "RPN_HTA_F1", feuille: "TYPE BATTERIE", filtreTag: null },
      { tag: "RPN_HTB_MCN_TR", feuille: "HTB_TR1", filtreTag: "PROTECTION TRANSFO BOBINE POINT NEUTRE" },
    ]);
    expect(associationsAEnvoyer(ANALYSE, { RPN_HTA_F1: { feuille: "inconnue", filtreTag: null } })[0]).toEqual({
      tag: "RPN_HTA_F1",
      feuille: null,
      filtreTag: null,
    });
  });

  it("choixInitiaux reprend aussi l'association de la version précédente (feuille et filtre TAG)", () => {
    const filtre = "PROTECTION TRANSFO BOBINE POINT NEUTRE";
    const analyse: IoImportAnalyseDto = {
      ...ANALYSE,
      equipements: ANALYSE.equipements.map((e) =>
        e.tag === "RPN_HTB_MCN_TR"
          ? { ...e, association: { tag: e.tag, feuille: "HTB_TR1", filtreTag: filtre, mode: "reprise" } }
          : e,
      ),
    };
    const choix = choixInitiaux(analyse);
    expect(choix.RPN_HTB_MCN_TR).toEqual({ feuille: "HTB_TR1", filtreTag: filtre });
    expect(associationsAEnvoyer(analyse, choix)[1]).toEqual({
      tag: "RPN_HTB_MCN_TR",
      feuille: "HTB_TR1",
      filtreTag: filtre,
    });
  });

  it("rapportAJour : le choix d'une feuille retire l'avertissement « sans feuille », son retrait le remet", () => {
    const initial = choixInitiaux(ANALYSE);
    expect(rapportAJour(ANALYSE, initial)).toEqual(ANALYSE.anomalies);
    const avecFeuille = { ...initial, RPN_HTB_MCN_TR: { feuille: "HTB_TR1", filtreTag: null } };
    expect(rapportAJour(ANALYSE, avecFeuille).map((x) => x.code)).toEqual([
      "affaire_differente",
      "feuille_multi_equipements",
    ]);
    // F1 associée automatiquement, puis « Aucune feuille » choisie à la main : nouvel avertissement.
    const sansFeuille = { ...avecFeuille, RPN_HTA_F1: { feuille: null, filtreTag: null } };
    expect(rapportAJour(ANALYSE, sansFeuille).at(-1)).toEqual({
      code: "equipement_sans_feuille",
      severite: "avertissement",
      feuille: "LISTE DES EQUIPEMENTS",
      ligne: 9,
      message: "RPN_HTA_F1 : aucune feuille d'E/S choisie.",
    });
  });

  it("RapportAnomalies regroupe par sévérité avec feuille et ligne", () => {
    render(<RapportAnomalies anomalies={ANALYSE.anomalies} />);
    expect(screen.getByText("Erreurs (import impossible) (1)")).toBeTruthy();
    expect(screen.getByText("Avertissements (1)")).toBeTruthy();
    expect(screen.getByText("Informations (1)")).toBeTruthy();
    expect(screen.getByText("REV").parentElement?.textContent).toContain("REV ligne 4 : Affaire différente.");
  });

  it("sans anomalie : message de succès", () => {
    render(<RapportAnomalies anomalies={[]} />);
    expect(screen.getByText("Aucune anomalie.")).toBeTruthy();
  });
});

describe("TemporaryPassword : copie avec retour visible (anomalie 16)", () => {
  it("« Copié ✓ » si le presse-papiers accepte ; message explicite s'il refuse", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const { unmount } = render(<TemporaryPassword email="nina@spie.local" password="Abc-123-xyz" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Copier" }));
    expect(await screen.findByRole("button", { name: "Copié ✓" })).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith("Abc-123-xyz");
    expect(screen.getByText("Mot de passe copié dans le presse-papiers.")).toBeTruthy();
    unmount();

    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText: vi.fn(async () => Promise.reject(new Error("refus"))) },
    });
    render(<TemporaryPassword email="nina@spie.local" password="Abc-123-xyz" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Copier" }));
    expect(await screen.findByText(/Copie impossible : sélectionnez le mot de passe/)).toBeTruthy();
  });
});

describe("suivi sans affaire choisie (anomalie 22)", () => {
  it("équipements (préfixés par l'affaire) et techniciens tirés des PV, sans doublon, triés", () => {
    const pv = (affaireNumero: string, equipementId: string | null, tag: string | null, techs: string[]) =>
      ({
        affaireNumero,
        equipementId,
        equipementTag: tag,
        techniciens: techs.map((nom) => ({ id: nom.toLowerCase(), nom })),
      }) as unknown as PvResumeDto;
    const o = optionsSansAffaire([
      pv("A35173", "f2", "RPN_HTA_F2", ["Théo", "Paul"]),
      pv("A35173", "f1", "RPN_HTA_F1", ["Théo"]),
      pv("A35174", "x1", "RPN_X", []),
      pv("A35173", null, null, ["Agathe"]),
    ]);
    expect(o.equipements.map((e) => e.label)).toEqual(["A35173 — RPN_HTA_F1", "A35173 — RPN_HTA_F2", "A35174 — RPN_X"]);
    expect(o.techniciens.map((t) => t.nom)).toEqual(["Agathe", "Paul", "Théo"]);
  });
});

describe("journal d'audit lisible (anomalie 18)", () => {
  it("modifications en « avant → après » avec libellés ; listes et booléens en texte", () => {
    expect(
      detailsLisibles({
        numero: "A35173",
        modifications: {
          client: { avant: "Autre", apres: "Autre client" },
          archivee: { avant: false, apres: true },
          site: { avant: "", apres: "Site essai" },
        },
      }),
    ).toEqual([
      { libelle: "N°", valeur: "A35173" },
      { libelle: "Client", valeur: "Autre → Autre client" },
      { libelle: "Archivée", valeur: "non → oui" },
      { libelle: "Site", valeur: "(vide) → Site essai" },
    ]);
    expect(detailsLisibles({ ajoutes: ["a@spie.test", "b@spie.test"], retires: [] })).toEqual([
      { libelle: "Ajoutés", valeur: "a@spie.test, b@spie.test" },
      { libelle: "Retirés", valeur: "—" },
    ]);
    expect(detailsLisibles(null)).toEqual([]);
  });
});

describe("ciblesDuplication (anomalie 13)", () => {
  it("même type de cellule à part, sans la source ni le régulateur, triés par TAG", () => {
    const eq = (id: string, tag: string, typeCellule: string, libelle = `RELAIS ${tag}`) =>
      ({ id, tag, typeCellule, libelle, avancement: { nbPv: 0, deposes: 0, enCours: 0 } }) as EquipementDto;
    const equipements = [
      eq("f2", "RPN_HTA_F2", "TYPE BATTERIE"),
      eq("f1", "RPN_HTA_F1", "TYPE BATTERIE"),
      eq("aux", "RPN_HTA_TAUX_NORD", "TYPE TR AUX"),
      eq("rgu", "RGU_HTB_TR", "", "REGULATEUR DE TENSION"),
      eq("f3", "RPN_HTA_F3", "TYPE BATTERIE"),
    ];
    const { memeType, autres } = ciblesDuplication(equipements, "f1");
    expect(memeType.map((e) => e.tag)).toEqual(["RPN_HTA_F2", "RPN_HTA_F3"]);
    expect(autres.map((e) => e.tag)).toEqual(["RPN_HTA_TAUX_NORD"]);
  });
});

describe("IoListePage : une version de la liste E/S est consultable (spec §4.6, anomalie 9)", () => {
  it("affiche le fichier, le rapport d'anomalies de l'import et, à la demande, les E/S d'une feuille", async () => {
    const liste: ListeEsDetailDto = {
      id: "l2",
      affaireId: "a1",
      referenceDocument: "GAU11_AUT_009",
      revision: "B",
      version: 2,
      fichierSource: "GAU11_AUT_009_LISTE ENTREES SORTIES RPN_B.xlsx",
      importeLe: "2026-11-19T15:33:00.000Z",
      importePar: "Alice Admin",
      nbFeuilles: 1,
      nbPoints: 2,
      anomalies: [
        {
          code: "equipement_sans_feuille",
          severite: "avertissement",
          feuille: "LISTE DES EQUIPEMENTS",
          ligne: 8,
          message: "RGU_HTB_TR : TYPE CELLULE vide : choisir la feuille d'E/S.",
        },
      ],
      feuilles: [
        {
          id: "f1",
          nom: "TYPE BATTERIE",
          titre: "TYPE DEPART BATTERIE",
          groupesTag: [],
          points: [
            {
              id: "p1",
              ordre: 0,
              carte: "PS050",
              tag: "-",
              type: "entree_tor",
              designation: "DISJ. FERME",
              adresse: "BI 1.01",
              reserve: false,
            },
            {
              id: "p2",
              ordre: 1,
              carte: "PS050",
              tag: "-",
              type: "entree_tor",
              designation: "RESERVE",
              adresse: "BI 2.11",
              reserve: true,
            },
          ],
        },
      ],
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(liste), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={["/preparation/io-lists/l2"]}>
          <Routes>
            <Route path="/preparation/io-lists/:listeId" element={<IoListePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("Liste E/S — version 2")).toBeTruthy();
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe("/api/prep/io-lists/l2");
    expect(screen.getByText(/RGU_HTB_TR : TYPE CELLULE vide/)).toBeTruthy();
    expect(screen.getByText("19/11/2026 16:33 par Alice Admin")).toBeTruthy();
    expect(screen.queryByText("DISJ. FERME")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /TYPE BATTERIE/ }));
    expect(screen.getByText("DISJ. FERME")).toBeTruthy();
    expect(screen.getByText("BI 2.11")).toBeTruthy();
  });
});

describe("BadgePvLocal", () => {
  it("un brouillon signé depuis une autre tablette n'est plus « En cours de saisie »", () => {
    const { rerender } = render(<BadgePvLocal pv={{ statut: "brouillon", clotAilleurs: null }} />);
    expect(screen.getByText("En cours de saisie")).toBeTruthy();
    rerender(<BadgePvLocal pv={{ statut: "brouillon", clotAilleurs: { signePar: "Paul Préparateur" } }} />);
    expect(screen.getByText("Signé par Paul Préparateur")).toBeTruthy();
    rerender(<BadgePvLocal pv={{ statut: "brouillon", clotAilleurs: { signePar: null } }} />);
    expect(screen.getByText("Signé sur une autre tablette")).toBeTruthy();
  });
});

describe("suivi et affichage", () => {
  it("querySuivi omet les filtres vides", () => {
    expect(querySuivi({})).toBe("");
    expect(querySuivi({ affaireId: "a", statut: "erreur", technicienId: undefined })).toBe(
      "?affaireId=a&statut=erreur",
    );
  });

  it("lienSharePoint : https ou SharePoint simulé servi par l'API ; jamais file://", () => {
    expect(lienSharePoint("https://spie.sharepoint.com/sites/x/PV.pdf")).toBe(
      "https://spie.sharepoint.com/sites/x/PV.pdf",
    );
    expect(lienSharePoint("/sharepoint-simule/Documents/PV.pdf")).toBe("/sharepoint-simule/Documents/PV.pdf");
    expect(lienSharePoint("file:///C:/fake/PV.pdf")).toBeNull();
    expect(lienSharePoint("javascript:alert(1)")).toBeNull();
    expect(lienSharePoint(null)).toBeNull();
  });

  it("BadgesDepots et LiensSharePoint : un fichier déposé s'ouvre dans SharePoint (spec §3.3)", () => {
    const depot = (fichier: "pdf" | "json", statut: "depose" | "en_attente", webUrl: string | null) => ({
      id: fichier,
      fichier,
      nom: `PV.${fichier}`,
      statut,
      tentatives: 1,
      derniereErreur: null,
      prochaineTentative: null,
      webUrl,
      cheminSharePoint: `Affaires / PV.${fichier}`,
      deposeLe: null,
    });
    const depots = [depot("pdf", "depose", "/sharepoint-simule/PV.pdf"), depot("json", "en_attente", null)];
    render(
      <>
        <BadgesDepots depots={depots} />
        <LiensSharePoint depots={depots} />
      </>,
    );
    // Badge PDF cliquable + lien texte ; rien pour le JSON en attente.
    const liens = screen.getAllByRole("link");
    expect(liens.map((l) => [l.getAttribute("aria-label") ?? l.textContent, l.getAttribute("href")])).toEqual([
      ["Ouvrir le PDF dans SharePoint", "/sharepoint-simule/PV.pdf"],
      ["Ouvrir le PDF dans SharePoint", "/sharepoint-simule/PV.pdf"],
    ]);
    expect(screen.getByText("JSON : En attente").closest("a")).toBeNull();
  });
});

describe("aperçu", () => {
  it("rend le modèle avec le bandeau d'aperçu et les scripts Paged.js de /vendor", () => {
    const html = htmlApercu(exemplePvDocument());
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain(
      '<script src="/vendor/paged.polyfill.js"></script><script src="/vendor/paged-handlers.js"></script>',
    );
    expect(html).toContain('class="apercu"');
  });
});
