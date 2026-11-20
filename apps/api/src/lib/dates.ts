import { parisDateTimeParts } from "@spie/shared";

/** Date du jour à Paris au format AAAA-MM-JJ (tableau des révisions, signatures). */
export function parisIsoDate(d: Date): string {
  const { date } = parisDateTimeParts(d);
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}
