import { nouvelId, type LigneBilingue, type PvRelaisData } from "@spie/shared";
import { majItem, retirerItem, useEditeur } from "../context";
import { Bloc, BoutonPetit, CelluleTexte, ChampTexte, JugementBoutons } from "../fields";
import { NcPanel } from "../NcPanel";

/** Sections 3 à 8 : généralités, matériel, documents, identification, tests préliminaires, configuration. */

export function SectionGeneralites() {
  const { donnees: d, preparees: p, maj } = useEditeur();
  const setEntete = (patch: Partial<PvRelaisData["entete"]>) =>
    maj((x) => ({ ...x, entete: { ...x.entete, ...patch } }));
  const setGen = (patch: Partial<PvRelaisData["generalites"]>) =>
    maj((x) => ({ ...x, generalites: { ...x.generalites, ...patch } }));
  return (
    <div className="space-y-5">
      <Bloc
        titre="En-tête et page de garde"
        sousTitre={`Affaire ${d.entete.numeroAffaire} — indice ${d.entete.indice}`}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <ChampTexte
            label="N° Document (codification projet)"
            valeur={d.entete.numeroDocument}
            prepare={p?.entete.numeroDocument}
            onChange={(v) => setEntete({ numeroDocument: v })}
          />
          <ChampTexte
            label="Client"
            valeur={d.entete.client}
            prepare={p?.entete.client}
            onChange={(v) => setEntete({ client: v })}
          />
          <ChampTexte
            label="Projet"
            valeur={d.entete.projet}
            prepare={p?.entete.projet}
            onChange={(v) => setEntete({ projet: v })}
            className="sm:col-span-2"
          />
        </div>
      </Bloc>
      <Bloc
        titre="Tableau des révisions"
        sousTitre={
          d.revisions.length > 1
            ? `Seule la révision ${d.entete.indice} se modifie : les révisions signées ne changent plus.`
            : "« Validé par » et « Approuvé par » sont repris de l'affaire ; « Écrit par » est le signataire par défaut."
        }
      >
        <div className="space-y-3">
          {d.revisions.map((r, i) => (
            <div
              key={`${r.indice}-${i}`}
              className="grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-[auto_repeat(4,minmax(0,1fr))]"
            >
              <span className="self-center text-lg font-bold">Rév. {r.indice}</span>
              {(["date", "ecritPar", "validePar", "approuvePar"] as const).map((k) => (
                <CelluleTexte
                  key={k}
                  label={`Révision ${r.indice} — ${{ date: "date (AAAA-MM-JJ)", ecritPar: "écrit par", validePar: "validé par", approuvePar: "approuvé par" }[k]}`}
                  valeur={r[k]}
                  disabled={r.indice !== d.entete.indice}
                  onChange={(v) =>
                    maj((x) => ({ ...x, revisions: x.revisions.map((y, j) => (j === i ? { ...y, [k]: v } : y)) }))
                  }
                />
              ))}
              <CelluleTexte
                className="sm:col-span-5"
                label={`Révision ${r.indice} — modifications`}
                valeur={r.modifications}
                disabled={r.indice !== d.entete.indice}
                onChange={(v) =>
                  maj((x) => ({
                    ...x,
                    revisions: x.revisions.map((y, j) => (j === i ? { ...y, modifications: v } : y)),
                  }))
                }
              />
            </div>
          ))}
        </div>
      </Bloc>
      <Bloc titre="3.1 Objet">
        <LignesBilingues
          lignes={d.generalites.objet}
          preparees={p?.generalites.objet}
          onChange={(objet) => setGen({ objet })}
          label="Objet"
        />
      </Bloc>
      <Bloc titre="3.2 Lieu et 3.3 dates des tests">
        <div className="grid gap-4 sm:grid-cols-2">
          <ChampTexte
            label="Lieu des tests"
            valeur={d.generalites.lieu}
            prepare={p?.generalites.lieu}
            onChange={(v) => setGen({ lieu: v })}
          />
          <ChampTexte
            label="Dates des tests"
            valeur={d.generalites.dates}
            prepare={p?.generalites.dates}
            placeholder="ex. semaine 47, du 17 au 19/11/2026"
            onChange={(v) => setGen({ dates: v })}
          />
        </div>
      </Bloc>
    </div>
  );
}

