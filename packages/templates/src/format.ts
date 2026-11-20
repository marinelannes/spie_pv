import { TIME_ZONE, type Phaseur } from "@spie/shared";

/** Nombre au format du modèle Word (point décimal, au plus 3 décimales, zéros inutiles retirés). */
export function formatNombre(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return String(Number(n.toFixed(3)));
}

/** Angle signé comme dans le modèle : « 0° », « +120° », « -120° ». */
export function formatAngle(a: number | null | undefined): string {
  if (a === null || a === undefined || !Number.isFinite(a)) return "";
  const v = formatNombre(a);
  return a > 0 ? `+${v}°` : `${v}°`;
}

/** Amplitude et angle d'un phaseur, ex. « 57.74 V 0° ». Chaîne vide si rien n'est renseigné. */
export function formatPhaseur(p: Phaseur | null | undefined, unite: string): string {
  if (!p) return "";
  const parts: string[] = [];
  if (p.amplitude !== null) parts.push(`${formatNombre(p.amplitude)} ${unite}`.trim());
  if (p.angle !== null) parts.push(formatAngle(p.angle));
  return parts.join(" ");
}

/** « AAAA-MM-JJ » → « JJ/MM/AAAA » ; une date-heure ISO est affichée en heure de Paris. */
export function formatDate(v: string | null | undefined): string {
  if (!v) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return new Intl.DateTimeFormat("fr-FR", { timeZone: TIME_ZONE, dateStyle: "short" }).format(d);
}

/** Date-heure ISO → « JJ/MM/AAAA HH:MM » (heure de Paris). */
export function formatDateHeure(v: string | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return new Intl.DateTimeFormat("fr-FR", { timeZone: TIME_ZONE, dateStyle: "short", timeStyle: "short" }).format(d);
}

/** Valeur quelconque du journal des modifications, affichée sur une ligne. */
export function formatValeur(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = JSON.stringify(v);
  return s.length > 200 ? `${s.slice(0, 197)}…` : s;
}
