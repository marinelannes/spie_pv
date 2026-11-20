/** Actions tracées dans le journal d'audit (spec §4.6, §7.4). */
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
  "sharepoint.familles": "Paramétrage SharePoint modifié",
  "io_liste.importee": "Liste E/S importée",
  "equipement.association": "Feuille E/S d'un équipement modifiée",
  "pv.prepare": "PV créé (préparation)",
  "pv.prepare_modifie": "PV préparé modifié",
  "pv.supprime": "PV préparé supprimé",
  "pv.duplique": "PV dupliqué",
  "pv.affectations": "Techniciens du PV modifiés",
  "pv.saisie_commencee": "Saisie du PV commencée sur tablette",
  "pv.recu": "PV signé reçu",
  "pv.doublon_numero": "Numéro de PV en double",
  "pv.valeurs_modifiees": "Valeurs pré-remplies modifiées sur site",
  "depot.reussi": "PV déposé dans SharePoint",
  "depot.erreur": "Dépôt SharePoint en erreur",
  "depot.relance": "Dépôt SharePoint relancé",
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