/** Liste éditable de lignes bilingues (matériel de test, documents de référence, objet). */
export function LignesBilingues({
  lignes,
  preparees,
  onChange,
  label,
}: {
  lignes: LigneBilingue[];
  preparees?: LigneBilingue[];
  onChange: (l: LigneBilingue[]) => void;
  label: string;
}) {
  const { lectureSeule, site } = useEditeur();
  return (
    <div className="space-y-2">
      {lignes.map((l, i) => {
        const prep = preparees?.find((x) => x.id === l.id);
        const corrige = site && prep && (prep.fr !== l.fr || prep.en !== l.en);
        return (
          <div key={l.id} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <CelluleTexte
              label={`${label} ${i + 1} — français`}
              valeur={l.fr}
              onChange={(fr) => onChange(majItem(lignes, l.id, { fr }))}
            />
            <CelluleTexte
              label={`${label} ${i + 1} — anglais`}
              valeur={l.en}
              onChange={(en) => onChange(majItem(lignes, l.id, { en }))}
            />
            {!lectureSeule && (
              <BoutonPetit
                danger
                label={`Retirer la ligne ${i + 1}`}
                onClick={() => onChange(retirerItem(lignes, l.id))}
              >
                Retirer
              </BoutonPetit>
            )}
            {corrige && (
              <span className="text-sm text-amber-800 sm:col-span-3">Corrigé sur site — préparé : « {prep.fr} »</span>
            )}
          </div>
        );
      })}
      {!lectureSeule && (
        <BoutonPetit onClick={() => onChange([...lignes, { id: nouvelId(), fr: "", en: "" }])}>
          Ajouter une ligne
        </BoutonPetit>
      )}
    </div>
  );
}

export function SectionMateriel() {
  const { donnees: d, preparees: p, maj } = useEditeur();
  return (
    <Bloc titre="4. Matériel de test" sousTitre="Liste préparée au bureau, corrigeable sur site.">
      <LignesBilingues
        lignes={d.materielTest}
        preparees={p?.materielTest}
        label="Matériel"
        onChange={(materielTest) => maj((x) => ({ ...x, materielTest }))}
      />
    </Bloc>
  );
}

export function SectionDocuments() {
  const { donnees: d, preparees: p, maj } = useEditeur();
  return (
    <Bloc titre="5. Documents de référence" sousTitre="Procédure, norme…">
      <LignesBilingues
        lignes={d.documentsReference}
        preparees={p?.documentsReference}
        label="Document"
        onChange={(documentsReference) => maj((x) => ({ ...x, documentsReference }))}
      />
    </Bloc>
  );
}

