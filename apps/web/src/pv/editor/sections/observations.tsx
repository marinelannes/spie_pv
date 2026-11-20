import {
  CONCLUSION_LABELS,
  CRITICITES,
  CRITICITE_LABELS,
  ajouterObservation,
  recapReserves,
  reserveSupprimable,
  supprimerObservation,
  supprimerReserve,
  transformerEnReserve,
  type Criticite,
  type Reserve,
} from "@spie/shared";
import { majItem, useEditeur } from "../context";
import { Bloc, BoutonPetit, CelluleTexte, ChoixBoutons, JugementBoutons, TexteMultiligne } from "../fields";

/** Sections 12 et 13 : observations et réserves (spec §4.1, §4.3), conclusion générale. */

function LigneReserve({ r }: { r: Reserve }) {
  const { donnees, maj, lectureSeule } = useEditeur();
  const patch = (p: Partial<Reserve>) => maj((d) => ({ ...d, reserves: majItem(d.reserves, r.id, p) }));
  const supprimer = () => {
    const obs = donnees.observations.filter((o) => o.reserveNumero === r.numero).map((o) => `n°${o.numero}`);
    const garde = obs.length > 0 ? ` L'observation ${obs.join(", ")} est conservée, sans réserve.` : "";
    if (window.confirm(`Supprimer la réserve n°${r.numero} ?${garde}`)) maj((d) => supprimerReserve(d, r.id));
  };
  return (
    <div className="grid gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 sm:grid-cols-4">
      <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-4">
        <p className="font-bold">
          Réserve n°{r.numero} — {r.controle}{" "}
          <span className="font-normal">
            ({r.statut === "ouverte" ? "ouverte" : "levée"}, indice {r.indiceCreation})
          </span>
        </p>
        {!lectureSeule && reserveSupprimable(donnees, r) && (
          <BoutonPetit danger onClick={supprimer}>
            Supprimer la réserve
          </BoutonPetit>
        )}
      </div>
      <CelluleTexte
        className="sm:col-span-4"
        label={`Réserve ${r.numero} — description`}
        valeur={r.description}
        onChange={(description) => patch({ description })}
      />
      <select
        aria-label={`Réserve ${r.numero} — criticité`}
        disabled={lectureSeule}
        className="min-h-12 rounded-lg border-2 border-slate-300 bg-white px-2"
        value={r.criticite ?? ""}
        onChange={(e) => patch({ criticite: (e.target.value || null) as Criticite | null })}
      >
        <option value="">Criticité…</option>
        {CRITICITES.map((c) => (
          <option key={c} value={c}>
            {CRITICITE_LABELS[c]}
          </option>
        ))}
      </select>
      <CelluleTexte
        label={`Réserve ${r.numero} — responsable de la levée`}
        valeur={r.responsable}
        onChange={(responsable) => patch({ responsable })}
      />
      <input
        type="date"
        aria-label={`Réserve ${r.numero} — date prévue de levée`}
        disabled={lectureSeule}
        className="min-h-12 rounded-lg border-2 border-slate-300 bg-white px-2"
        value={r.datePrevue}
        onChange={(e) => patch({ datePrevue: e.target.value })}
      />
    </div>
  );
}

