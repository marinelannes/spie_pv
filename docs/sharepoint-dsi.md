# spie-pv : accès de l'application au site SharePoint — demande à la DSI SPIE

L'application de saisie des PV (spie-pv) dépose automatiquement les PV signés dans l'arborescence SharePoint
existante. Pour cela, elle a besoin d'une identité applicative dans le tenant Entra ID de SPIE, **limitée en écriture à
un seul site**. Ce document décrit la demande, ses limites, les commandes à exécuter et la révocation.

## 1. Ce que nous demandons

Pour l'environnement de **recette** (la même demande sera faite plus tard pour la production, avec une application
distincte `spie-pv-production-sharepoint`) :

1. **Une app registration** mono-tenant dans le tenant SPIE : `spie-pv-recette-sharepoint`.
2. **Une seule permission** : Microsoft Graph, permission d'application **`Sites.Selected`**, avec le **consentement
   administrateur**.
3. **Le droit `write` sur un seul site** SharePoint : `https://<tenant>.sharepoint.com/sites/<site>` *(URL à confirmer
   par SPIE ; pour la recette, un site ou une bibliothèque de test est préférable)*.
4. **Une authentification par certificat.** Nous fournissons la **clé publique** (`spie-pv-recette-sharepoint.cer`). La
   clé privée a été générée dans notre Azure Key Vault (France Central) et n'en sort pas. **Aucun secret n'est échangé** :
   pas de mot de passe d'application, rien à nous transmettre de confidentiel.

## 2. Pourquoi l'accès est limité

- **`Sites.Selected` ne donne accès à aucun site par défaut.** L'application ne voit que les sites explicitement
  accordés (étape 3) ; tout autre site du tenant lui est refusé. Elle n'a aucun accès aux boîtes aux lettres, aux
  utilisateurs, à Teams ni à OneDrive.
- **Rôle `write`** : lecture et écriture de contenu (fichiers, dossiers) dans le site accordé. Pas de gestion des
  autorisations ni des paramètres du site (rôles `manage` / `fullcontrol` non demandés).
- **Pas d'écrasement** : l'application dépose avec l'option « échec si le fichier existe ». Une nouvelle révision d'un
  PV porte un nouveau nom.