export function SectionIdentification() {
  const { donnees: d, preparees: p, maj, lectureSeule, site } = useEditeur();
  const fixes = new Set([
    "modele",
    "numero-serie",
    "code-commande",
    "adresse-ip",
    "tension-aux",
    "option",
    "frequence",
    "communication",
  ]);
  return (
    <Bloc titre="6. Identification du relais">
      <div className="grid gap-4 sm:grid-cols-2">
        {d.identification.map((f) => (
          <div key={f.id} className="space-y-1">
            {fixes.has(f.id) || site ? (
              <ChampTexte
                label={`${f.libelleFr || "Champ"}${f.libelleEn ? ` / ${f.libelleEn}` : ""}`}
                valeur={f.valeur}
                prepare={p?.identification.find((x) => x.id === f.id)?.valeur}
                onChange={(valeur) =>
                  maj((x) => ({ ...x, identification: majItem(x.identification, f.id, { valeur }) }))
                }
              />
            ) : (
              <div className="space-y-2 rounded-lg bg-slate-50 p-2">
                <CelluleTexte
                  label="Libellé du champ (français)"
                  valeur={f.libelleFr}
                  onChange={(libelleFr) =>
                    maj((x) => ({ ...x, identification: majItem(x.identification, f.id, { libelleFr }) }))
                  }
                />
                <CelluleTexte
                  label="Libellé du champ (anglais)"
                  valeur={f.libelleEn}
                  onChange={(libelleEn) =>
                    maj((x) => ({ ...x, identification: majItem(x.identification, f.id, { libelleEn }) }))
                  }
                />
                <CelluleTexte
                  label="Valeur"
                  valeur={f.valeur}
                  onChange={(valeur) =>
                    maj((x) => ({ ...x, identification: majItem(x.identification, f.id, { valeur }) }))
                  }
                />
                {!lectureSeule && (
                  <BoutonPetit
                    danger
                    onClick={() => maj((x) => ({ ...x, identification: retirerItem(x.identification, f.id) }))}
                  >
                    Retirer ce champ
                  </BoutonPetit>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {!lectureSeule && !site && (
        <BoutonPetit
          onClick={() =>
            maj((x) => ({
              ...x,
              identification: [...x.identification, { id: nouvelId(), libelleFr: "", libelleEn: "", valeur: "" }],
            }))
          }
        >
          Ajouter un champ
        </BoutonPetit>
      )}
    </Bloc>
  );
}

export function SectionTests() {
  const { donnees: d, maj, site } = useEditeur();
  return (
    <Bloc
      titre="7. Tests préliminaires"
      sousTitre={
        site
          ? "Valeur relevée et jugement pour chaque contrôle."
          : "Libellés des contrôles ; les relevés sont saisis sur site."
      }
    >
      {d.testsPreliminaires.map((t) => (
        <div key={t.id} className="rounded-lg border border-slate-200 p-3">
          <p className="font-semibold">{t.libelleFr}</p>
          <p className="text-slate-600">
            {t.libelleEn}
            {t.aideFr && ` — ${t.aideFr}`}
          </p>
          {site && (
            <div className="mt-2 flex flex-wrap items-end gap-3">
              <CelluleTexte
                className="w-48"
                label={`${t.libelleFr} — valeur relevée`}
                valeur={t.valeur}
                onChange={(valeur) =>
                  maj((x) => ({ ...x, testsPreliminaires: majItem(x.testsPreliminaires, t.id, { valeur }) }))
                }
              />
              <JugementBoutons
                label={`Jugement : ${t.libelleFr}`}
                valeur={t.jugement}
                onChange={(jugement) =>
                  maj((x) => ({ ...x, testsPreliminaires: majItem(x.testsPreliminaires, t.id, { jugement }) }))
                }
              />
              <CelluleTexte
                className="min-w-64 flex-1"
                label={`${t.libelleFr} — observation`}
                valeur={t.observation}
                onChange={(observation) =>
                  maj((x) => ({ ...x, testsPreliminaires: majItem(x.testsPreliminaires, t.id, { observation }) }))
                }
              />
            </div>
          )}
          {t.jugement === "NC" && <NcPanel refControle={`tests.${t.id}`} libelle={t.libelleFr} />}
        </div>
      ))}
    </Bloc>
  );
}

export function SectionConfiguration() {
  const { donnees: d, preparees: p, maj, site } = useEditeur();
  return (
    <Bloc titre="8. Identification de la configuration">
      <ChampTexte
        label="Nom du fichier de paramétrage / Parameters filename"
        valeur={d.configuration.nomFichier}
        prepare={p?.configuration.nomFichier}
        onChange={(nomFichier) => maj((x) => ({ ...x, configuration: { ...x.configuration, nomFichier } }))}
      />
      {site && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-medium">Vérification</span>
          <JugementBoutons
            label="Vérification de la configuration"
            valeur={d.configuration.jugement}
            onChange={(jugement) => maj((x) => ({ ...x, configuration: { ...x.configuration, jugement } }))}
          />
        </div>
      )}
      {d.configuration.jugement === "NC" && (
        <NcPanel refControle="configuration" libelle="Identification de la configuration" />
      )}
    </Bloc>
  );
}
