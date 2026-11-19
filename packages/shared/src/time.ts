/** Fuseau de référence des numéros de PV et des horodatages affichés (spec §4.1). */
export const TIME_ZONE = "Europe/Paris";

const formatter = new Intl.DateTimeFormat("fr-FR", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Date et heure locales de Paris : `{ date: "AAAAMMJJ", time: "HHMMSS" }`. */
export function parisDateTimeParts(d: Date): { date: string; time: string } {
  const parts = Object.fromEntries(formatter.formatToParts(d).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}${parts.month}${parts.day}`,
    time: `${parts.hour}${parts.minute}${parts.second}`,
  };
}
