import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { ApiError } from "./api";

/**
 * Reporte les erreurs de validation renvoyées par l'API sur les champs du formulaire.
 * Renvoie le message général à afficher (ou null si tout a été rattaché à des champs).
 */
export function applyApiErrors<T extends FieldValues>(
  err: unknown,
  setError: UseFormSetError<T>,
  known: string[],
): string | null {
  if (err instanceof ApiError && err.fields) {
    let unmatched = false;
    for (const [field, messages] of Object.entries(err.fields)) {
      if (known.includes(field)) setError(field as Path<T>, { message: messages[0] });
      else unmatched = true;
    }
    return unmatched ? err.message : null;
  }
  return err instanceof Error ? err.message : "Erreur inattendue.";
}
