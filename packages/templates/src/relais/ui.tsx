/** @jsxRuntime automatic */
/** @jsxImportSource react */
// Pragmas : le JSX est compilé en runtime automatique même quand le paquet est intégré à un bundle dont le
// tsconfig ne règle pas « jsx » (API empaquetée par tsup).
import type { Jugement } from "@spie/shared";
import type { ReactNode } from "react";

/** Case à cocher imprimée (cochée = « X »). */
export function Case({ coche }: { coche: boolean }) {
  return <span className={coche ? "case coche" : "case"} />;
}

/** Cellule de jugement C / NC / NA (NC mis en évidence). */
export function JugementTd({ valeur }: { valeur: Jugement | "OK" | "NOK" | null | undefined }) {
  const nc = valeur === "NC" || valeur === "NOK";
  return <td className={nc ? "j nc" : "j"}>{valeur ?? ""}</td>;
}

/** Libellé bilingue « Français / English » d'un en-tête. */
export function Bi({ fr, en }: { fr: string; en: string }) {
  return (
    <>
      {fr}
      {en && (
        <>
          {" / "}
          <span className="en">{en}</span>
        </>
      )}
    </>
  );
}

export function Titre1({
  id,
  numero,
  fr,
  en,
  sautAvant,
}: {
  id: string;
  numero: string;
  fr: string;
  en: string;
  sautAvant?: boolean;
}) {
  return (
    <h1 id={id} className={sautAvant ? "saut-avant" : undefined}>
      <span className="num">{numero}.</span>
      {fr} / {en}
    </h1>
  );
}

export function Titre2({ id, numero, children }: { id: string; numero: string; children: ReactNode }) {
  return (
    <h2 id={id}>
      <span className="num">{numero}</span>
      {children}
    </h2>
  );
}

/** Texte saisi, ou tiret discret quand il est vide. */
export function Val({ v }: { v: string | null | undefined }) {
  return v && v.trim() !== "" ? <>{v}</> : null;
}
