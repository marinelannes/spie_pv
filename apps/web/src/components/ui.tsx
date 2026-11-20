import {
  forwardRef,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";

// Ergonomie terrain (spec §9) : cibles tactiles ≥ 48 px, texte ≥ 16 px, contraste élevé.

const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const buttonStyles: Record<ButtonVariant, string> = {
  primary: "bg-brand-700 text-white hover:bg-brand-800 disabled:bg-slate-400",
  secondary:
    "bg-white text-brand-800 border-2 border-brand-700 hover:bg-brand-50 disabled:border-slate-300 disabled:text-slate-400",
  danger: "bg-red-700 text-white hover:bg-red-800 disabled:bg-slate-400",
  ghost: "text-brand-800 hover:bg-brand-50 disabled:text-slate-400",
};

export function Button({
  variant = "primary",
  className,
  busy,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; busy?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || busy}
      className={cx(
        "inline-flex min-h-12 items-center justify-center gap-2 rounded-lg px-5 text-base font-semibold transition-colors",
        "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed",
        buttonStyles[variant],
        className,
      )}
    >
      {busy && <Spinner small />}
      {children}
    </button>
  );
}

const inputBase =
  "block w-full min-h-12 rounded-lg border-2 border-slate-300 bg-white px-3 text-base text-brand-700 " +
  "focus:border-brand-600 focus:outline-none aria-[invalid=true]:border-red-600 disabled:bg-slate-100";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} {...props} className={cx(inputBase, className)} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, ...props },
  ref,
) {
  return <select ref={ref} {...props} className={cx(inputBase, "pr-8", className)} />;
});

/** Champ de formulaire : libellé, contrôle, aide et erreur reliés pour l'accessibilité. */
export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: (props: { id: string; "aria-invalid": boolean; "aria-describedby"?: string }) => ReactNode;
}) {
  const id = useId();
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-base font-medium text-brand-700">
        {label}
      </label>
      {children({ id, "aria-invalid": Boolean(error), "aria-describedby": describedBy })}
      {error ? (
        <p id={`${id}-err`} className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-slate-600">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-lg border border-slate-200 bg-white p-5 shadow-sm", className)}>{children}</section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-brand-700">{title}</h1>
        {subtitle && <p className="mt-1 text-slate-600">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-3">{actions}</div>}
    </div>
  );
}

const alertStyles = {
  error: "border-red-300 bg-red-50 text-red-900",
  success: "border-green-300 bg-green-50 text-green-900",
  info: "border-brand-200 bg-brand-50 text-brand-900",
  warning: "border-amber-300 bg-amber-50 text-amber-900",
};

export function Alert({ kind = "info", children }: { kind?: keyof typeof alertStyles; children: ReactNode }) {
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={cx("rounded-lg border-2 px-4 py-3", alertStyles[kind])}
    >
      {children}
    </div>
  );
}

const badgeStyles = {
  neutral: "bg-slate-100 text-brand-700",
  blue: "bg-brand-100 text-brand-900",
  green: "bg-green-100 text-green-900",
  red: "bg-red-100 text-red-900",
  amber: "bg-amber-100 text-amber-900",
};

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof badgeStyles; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-sm font-medium",
        badgeStyles[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Spinner({ small }: { small?: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(
        "inline-block animate-spin rounded-full border-current border-r-transparent",
        small ? "size-4 border-2" : "size-8 border-4 text-brand-700",
      )}
    />
  );
}

export function Loading({ label = "Chargement…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-10 text-slate-600" role="status">
      <Spinner /> {label}
    </div>
  );
}

/** Tableau à défilement horizontal sur petit écran. */
export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full min-w-[640px] text-left text-base">
        <thead className="bg-slate-100 text-sm uppercase tracking-wide text-slate-700">
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col" className="px-4 py-3 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cx("px-4 py-3 align-middle", className)}>{children}</td>;
}

/** Mot de passe provisoire affiché une seule fois après création ou réinitialisation. */
export function TemporaryPassword({
  email,
  password,
  onClose,
}: {
  email: string;
  password: string;
  onClose: () => void;
}) {
  const [copie, setCopie] = useState<"ok" | "echec" | null>(null);
  const copier = async () => {
    try {
      // Presse-papiers indisponible (page non sécurisée, permission refusée) : message explicite, pas d'échec muet.
      if (!navigator.clipboard) throw new Error("presse-papiers indisponible");
      await navigator.clipboard.writeText(password);
      setCopie("ok");
    } catch {
      setCopie("echec");
    }
  };
  return (
    <Alert kind="success">
      <p className="font-semibold">Mot de passe provisoire pour {email}</p>
      <p className="my-2 select-all font-mono text-2xl tracking-wider">{password}</p>
      <p className="text-sm">
        Transmettez-le à l'utilisateur par un canal sûr. Il ne sera plus affiché et devra être changé à la première
        connexion.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => void copier()}>
          {copie === "ok" ? "Copié ✓" : "Copier"}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Fermer
        </Button>
        <span className="text-sm font-semibold">
          {copie === "ok" && "Mot de passe copié dans le presse-papiers."}
          {copie === "echec" && (
            <span className="text-red-800">
              Copie impossible : sélectionnez le mot de passe et copiez-le à la main.
            </span>
          )}
        </span>
      </div>
    </Alert>
  );
}
