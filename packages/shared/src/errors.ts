/** Corps de réponse d'erreur commun à toutes les routes de l'API. */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    /** Erreurs de validation par champ (chemin « a.b » → messages). */
    fields?: Record<string, string[]>;
  };
}

export type ApiErrorCode =
  | "validation"
  | "unauthorized"
  | "invalid_credentials"
  | "account_locked"
  | "account_disabled"
  | "password_change_required"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "integrity"
  | "payload_too_large"
  | "sharepoint_not_configured"
  | "sharepoint_error"
  | "rate_limited"
  | "internal";
