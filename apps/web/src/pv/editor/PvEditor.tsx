import {
  SECTIONS_RELAIS,
  controlesAvantSignature,
  type Manquant,
  type PvRelaisData,
  type SectionRelaisId,
  type Trace,
} from "@spie/shared";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { EditeurContext, type MajPv, type ModeEditeur } from "./context";
import { SectionEs } from "./sections/es";
import {
  SectionConfiguration,
  SectionDocuments,
  SectionGeneralites,
  SectionIdentification,
  SectionMateriel,
  SectionTests,
} from "./sections/generales";
import { SectionMesures } from "./sections/mesures";
import { SectionConclusion, SectionObservations } from "./sections/observations";
import { SectionProtection } from "./sections/protection";

export const SECTIONS_EDITABLES = SECTIONS_RELAIS.filter((s) => s.saisie);

const COMPOSANTS: Partial<Record<SectionRelaisId, () => ReactNode>> = {
  generalites: SectionGeneralites,
  materiel: SectionMateriel,
  documents: SectionDocuments,
  identification: SectionIdentification,
  tests: SectionTests,
  configuration: SectionConfiguration,
  mesures: SectionMesures,
  es: SectionEs,
  protection: SectionProtection,
  observations: SectionObservations,
  conclusion: SectionConclusion,
};

export function estSectionEditable(s: string | null | undefined): s is SectionRelaisId {
  return SECTIONS_EDITABLES.some((x) => x.id === s);
}

/** Nombre de manques bloquants par section (pastilles de la navigation). */
export function manquesParSection(manquants: readonly Manquant[]): Partial<Record<SectionRelaisId, number>> {
  const out: Partial<Record<SectionRelaisId, number>> = {};
  for (const m of manquants) if (m.bloquant) out[m.section] = (out[m.section] ?? 0) + 1;
  return out;
}

/** Ce qui manque avant signature (spec §3.2 étape 4), regroupé par section, avec accès direct. */
export function ListeManquants({
  manquants,
  onAller,
}: {
  manquants: readonly Manquant[];
  onAller: (s: SectionRelaisId) => void;
}) {
  if (manquants.length === 0) {
    return <p className="font-semibold text-green-800">Rien ne manque : le PV peut être signé.</p>;
  }
  const bloquants = manquants.filter((m) => m.bloquant).length;
  return (
    <div className="space-y-3">
      <p className="font-semibold">
        {bloquants > 0 ? `${bloquants} point(s) à compléter avant la signature` : "Aucun point bloquant"}
        {manquants.length > bloquants && `, ${manquants.length - bloquants} avertissement(s)`}
      </p>
      {SECTIONS_RELAIS.map((s) => {
        const liste = manquants.filter((m) => m.section === s.id);
        if (liste.length === 0) return null;
        return (
          <div key={s.id} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="font-bold">
                {s.numero}. {s.titreFr} ({liste.length})
              </h4>
              <button
                type="button"
                className="min-h-12 rounded-lg px-3 font-semibold text-brand-800 underline"
                onClick={() => onAller(s.id)}
              >
                Aller à la section
              </button>
            </div>
            <ul className="mt-1 list-disc space-y-0.5 pl-6">
              {liste.slice(0, 8).map((m) => (
                <li key={m.ref + m.message} className={m.bloquant ? "text-red-900" : "text-amber-900"}>
                  {m.message}
                </li>
              ))}
              {liste.length > 8 && <li className="text-slate-600">… et {liste.length - 8} autre(s)</li>}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export interface PvEditorProps {
  donnees: PvRelaisData;
  preparees: PvRelaisData | null;
  mode: ModeEditeur;
  lectureSeule?: boolean;
  onChange: MajPv;
  trace: () => Trace;
  section: SectionRelaisId;
  onSection: (s: SectionRelaisId) => void;
}

/** Formulaire du PV relais, section par section (spec §3.2 étape 2). */
export function PvEditor(props: PvEditorProps) {
  const { donnees, preparees, mode, lectureSeule = false, onChange, trace, section, onSection } = props;
  const ctx = useMemo(
    () => ({ donnees, preparees, maj: onChange, mode, lectureSeule, trace }),
    [donnees, preparees, onChange, mode, lectureSeule, trace],
  );
  const manques = useMemo(
    () => (mode === "saisie" ? manquesParSection(controlesAvantSignature(donnees)) : {}),
    [donnees, mode],
  );
  // Barre des sections horizontale (tablette en portrait) : la section courante reste visible.
  const actif = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    actif.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [section]);
  const Composant = COMPOSANTS[section] ?? SectionGeneralites;
  const i = SECTIONS_EDITABLES.findIndex((s) => s.id === section);
  const prec = SECTIONS_EDITABLES[i - 1];
  const suiv = SECTIONS_EDITABLES[i + 1];

  return (
    <EditeurContext value={ctx}>
      {/* grid-cols-1 (minmax(0, 1fr)) : sous 1024 px, la barre des sections défile au lieu d'élargir la page. */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <nav aria-label="Sections du PV" className="min-w-0 lg:sticky lg:top-4 lg:self-start">
          <ol className="flex gap-1.5 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible">
            {SECTIONS_EDITABLES.map((s) => (
              <li key={s.id} className="shrink-0">
                <button
                  type="button"
                  ref={s.id === section ? actif : undefined}
                  aria-current={s.id === section ? "step" : undefined}
                  onClick={() => onSection(s.id)}
                  className={`flex min-h-12 w-full items-center justify-between gap-2 rounded-lg px-3 text-left font-semibold ${
                    s.id === section ? "bg-brand-700 text-white" : "bg-white text-slate-800 hover:bg-brand-50"
                  }`}
                >
                  <span>
                    {s.numero}. {s.titreFr}
                  </span>
                  {manques[s.id] ? (
                    <span
                      className="rounded-full bg-amber-300 px-2 text-sm text-amber-950"
                      aria-label={`${manques[s.id]} à compléter`}
                    >
                      {manques[s.id]}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <div className="min-w-0 space-y-5">
          <h2 className="text-2xl font-bold">
            {SECTIONS_RELAIS.find((s) => s.id === section)?.numero}.{" "}
            {SECTIONS_RELAIS.find((s) => s.id === section)?.titreFr}
          </h2>
          <Composant />
          <div className="flex justify-between gap-3">
            {prec ? (
              <button
                type="button"
                className="min-h-12 rounded-lg px-4 font-semibold text-brand-800 hover:bg-brand-50"
                onClick={() => onSection(prec.id)}
              >
                ← {prec.titreFr}
              </button>
            ) : (
              <span />
            )}
            {suiv && (
              <button
                type="button"
                className="min-h-12 rounded-lg bg-brand-700 px-4 font-semibold text-white"
                onClick={() => onSection(suiv.id)}
              >
                {suiv.titreFr} →
              </button>
            )}
          </div>
        </div>
      </div>
    </EditeurContext>
  );
}
