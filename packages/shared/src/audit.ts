/** Actions tracées dans le journal d'audit (spec §4.6, §7.4). Les actions PV arrivent au lot 1. */
export const AUDIT_ACTIONS = {
  "auth.login": "Connexion",
  "auth.login_failed": "Échec de connexion",
  "auth.locked": "Compte verrouillé (trop d'échecs)",
  "auth.logout": "Déconnexion",
  "auth.password_changed": "Mot de passe modifié",
  "auth.refresh_reuse": "Réutilisation d'un jeton de rafraîchissement (sessions révoquées)",
  "user.created": "Compte créé",
  "user.updated": "Compte modifié",
  "user.password_reset": "Mot de passe réinitialisé",
  "affaire.created": "Affaire créée",
  "affaire.updated": "Affaire modifiée",
  "affaire.affectations": "Affectations modifiées",
  "sharepoint.test_upload": "Dépôt de test SharePoint",
} as const;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

export interface AuditEntryDto {
  id: string;
  at: string;
  action: AuditAction;
  actor: { id: string; email: string; nom: string } | null;
  targetType: string | null;
  targetId: string | null;
  details: Record<string, unknown> | null;
  ip: string | null;
}
