import {
  TYPE_ES_COURTS,
  ajouterObservation,
  avancementEs,
  filtrerEs,
  grouperParCarte,
  jugementEs,
  libelleEs,
  saisirResultatEs,
  type ChampsResultatEs,
  type FiltreEs,
  type PointEsPv,
} from "@spie/shared";
import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useMemo, useRef, useState } from "react";
import { formatDateTime } from "../../../lib/format";
import { majItem, useEditeur } from "../context";
import { Bloc, BoutonPetit, CelluleTexte, ChoixBoutons, JugementBoutons, MarqueCorrige } from "../fields";

/** Section 10 : affectation des cartes E/S (vérification E/S par E/S et remontée SCADA, spec §4.4) et des LED. */

const FILTRES: { id: FiltreEs; label: string }[] = [
  { id: "toutes", label: "Toutes" },
  { id: "non_testees", label: "Non testées" },
  { id: "nc", label: "NC" },
  { id: "reserves", label: "Réserves" },
];

type Ligne = { kind: "carte"; carte: string; nb: number } | { kind: "point"; point: PointEsPv };

/** Lignes de la liste virtualisée : en-tête de carte puis ses E/S, après filtre et recherche. */
export function lignesEs(points: readonly PointEsPv[], filtre: FiltreEs, recherche: string): Ligne[] {
  return grouperParCarte(filtrerEs(points, filtre, recherche)).flatMap((g) => [
    { kind: "carte" as const, carte: g.carte, nb: g.points.length },
    ...g.points.map((point) => ({ kind: "point" as const, point })),
  ]);
}

export function CompteurEs({ points }: { points: readonly PointEsPv[] }) {
  const a = avancementEs(points);
  return (
    <p className="text-lg" aria-live="polite" data-testid="compteur-es">
      <strong>
        {a.testees} / {a.total}
      </strong>{" "}
      E/S testées
      {a.nc > 0 && <span className="ml-3 font-bold text-red-800">{a.nc} NC</span>}
      {a.reserves > 0 && <span className="ml-3 text-slate-600">{a.reserves} réserve(s)</span>}
    </p>
  );
}

const LignePoint = memo(function LignePoint({
  point: p,
  site,
  lectureSeule,
  onSaisie,
  onReserve,
  dejaReserve,
}: {
  point: PointEsPv;
  site: boolean;
  lectureSeule: boolean;
  onSaisie: (id: string, c: ChampsResultatEs) => void;
  onReserve: (p: PointEsPv) => void;
  dejaReserve: boolean;
}) {
  const nc = jugementEs(p) === "NC";
  return (
    <div className={`border-b border-slate-200 px-3 py-3 ${nc ? "bg-red-50" : ""}`}>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="font-mono text-lg font-bold">{p.adresse}</span>
        <span className="rounded bg-slate-100 px-1.5 text-sm font-semibold">{TYPE_ES_COURTS[p.type]}</span>
        <span className="flex-1">{p.designation}</span>
        {p.reserve && <span className="rounded bg-slate-200 px-2 text-sm">Réserve</span>}
        {p.saisie && (
          <span className="text-sm text-slate-500">
            {p.saisie.par}, {formatDateTime(p.saisie.le)}
          </span>
        )}
      </div>
      {site && (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="inline-flex items-center gap-2">
              <span className="text-sm font-semibold">Testé</span>
              <ChoixBoutons
                label={`${p.adresse} testé / validé`}
                valeur={p.teste}
                options={["C", "NC", "NA"] as const}
                disabled={lectureSeule}
                onChange={(teste) => onSaisie(p.id, { teste })}
              />
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="text-sm font-semibold">LED</span>
              <ChoixBoutons
                label={`${p.adresse} LED activées`}
                valeur={p.leds}
                options={["OK", "NOK"] as const}
                disabled={lectureSeule}
                onChange={(leds) => onSaisie(p.id, { leds })}
              />
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="text-sm font-semibold">Relais</span>
              <ChoixBoutons
                label={`${p.adresse} relais activés`}
                valeur={p.relais}
                options={["OK", "NOK"] as const}
                disabled={lectureSeule}
                onChange={(relais) => onSaisie(p.id, { relais })}
              />
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="text-sm font-semibold">SCADA</span>
              <ChoixBoutons
                label={`${p.adresse} remontée SCADA`}
                valeur={p.scada}
                options={["C", "NC"] as const}
                disabled={lectureSeule}
                onChange={(scada) => onSaisie(p.id, { scada })}
              />
            </span>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <CelluleTexte
              label={`${p.adresse} message lu en supervision`}
              placeholder="Message lu en supervision"
              valeur={p.message}
              onChange={(message) => onSaisie(p.id, { message })}
            />
            <CelluleTexte
              label={`${p.adresse} commentaire`}
              placeholder="Commentaire"
              valeur={p.commentaire}
              onChange={(commentaire) => onSaisie(p.id, { commentaire })}
            />
            {nc && !lectureSeule && (
              <BoutonPetit danger disabled={dejaReserve || !p.commentaire.trim()} onClick={() => onReserve(p)}>
                {dejaReserve ? "Réserve créée" : "Créer une réserve"}
              </BoutonPetit>
            )}
          </div>
          {nc && !lectureSeule && !dejaReserve && !p.commentaire.trim() && (
            <p className="mt-1 text-sm font-semibold text-red-900">
              NC : décrivez la non-conformité dans le commentaire (il tient lieu d'observation et de description de la
              réserve).
            </p>
          )}
        </>
      )}
    </div>
  );
});