export function SectionObservations() {
  const { donnees: d, maj, lectureSeule, site } = useEditeur();
  const recap = recapReserves(d);
  // Une observation liée à une réserve d'une révision précédente ne se supprime pas (la réserve se lève).
  const supprimable = (numero: number | null) => {
    const r = numero === null ? undefined : d.reserves.find((x) => x.numero === numero);
    return !r || reserveSupprimable(d, r);
  };
  if (!site) {
    return (
      <Bloc titre="12. Observations / Comments">
        <p className="text-slate-700">Les observations et les réserves sont saisies sur site.</p>
      </Bloc>
    );
  }
  return (
    <div className="space-y-5">
      <Bloc
        titre="12. Observations / Comments"
        sousTitre="N°, libellé du contrôle, NA / C / NC, n° de réserve, observations."
        actions={
          site &&
          !lectureSeule && (
            <BoutonPetit
              onClick={() =>
                maj((x) => ajouterObservation(x, { ref: null, libelle: "", jugement: null, observation: "" }))
              }
            >
              Ajouter une observation
            </BoutonPetit>
          )
        }
      >
        {d.observations.length === 0 && <p className="text-slate-600">Aucune observation.</p>}
        {d.observations.map((o) => (
          <div key={o.id} className="space-y-2 rounded-lg border border-slate-200 p-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-lg font-bold">N°{o.numero}</span>
              <CelluleTexte
                className="min-w-64 flex-1"
                label={`Observation ${o.numero} — libellé du contrôle`}
                valeur={o.libelle}
                onChange={(libelle) => maj((x) => ({ ...x, observations: majItem(x.observations, o.id, { libelle }) }))}
              />
              <JugementBoutons
                label={`Observation ${o.numero} — jugement`}
                valeur={o.jugement}
                onChange={(jugement) =>
                  maj((x) => ({ ...x, observations: majItem(x.observations, o.id, { jugement }) }))
                }
              />
            </div>
            <TexteMultiligne
              aria-label={`Observation ${o.numero} — texte`}
              disabled={lectureSeule}
              value={o.observation}
              onChange={(e) =>
                maj((x) => ({ ...x, observations: majItem(x.observations, o.id, { observation: e.target.value }) }))
              }
            />
            <div className="flex flex-wrap items-center gap-2">
              {o.reserveNumero !== null ? (
                <span className="rounded bg-amber-100 px-2 py-1 font-semibold text-amber-900">
                  Réserve n°{o.reserveNumero}
                </span>
              ) : (
                !lectureSeule && (
                  <BoutonPetit
                    danger
                    disabled={!o.observation.trim()}
                    onClick={() => maj((x) => transformerEnReserve(x, o.id))}
                  >
                    Transformer en réserve
                  </BoutonPetit>
                )
              )}
              {!lectureSeule && supprimable(o.reserveNumero) && (
                <BoutonPetit
                  danger
                  onClick={() => {
                    const message =
                      o.reserveNumero === null
                        ? `Supprimer l'observation n°${o.numero} ?`
                        : `Supprimer l'observation n°${o.numero} et la réserve n°${o.reserveNumero} qui lui est liée ?`;
                    if (window.confirm(message)) maj((x) => supprimerObservation(x, o.id));
                  }}
                >
                  Supprimer
                </BoutonPetit>
              )}
            </div>
          </div>
        ))}
      </Bloc>
      <Bloc titre="Réserves" sousTitre={`${recap.ouvertes} ouverte(s), ${recap.levees} levée(s).`}>
        {d.reserves.length === 0 && <p className="text-slate-600">Aucune réserve.</p>}
        {d.reserves.map((r) => (
          <LigneReserve key={r.id} r={r} />
        ))}
      </Bloc>
    </div>
  );
}

export function SectionConclusion() {
  const { donnees: d, maj, lectureSeule, site } = useEditeur();
  if (!site) {
    return (
      <Bloc titre="13. Conclusion générale des tests">
        <p className="text-slate-700">
          La conclusion, le statut du document (BPO / BPE / CMS) et les signatures sont saisis sur site.
        </p>
      </Bloc>
    );
  }
  return (
    <Bloc titre="13. Conclusion générale des tests / General test conclusion">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium">Matériel / Material</span>
        <ChoixBoutons
          label="Conclusion générale"
          valeur={
            d.conclusion.materiel === "accepte" ? "Accepté" : d.conclusion.materiel === "refuse" ? "Refusé" : null
          }
          options={["Accepté", "Refusé"] as const}
          disabled={lectureSeule}
          titres={{ Accepté: CONCLUSION_LABELS.accepte, Refusé: CONCLUSION_LABELS.refuse }}
          onChange={(v) =>
            maj((x) => ({
              ...x,
              conclusion: { materiel: v === "Accepté" ? "accepte" : v === "Refusé" ? "refuse" : null },
            }))
          }
        />
      </div>
      <p className="text-slate-600">
        Le statut du document et les signatures SPIE et client se font à l'étape « Signer ».
      </p>
    </Bloc>
  );
}
