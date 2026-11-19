import { TIME_ZONE } from "@spie/shared";

const dateTime = new Intl.DateTimeFormat("fr-FR", {
  timeZone: TIME_ZONE,
  dateStyle: "short",
  timeStyle: "short",
});

export function formatDateTime(iso: string | null | undefined): string {
  return iso ? dateTime.format(new Date(iso)) : "—";
}
