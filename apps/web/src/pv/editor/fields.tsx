import { JUGEMENT_LABELS, valeurLisible, type Jugement, type Phaseur } from "@spie/shared";
import { useEffect, useId, useRef, useState, type ReactNode, type TextareaHTMLAttributes } from "react";
import { estCorrige, formatNombre, parseNombre, useEditeur } from "./context";

// Ergonomie terrain (spec §9) : jugements en gros boutons, cibles ≥ 48 px, utilisables avec des gants.

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

const TONS: Record<string, string> = {
  C: "border-green-700 bg-green-700 text-white",
  OK: "border-green-700 bg-green-700 text-white",
  NC: "border-red-700 bg-red-700 text-white",
  NOK: "border-red-700 bg-red-700 text-white",
  NA: "border-slate-600 bg-slate-600 text-white",
};

/** Boutons de choix exclusif (C / NC / NA, OK / NOK…). Un second appui sur le choix courant l'efface. */
export function ChoixBoutons<T extends string>({
  valeur,
  options,
  onChange,
  label,
  disabled,
  titres,
}: {
  valeur: T | null;
  options: readonly T[];
  onChange: (v: T | null) => void;
  label: string;
  disabled?: boolean;
  titres?: Partial<Record<T, string>>;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex gap-1.5">
      {options.map((o) => {
        const actif = valeur === o;
        return (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={actif}
            title={titres?.[o]}
            disabled={disabled}
            onClick={() => onChange(actif ? null : o)}
            className={cx(
              "min-h-12 min-w-14 rounded-lg border-2 px-3 text-base font-bold transition-colors",
              actif
                ? (TONS[o] ?? "border-brand-700 bg-brand-700 text-white")
                : "border-slate-300 bg-white text-slate-800 hover:border-brand-500",
              "disabled:cursor-not-allowed disabled:opacity-60",
            )}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

const JUGEMENTS = ["C", "NC", "NA"] as const;

export function JugementBoutons({
  valeur,
  onChange,
  label,
  sansNa,
}: {
  valeur: Jugement | null;
  onChange: (v: Jugement | null) => void;
  label: string;
  sansNa?: boolean;
}) {
  const { lectureSeule } = useEditeur();
  return (
    <ChoixBoutons
      valeur={valeur}
      options={sansNa ? (["C", "NC"] as const) : JUGEMENTS}
      onChange={onChange}
      label={label}
      disabled={lectureSeule}
      titres={JUGEMENT_LABELS}
    />
  );
}

/** Repère d'une valeur préparée corrigée sur site, avec la valeur d'origine. */
export function MarqueCorrige({ prepare, actuel }: { prepare: unknown; actuel: unknown }) {
  const { site, preparees } = useEditeur();
  if (!site || !preparees || !estCorrige(prepare, actuel)) return null;
  const txt = valeurLisible(prepare).replace(/\n/g, " ; ");
  return (
    <span className="mt-1 inline-block rounded bg-amber-100 px-2 py-0.5 text-sm text-amber-900">
      Corrigé sur site — préparé : « {txt} »
    </span>
  );
}

/** Style commun des saisies, sans largeur (le champ nombre a sa propre largeur : pas de conflit w-full / w-24). */
const inputBase =
  "block min-h-12 rounded-lg border-2 border-slate-300 bg-white px-3 text-base text-slate-900 " +
  "focus:border-brand-600 focus:outline-none disabled:bg-slate-100 disabled:text-slate-700";
const inputClass = `${inputBase} w-full`;

/** Champ texte libellé, avec repère de correction de la valeur préparée. */
export function ChampTexte({
  label,
  valeur,
  onChange,
  prepare,
  multiligne,
  placeholder,
  disabled,
  className,
}: {
  label: string;
  valeur: string;
  onChange: (v: string) => void;
  prepare?: string | undefined;
  multiligne?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const { lectureSeule } = useEditeur();
  const id = useId();
  return (
    <div className={cx("space-y-1", className)}>
      <label htmlFor={id} className="block font-medium text-slate-800">
        {label}
      </label>
      {multiligne ? (
        <TexteMultiligne
          id={id}
          value={valeur}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled || lectureSeule}
        />
      ) : (
        <input
          id={id}
          className={inputClass}
          value={valeur}
          placeholder={placeholder}
          disabled={disabled || lectureSeule}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {prepare !== undefined && <MarqueCorrige prepare={prepare} actuel={valeur} />}
    </div>
  );
}

export function TexteMultiligne(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={2} {...props} className={cx(inputClass, "py-2", props.className)} />;
}

/** Saisie compacte sans libellé visible (cellule de tableau). */
export function CelluleTexte({
  label,
  valeur,
  onChange,
  disabled,
  className,
  placeholder,
}: {
  label: string;
  valeur: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}) {
  const { lectureSeule } = useEditeur();
  return (
    <input
      aria-label={label}
      className={cx(inputClass, className)}
      value={valeur}
      placeholder={placeholder}
      disabled={disabled || lectureSeule}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** Nombre au pavé numérique (spec §4.2). Le texte saisi est conservé tant qu'il n'est pas un nombre valide. */
export function ChampNombre({
  label,
  valeur,
  onChange,
  unite,
  disabled,
  className,
}: {
  label: string;
  valeur: number | null;
  onChange: (v: number | null) => void;
  unite?: string;
  disabled?: boolean;
  className?: string;
}) {
  const { lectureSeule } = useEditeur();
  const [texte, setTexte] = useState(formatNombre(valeur));
  // Texte invalide laissé en quittant le champ : il reste affiché, avec un message (jamais effacé en silence).
  const [signale, setSignale] = useState(false);
  const focus = useRef(false);
  useEffect(() => {
    // Valeur modifiée ailleurs (synchro, annulation) : on l'affiche, sauf pendant la frappe.
    if (!focus.current) {
      setTexte(formatNombre(valeur));
      setSignale(false);
    }
  }, [valeur]);
  const invalide = parseNombre(texte) === undefined;
  const enregistree = formatNombre(valeur);
  return (
    <span className={cx("inline-flex flex-wrap items-center gap-x-2 gap-y-1", className)}>
      {/* Champ et unité restent ensemble ; seul le message d'erreur passe à la ligne. */}
      <span className="inline-flex items-center gap-1">
        <input
          aria-label={label}
          aria-invalid={invalide}
          inputMode="decimal"
          enterKeyHint="next"
          className={cx(inputBase, "w-24 text-right tabular-nums aria-[invalid=true]:border-red-600")}
          value={texte}
          disabled={disabled || lectureSeule}
          onFocus={() => (focus.current = true)}
          onBlur={() => {
            focus.current = false;
            if (invalide) setSignale(true);
            else setTexte(formatNombre(valeur));
          }}
          onChange={(e) => {
            setTexte(e.target.value);
            const n = parseNombre(e.target.value);
            if (n !== undefined) {
              setSignale(false);
              onChange(n);
            }
          }}
        />
        {unite && <span className="text-slate-600">{unite}</span>}
      </span>
      {signale && invalide && (
        <span role="alert" className="text-sm font-semibold text-red-800">
          Nombre attendu (ex. 57,7) : valeur enregistrée {enregistree ? `« ${enregistree} »` : "vide"}.
        </span>
      )}
    </span>
  );
}

/** Amplitude et angle saisis séparément (spec §4.2). */
export function ChampPhaseur({
  label,
  valeur,
  onChange,
  unite,
  disabled,
}: {
  label: string;
  valeur: Phaseur;
  onChange: (v: Phaseur) => void;
  unite: string;
  disabled?: boolean;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <ChampNombre
        label={`${label} — amplitude (${unite})`}
        valeur={valeur.amplitude}
        unite={unite}
        disabled={disabled}
        onChange={(amplitude) => onChange({ ...valeur, amplitude })}
      />
      <ChampNombre
        label={`${label} — angle (°)`}
        valeur={valeur.angle}
        unite="°"
        disabled={disabled}
        onChange={(angle) => onChange({ ...valeur, angle })}
      />
    </span>
  );
}

/** Affichage d'un phaseur en lecture seule : « 57,74 V 0° ». */
export function textePhaseur(p: Phaseur, unite: string): string {
  if (p.amplitude === null && p.angle === null) return "—";
  const a = p.amplitude === null ? "…" : `${formatNombre(p.amplitude)} ${unite}`;
  const ang = p.angle === null ? "" : ` ${p.angle > 0 ? "+" : ""}${formatNombre(p.angle)}°`;
  return `${a}${ang}`;
}

export function Bloc({
  titre,
  sousTitre,
  children,
  actions,
}: {
  titre: string;
  sousTitre?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-bold text-slate-900">{titre}</h3>
          {sousTitre && <p className="text-slate-600">{sousTitre}</p>}
        </div>
        {actions}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

export function BoutonPetit({
  children,
  onClick,
  danger,
  disabled,
  label,
}: {
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "min-h-12 rounded-lg border-2 px-3 font-semibold disabled:cursor-not-allowed disabled:opacity-50",
        danger ? "border-red-300 text-red-800 hover:bg-red-50" : "border-brand-200 text-brand-800 hover:bg-brand-50",
      )}
    >
      {children}
    </button>
  );
}
