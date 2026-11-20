import { TIME_ZONE, parisDateTimeParts } from "@spie/shared";

const dateTime = new Intl.DateTimeFormat("fr-FR", {
  timeZone: TIME_ZONE,
  dateStyle: "short",
  timeStyle: "short",
});

export function formatDateTime(iso: string | null | undefined): string {
  return iso ? dateTime.format(new Date(iso)) : "—";
}

/** Date du jour à Paris au format AAAA-MM-JJ (champs date des PV). */
export function isoDateParis(d: Date): string {
  const { date } = parisDateTimeParts(d);
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}

/** « 2026-11-19 » → « 19/11/2026 » ; chaîne vide ou mal formée : renvoyée telle quelle. */
export function formatDateIso(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** Taille lisible : « 1,5 Mo ». */
export function formatOctets(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const unites = ["o", "Ko", "Mo", "Go"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < unites.length - 1) {
    v /= 1024;
    i++;
  }
  const s = i === 0 ? String(Math.round(v)) : v.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
  return `${s} ${unites[i]}`;
}