export function ListeEs() {
  const { donnees, maj, site, lectureSeule, trace } = useEditeur();
  const points = donnees.es.points;
  const [filtre, setFiltre] = useState<FiltreEs>("toutes");
  const [recherche, setRecherche] = useState("");
  const lignes = useMemo(() => lignesEs(points, filtre, recherche), [points, filtre, recherche]);
  const reserves = useMemo(() => new Set(donnees.reserves.map((r) => r.ref)), [donnees.reserves]);
  const parentRef = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({
    count: lignes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => (lignes[i]?.kind === "carte" ? 52 : site ? 190 : 60),
    overscan: 8,
    initialRect: { width: 900, height: 700 },
  });

  const onSaisie = useMemo(
    () => (id: string, c: ChampsResultatEs) => {
      const t = trace();
      maj((d) => ({
        ...d,
        es: { ...d.es, points: d.es.points.map((p) => (p.id === id ? saisirResultatEs(p, c, t) : p)) },
      }));
    },
    [maj, trace],
  );
  const onReserve = useMemo(
    () => (p: PointEsPv) =>
      maj((d) =>
        ajouterObservation(d, {
          ref: `es.${p.id}`,
          libelle: libelleEs(p),
          jugement: "NC",
          // Le texte vient du technicien (bouton inactif tant que le commentaire est vide) : jamais de texte automatique.
          observation: p.commentaire.trim(),
          reserve: {},
        }),
      ),
    [maj],
  );

  if (points.length === 0) {
    return (
      <p className="text-slate-600">Aucune E/S : l'équipement n'a pas de feuille dans la liste E/S de l'affaire.</p>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CompteurEs points={points} />
        <p className="text-sm text-slate-600">
          {donnees.es.referenceDocument} rév. {donnees.es.revision} — feuille {donnees.es.feuille}
          {donnees.es.filtreTag && ` (${donnees.es.filtreTag})`}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Filtre des E/S" className="flex flex-wrap gap-1.5">
          {FILTRES.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filtre === f.id}
              onClick={() => setFiltre(f.id)}
              className={`min-h-12 rounded-lg border-2 px-4 font-semibold ${filtre === f.id ? "border-brand-700 bg-brand-700 text-white" : "border-slate-300 bg-white"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          aria-label="Rechercher une E/S par adresse ou désignation"
          placeholder="Adresse ou désignation…"
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          className="min-h-12 min-w-56 flex-1 rounded-lg border-2 border-slate-300 px-3"
        />
      </div>
      <div
        ref={parentRef}
        className="h-[70vh] overflow-auto rounded-xl border border-slate-200 bg-white"
        data-testid="liste-es"
      >
        {lignes.length === 0 ? (
          <p className="p-4 text-slate-600">Aucune E/S ne correspond.</p>
        ) : (
          <div style={{ height: virt.getTotalSize(), position: "relative" }}>
            {virt.getVirtualItems().map((v) => {
              const l = lignes[v.index]!;
              return (
                <div
                  key={l.kind === "carte" ? `c-${l.carte}` : l.point.id}
                  data-index={v.index}
                  ref={virt.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${v.start}px)`,
                  }}
                >
                  {l.kind === "carte" ? (
                    <div className="sticky top-0 bg-brand-50 px-3 py-3 font-bold text-brand-900">
                      Carte {l.carte} <span className="font-normal">({l.nb})</span>
                    </div>
                  ) : (
                    <LignePoint
                      point={l.point}
                      site={site}
                      lectureSeule={lectureSeule}
                      onSaisie={onSaisie}
                      onReserve={onReserve}
                      dejaReserve={reserves.has(`es.${l.point.id}`)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function TableLed() {
  const { donnees, preparees, maj, site, lectureSeule } = useEditeur();
  const [toutes, setToutes] = useState(!site);
  const leds = toutes ? donnees.leds : donnees.leds.filter((l) => l.designation.trim());
  return (
    <div className="space-y-2">
      {site && (
        <label className="inline-flex min-h-12 items-center gap-2">
          <input type="checkbox" className="size-6" checked={toutes} onChange={(e) => setToutes(e.target.checked)} />
          Afficher aussi les LED non affectées
        </label>
      )}
      {leds.length === 0 && <p className="text-slate-600">Aucune LED affectée.</p>}
      {leds.map((l) => (
        <div
          key={l.id}
          className="grid items-center gap-2 border-b border-slate-100 py-2 sm:grid-cols-[7rem_6rem_1fr_auto]"
        >
          <span className="font-semibold">{l.numero}</span>
          <span>{l.couleur}</span>
          <div>
            <CelluleTexte
              label={`${l.numero} ${l.couleur} — désignation`}
              valeur={l.designation}
              disabled={lectureSeule}
              onChange={(designation) => maj((d) => ({ ...d, leds: majItem(d.leds, l.id, { designation }) }))}
            />
            <MarqueCorrige prepare={preparees?.leds.find((x) => x.id === l.id)?.designation} actuel={l.designation} />
          </div>
          {site && (
            <JugementBoutons
              label={`Vérification ${l.numero} ${l.couleur}`}
              valeur={l.jugement}
              onChange={(jugement) => maj((d) => ({ ...d, leds: majItem(d.leds, l.id, { jugement }) }))}
            />
          )}
        </div>
      ))}
    </div>
  );
}

export function SectionEs() {
  return (
    <div className="space-y-5">
      <Bloc
        titre="10. Affectation cartes E/S / I-O assignment"
        sousTitre="Par E/S : testé / validé, LED, relais, remontée SCADA, message lu en supervision."
      >
        <ListeEs />
      </Bloc>
      <Bloc titre="10.2 Affectation LED / LED assignment">
        <TableLed />
      </Bloc>
    </div>
  );
}