- **Certificat plutôt que secret** : rien de réutilisable ne circule ni n'est stocké en clair. La clé privée n'est
  lisible que par l'identité managée de l'application (journal d'audit du Key Vault).
- **Traçabilité** : dans SharePoint, « Modifié par » affiche l'application ; l'auteur réel du PV figure dans le PDF et
  le JSON déposés.
- **Révocable à tout moment**, sans intervention de notre part (section 5).

## 3. Commandes à exécuter

### Prérequis

| Étape | Rôle Entra ID / SharePoint nécessaire |
|---|---|
| Création de l'application | Application Administrator ou Cloud Application Administrator |
| Consentement administrateur | Privileged Role Administrator ou Global Administrator |
| Droit sur le site | SharePoint Administrator ou Global Administrator |

Outils : Azure CLI 2.67+, Windows PowerShell 5.1 ou PowerShell 7, module `Microsoft.Graph.Authentication`
(`Install-Module Microsoft.Graph.Authentication -Scope CurrentUser`).
Fichiers fournis : le dossier `infra/sharepoint/` du projet et `spie-pv-recette-sharepoint.cer`.
Tous les scripts acceptent `-WhatIf` (simulation) et peuvent être relancés sans créer de doublon.

### Étape 1 — Connexion au tenant SPIE

```powershell
cd <dossier>\infra\sharepoint
Unblock-File .\*.ps1
az login --tenant <tenant-id-SPIE> --allow-no-subscriptions
```

### Étape 2 — App registration, permission, certificat, consentement

```powershell
.\New-SharePointAppRegistration.ps1 -Environment recette -CertificateFile .\spie-pv-recette-sharepoint.cer -TenantId <tenant-id-SPIE> -GrantAdminConsent
```

Le script crée l'application et son principal de service, déclare `Sites.Selected` (id du rôle lu dans le tenant),
ajoute la clé publique et accorde le consentement. Il affiche en fin d'exécution le **client id**.

### Étape 3 — Écriture sur le seul site cible

```powershell
.\Grant-SharePointSiteAccess.ps1 -SiteUrl https://<tenant>.sharepoint.com/sites/<site> -ClientId <client-id> -Environment recette -AuthMode MgGraph -TenantId <tenant-id-SPIE>
```

Une fenêtre de connexion Microsoft s'ouvre (consentement à `Sites.FullControl.All` pour **votre** session
d'administration, nécessaire pour gérer les permissions d'un site). Le script résout l'id du site, accorde le rôle
`write` à l'application (`POST /sites/{site-id}/permissions`) et affiche le **site id**.
`-AuthMode AzCli` fait les mêmes appels avec `az rest`, mais ne fonctionne qu'avec une session Azure CLI disposant de
`Sites.FullControl.All` (par exemple un principal de service d'administration) : le jeton d'un utilisateur Azure CLI ne
porte pas les permissions SharePoint.

### Sans les scripts (équivalent manuel)

- Portail Entra : *Inscriptions d'applications > Nouvelle inscription* (comptes de cet annuaire uniquement) ;
  *Certificats et secrets > Certificats > Charger* le `.cer` ; *Autorisations de l'API > Ajouter > Microsoft Graph >
  Autorisations d'application > Sites.Selected* ; *Accorder un consentement d'administrateur pour SPIE*.
- Droit sur le site (Microsoft Graph PowerShell) :

```powershell
Connect-MgGraph -Scopes Sites.FullControl.All
$site = Invoke-MgGraphRequest GET "https://graph.microsoft.com/v1.0/sites/<tenant>.sharepoint.com:/sites/<site>"
$corps = @{ roles = @('write'); grantedToIdentities = @(@{ application = @{ id = '<client-id>'; displayName = 'spie-pv-recette-sharepoint' } }) } | ConvertTo-Json -Depth 5
Invoke-MgGraphRequest POST "https://graph.microsoft.com/v1.0/sites/$($site.id)/permissions" -Body $corps -ContentType 'application/json'
$site.id   # site id à nous renvoyer
```

## 4. Ce qu'il faut nous renvoyer

| Information | Forme |
|---|---|
| Tenant id SPIE | GUID |
| Client id de `spie-pv-recette-sharepoint` | GUID |
| Site id | `<tenant>.sharepoint.com,<guid>,<guid>` |
| URL du site accordé | `https://<tenant>.sharepoint.com/sites/<site>` |

Ces identifiants ne sont pas des secrets. Les deux scripts les affichent en fin d'exécution. Nous vérifions ensuite,
avec l'identité de l'application, que le site cible est accessible et qu'un autre site est refusé.

## 5. Révocation

| Action | Commande | Effet |
|---|---|---|
| Retirer l'accès au site | `.\Grant-SharePointSiteAccess.ps1 -SiteUrl <url> -ClientId <client-id> -AuthMode MgGraph -Revoke` | Plus aucun accès au site ; l'application n'a alors accès à rien |
| Bloquer immédiatement l'application | `az ad sp update --id <client-id> --set accountEnabled=false` | Plus aucun jeton délivré |
| Retirer le certificat | `az ad app credential list --id <client-id> --cert` puis `az ad app credential delete --id <client-id> --key-id <key-id> --cert` | L'application ne peut plus s'authentifier |
| Supprimer l'application | `az ad app delete --id <client-id>` | Suppression (restaurable 30 jours depuis les éléments supprimés d'Entra ID) |

Les fichiers déjà déposés restent dans SharePoint. Côté spie-pv, les dépôts suivants passent en erreur et restent
consultables et relançables depuis le back-office ; une copie de chaque fichier est conservée dans notre stockage Azure.

## 6. Renouvellement du certificat

Le certificat est valable **12 mois** (24 au maximum si votre politique l'autorise). Un mois avant l'échéance, nous
transmettons une nouvelle clé publique : relancer l'étape 2 avec le nouveau fichier `.cer` (l'ancienne clé est
conservée pendant la bascule), puis retirer l'ancienne clé quand nous le confirmons.
