import { ajouterObservation, CRITICITES, CRITICITE_LABELS, type Criticite } from "@spie/shared";
import { useState } from "react";
import { useEditeur } from "./context";
import { BoutonPetit, TexteMultiligne } from "./fields";

/**
 * Un NC demande une observation (spec §4.2, point ouvert n°9) et peut être transformé en réserve en un geste.
 * Affiché sous un contrôle jugé NC : observations déjà liées, puis saisie d'une nouvelle observation.
 */
export function NcPanel({ refControle, libelle }: { refControle: string; libelle: string }) {
  const { donnees, maj, lectureSeule, site } = useEditeur();
  const [texte, setTexte] = useState("");
  const [criticite, setCriticite] = useState<Criticite | "">("");
  if (!site) return null;
  const liees = donnees.observations.filter((o) => o.ref === refControle);

  const ajouter = (reserve: boolean) => {
    maj((d) =>
      ajouterObservation(d, {
        ref: refControle,
        libelle,
        jugement: "NC",
        observation: texte.trim(),
        reserve: reserve ? { criticite: criticite || null } : undefined,
      }),
    );
    setTexte("");
  };

  return (
    <div className="mt-2 rounded-lg border-2 border-red-200 bg-red-50 p-3" aria-label={`Non-conformité : ${libelle}`}>
      {liees.length > 0 && (
        <ul className="mb-2 space-y-1 text-red-950">
          {liees.map((o) => (
            <li key={o.id}>
              Observation n°{o.numero}
              {o.reserveNumero !== null && <strong> — réserve n°{o.reserveNumero}</strong>} :{" "}
              {o.observation || <em>(vide)</em>}
            </li>
          ))}
        </ul>
      )}
      {!lectureSeule && (
        <div className="space-y-2">
          <TexteMultiligne
            aria-label={`Observation pour ${libelle}`}
            placeholder="Observation (constat, valeur relevée, action…)"
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <BoutonPetit onClick={() => ajouter(false)} disabled={!texte.trim()}>
              Ajouter l'observation
            </BoutonPetit>
            <select
              aria-label="Criticité de la réserve"
              className="min-h-12 rounded-lg border-2 border-slate-300 bg-white px-2"
              value={criticite}
              onChange={(e) => setCriticite(e.target.value as Criticite | "")}
            >
              <option value="">Criticité…</option>
              {CRITICITES.map((c) => (
                <option key={c} value={c}>
                  {CRITICITE_LABELS[c]}
                </option>
              ))}
            </select>
            <BoutonPetit danger onClick={() => ajouter(true)} disabled={!texte.trim()}>
              Ajouter et créer une réserve
            </BoutonPetit>
          </div>
        </div>
      )}
    </div>
  );
}
