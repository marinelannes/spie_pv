# Infrastructure Azure et déploiement — spie-pv

Ce document décrit le socle Azure du lot 0 (environnement de **recette**), la chaîne CI/CD et l'ordre du premier
déploiement, jusqu'au critère de fin du lot 0 : **un fichier de test est déposé dans le site SharePoint cible depuis
l'API de recette**.

| Élément | Emplacement |
|---|---|
| Templates Bicep | `infra/main.bicep`, `infra/modules/*.bicep` |
| Paramètres par environnement | `infra/main.recette.bicepparam`, `infra/main.production.bicepparam` |
| Script post-déploiement (secrets) | `infra/scripts/Initialize-KeyVaultSecrets.ps1` |
| Certificat et accès SharePoint | `infra/sharepoint/*.ps1`, procédure DSI : [`sharepoint-dsi.md`](sharepoint-dsi.md) |
| Workflows GitHub Actions | `.github/workflows/ci.yml`, `deploy-recette.yml`, `infra.yml` |

---

## 1. Hypothèses (points ouverts de la spec, section 12)

| # | Point ouvert | Hypothèse retenue |
|---|---|---|
| 3 | Souscription Azure (SPIE ou Predexia) | Inconnue. Tout est déployé **dans un groupe de ressources** créé au préalable, sans dépendance à une souscription précise. Le tenant de la souscription peut être différent du tenant Entra ID de SPIE : l'app registration SharePoint vit dans le tenant SPIE, le certificat dans notre Key Vault, seule la **clé publique** est échangée. |
| 4 | GitHub ou Azure DevOps | **GitHub Actions** avec authentification OIDC (aucun secret Azure stocké). Les étapes sont de simples commandes `az` et `docker` : une transposition vers Azure Pipelines (connexion de service à fédération d'identité) reste directe. |
| 1 | Site SharePoint cible | Pas encore fourni. Tant que `graphTenantId`, `graphClientId` et `sharepointSiteId` sont vides, l'application est déployée avec `SHAREPOINT_MODE=disabled` (l'API refuse de démarrer en mode `graph` incomplet). |
| 2 | Accord de la DSI SPIE | Prérequis du test de dépôt. La demande et les commandes sont dans [`sharepoint-dsi.md`](sharepoint-dsi.md). Tout le reste du socle peut être déployé sans attendre. |

---

## 2. Ressources déployées

Région **France Central** (`francecentral`, spec 7.4). Tags sur toutes les ressources : `projet=spie-pv`, `env=<recette|production>`.

Nommage : `<préfixe>-<env>-<type>` (préfixe `spie-pv`) ; pour les noms globaux et contraints (ACR, Key Vault, stockage
sans tiret, PostgreSQL en DNS public), un suffixe stable de 6 caractères dérivé de l'id du groupe de ressources
(`uniqueString`). Les noms exacts sont donnés par les **sorties** du déploiement.

| Ressource | Nom (recette) | Configuration |
|---|---|---|
| Identité managée user-assigned | `spie-pv-recette-id` | Utilisée par l'API et le worker. Rôles : **AcrPull** (ACR), **Key Vault Secrets User** (Key Vault), **Storage Blob Data Contributor** (stockage) |
| Log Analytics | `spie-pv-recette-log` | Rétention 30 j, plafond 1 Go/jour en recette |
| Application Insights | `spie-pv-recette-appi` | Basé sur l'espace Log Analytics |
| Container Registry | `spiepvrecetteacr<suffixe>` | **Basic**, compte admin désactivé, dépôt `spie-pv` |
| Key Vault | `spiepvrecettekv<suffixe>` | Standard, **RBAC**, soft delete 90 j, **purge protection**, journal d'audit vers Log Analytics |
| Stockage | `spiepvrecettest<suffixe>` | StorageV2, LRS, TLS 1.2 min., aucun accès public, **clés partagées désactivées** (Entra ID uniquement), soft delete blobs + conteneurs 30 j, conteneur `pv-files` |
| PostgreSQL Flexible Server | `spie-pv-recette-psql-<suffixe>` | v16, Burstable **Standard_B1ms**, 32 Go (agrandissement auto), sauvegarde **7 j** (restauration à un instant donné), TLS obligatoire, accès public + règle « Allow Azure services », base `spiepv` |
| Environnement Container Apps | `spie-pv-recette-cae` | Profil **Consumption**, journaux vers Log Analytics |
| Container App API | `spie-pv-recette-api` | Ingress externe **HTTPS uniquement**, port 3000, 1 à 2 réplicas, sondes startup / liveness / readiness sur `GET /api/health`, 0,5 vCPU / 1 Gi |
| Container App worker | `spie-pv-recette-worker` | **Sans ingress**, 1 réplica, commande `node dist/worker.js`, 1 vCPU / 2 Gi (Chromium en lot 1) |

### Configuration des conteneurs

Variables non secrètes : `NODE_ENV=production`, `PORT=3000`, `COOKIE_SECURE=true`, `WEB_DIST_DIR=/app/public`,
`SHAREPOINT_MODE`, `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `SHAREPOINT_SITE_ID` (ces trois-là seulement lorsqu'elles sont
connues), `APPLICATIONINSIGHTS_CONNECTION_STRING`, `AZURE_STORAGE_ACCOUNT_URL`, `AZURE_STORAGE_CONTAINER=pv-files`,
`AZURE_CLIENT_ID` (client id de l'identité managée), ainsi que `APP_ENV_LABEL` (nom de l'environnement) et
`APP_VERSION` (tag de l'image, renvoyé par `/api/health`).

Secrets : secrets Container Apps **référençant le Key Vault** (dernière version), lus avec l'identité managée.

| Variable | Secret Key Vault | Créé par |
|---|---|---|
| `DATABASE_URL` | `database-url` | Le Bicep, à partir des paramètres PostgreSQL (`postgres://…@<serveur>:5432/spiepv?sslmode=require`) |
| `JWT_SECRET` | `jwt-secret` | `infra/scripts/Initialize-KeyVaultSecrets.ps1` (64 caractères hexadécimaux aléatoires) |
| `GRAPH_CERT_PEM` | `graph-cert` | Secret adossé au **certificat** Key Vault `graph-cert` (PEM), créé par `infra/sharepoint/New-GraphCertificate.ps1` |

> Les Container Apps ne démarrent pas si `jwt-secret` ou `graph-cert` manquent : le script post-déploiement doit
> passer **avant** la création des applications (voir section 4).

### Choix : `jwt-secret` et certificat hors Bicep

- **`jwt-secret`** : un template ne sait pas « créer si absent ». Une valeur générée dans le Bicep (`newGuid()`)
  changerait à chaque déploiement et invaliderait toutes les sessions ; un paramètre sécurisé obligerait à conserver
  le secret ailleurs que dans le coffre (GitHub, poste) pour chaque redéploiement. Le script le crée **une fois**, sans
  l'afficher ni le passer en ligne de commande ; `-RotateJwtSecret` permet une rotation volontaire.
- **Certificat `graph-cert`** : les certificats Key Vault n'ont pas de ressource ARM. Le script le génère **dans** le
  coffre (auto-signé, RSA 2048, PEM, 12 mois par défaut, 24 au maximum) : la clé privée ne sort jamais du coffre ; seule
  la clé publique (`.cer`) est exportée pour la DSI. Pas de renouvellement automatique (voir section 6).
- **`database-url`** : construit par le Bicep à partir du mot de passe administrateur (paramètre sécurisé), qui doit de
  toute façon être fourni au serveur PostgreSQL.

### Choix : pas d'image « placeholder » au premier déploiement

Les Container Apps ne sont créées que lorsque `imageTag` est renseigné. Une image publique de démonstration
(`mcr.microsoft.com/k8se/quickstart`, par exemple) écoute sur le port 80 et n'expose pas `/api/health` : il faudrait
créer les applications avec un autre port et sans sondes, puis compter sur `az containerapp update --image`, qui ne
corrige ni le port de l'ingress ni les sondes. La configuration réelle divergerait du Bicep. On préfère un premier
déploiement en deux temps : socle sans applications, publication de l'image, puis création des applications avec la
vraie image et la vraie configuration.

---

## 3. Prérequis

### Outils (poste d'exploitation)

- Azure CLI **2.67 ou plus récent** (`az version`), Bicep (`az bicep install`).
- Windows PowerShell 5.1 ou PowerShell 7 pour les scripts `.ps1`. Si l'exécution des scripts est bloquée :
  `Unblock-File .\infra\sharepoint\*.ps1, .\infra\scripts\*.ps1` ou `Set-ExecutionPolicy -Scope Process Bypass`.

### Souscription et groupe de ressources

À faire une fois par environnement, par un propriétaire de la souscription :

```powershell
az login --tenant <tenant-id-de-la-souscription>
az account set --subscription <id-souscription>

# Fournisseurs de ressources utilisés
foreach ($ns in 'Microsoft.App','Microsoft.ContainerRegistry','Microsoft.KeyVault','Microsoft.DBforPostgreSQL',
                'Microsoft.OperationalInsights','Microsoft.Insights','Microsoft.Storage','Microsoft.ManagedIdentity') {
  az provider register --namespace $ns
}

az group create --name <groupe-recette> --location francecentral --tags projet=spie-pv env=recette
```

### Identité de déploiement GitHub (OIDC)

Une identité managée par environnement, avec une **identité fédérée** liée à l'environnement GitHub : aucun secret
Azure n'est stocké dans GitHub. Le sujet du jeton GitHub est `repo:<organisation>/<dépôt>:environment:<env>` car les
jobs déclarent un environnement.

```powershell
az identity create --name spie-pv-recette-github --resource-group <groupe-recette> --location francecentral --tags projet=spie-pv env=recette

az identity federated-credential create --name github-recette --identity-name spie-pv-recette-github --resource-group <groupe-recette> --issuer https://token.actions.githubusercontent.com --subject repo:<organisation>/<depot>:environment:recette --audiences api://AzureADTokenExchange

# client id -> secret GitHub AZURE_CLIENT_ID ; principal id -> attributions de rôles
az identity show --name spie-pv-recette-github --resource-group <groupe-recette> --query "{clientId: clientId, principalId: principalId}"
```

Rôles sur le **groupe de ressources** :

| Rôle | Pourquoi |
|---|---|
| **Contributor** | Déployer le Bicep, publier les images dans l'ACR, mettre à jour les Container Apps |
| **Role Based Access Control Administrator**, avec condition | Créer les attributions de rôles du Bicep. Condition « n'attribuer que les rôles sélectionnés » : AcrPull, Key Vault Secrets User, Storage Blob Data Contributor, Key Vault Secrets Officer, Key Vault Certificates Officer |

```powershell
az role assignment create --assignee-object-id <principal-id> --assignee-principal-type ServicePrincipal --role Contributor --scope /subscriptions/<id-souscription>/resourceGroups/<groupe-recette>
```

Pour le second rôle, le plus simple est le portail (*Contrôle d'accès (IAM) > Ajouter une attribution de rôle > Role
Based Access Control Administrator > Conditions > Autoriser l'utilisateur à attribuer uniquement les rôles
sélectionnés*). En ligne de commande (bash), condition équivalente :

```bash
ROLES="7f951dda-4ed3-4680-a7ca-43fe172d538d, 4633458b-17de-408a-b874-0445c86b69e6, ba92f5b4-2d11-453d-a403-e96b0029c9fe, b86a8fe4-44ce-4948-aee5-eccb2c155cd7, a4417e6f-fecd-4de8-b567-7b0420556985"
CONDITION="((!(ActionMatches{'Microsoft.Authorization/roleAssignments/write'})) OR (@Request[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {$ROLES})) AND ((!(ActionMatches{'Microsoft.Authorization/roleAssignments/delete'})) OR (@Resource[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {$ROLES}))"
az role assignment create --assignee-object-id <principal-id> --assignee-principal-type ServicePrincipal \
  --role "Role Based Access Control Administrator" \
  --scope /subscriptions/<id-souscription>/resourceGroups/<groupe-recette> \
  --condition "$CONDITION" --condition-version 2.0
```

### Mot de passe administrateur PostgreSQL

Généré une fois, conservé dans le gestionnaire de mots de passe de l'équipe et dans le secret GitHub
`POSTGRES_ADMIN_PASSWORD`. **Il doit rester identique** d'un déploiement à l'autre (un autre mot de passe serait
appliqué au serveur). 16 caractères minimum ; majuscules, minuscules et chiffres.

```powershell
$o = New-Object byte[] 24; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($o); [Convert]::ToBase64String($o)
```

### Opérateurs du Key Vault

Les personnes (ou le groupe) qui exécutent les scripts post-déploiement sont déclarées dans `keyVaultOperators` du
fichier `.bicepparam` (rôles Key Vault Secrets Officer et Certificates Officer sur le coffre) :

```powershell
az ad user show --id <email> --query id -o tsv          # ou : az ad group show --group <nom> --query id -o tsv
```

### Environnements GitHub

Créer les environnements `recette` et `production` (*Settings > Environments*), limiter leurs branches de déploiement à
`main`, et ajouter des **relecteurs obligatoires** sur `production`.

| Type | Nom | Valeur | Utilisé par |
|---|---|---|---|
| Secret | `AZURE_CLIENT_ID` | Client id de l'identité **GitHub** (`spie-pv-<env>-github`). À ne pas confondre avec la variable `AZURE_CLIENT_ID` des conteneurs (identité managée applicative) | deploy-recette, infra |
| Secret | `AZURE_TENANT_ID` | Tenant de la souscription Azure | deploy-recette, infra |
| Secret | `AZURE_SUBSCRIPTION_ID` | Id de la souscription | deploy-recette, infra |
| Secret | `POSTGRES_ADMIN_PASSWORD` | Mot de passe administrateur PostgreSQL | infra |
| Variable | `AZURE_RESOURCE_GROUP` | Groupe de ressources de l'environnement | deploy-recette, infra |
| Variable | `ACR_NAME` | Sortie `acrName` | deploy-recette, infra |
| Variable | `API_APP_NAME` | Sortie `apiAppName` (`spie-pv-<env>-api`) | deploy-recette, infra |
| Variable | `WORKER_APP_NAME` | Sortie `workerAppName` (`spie-pv-<env>-worker`) | deploy-recette |

---

## 4. Premier déploiement (recette)

Ordre : **infra → secrets → image → app registration → admin initial → test de dépôt**.

### 4.1 Socle sans applications

Via GitHub : workflow **Infrastructure** (`infra.yml`), environnement `recette`, `image_tag` vide, *appliquer* coché.
Ou depuis un poste :

```powershell
$env:POSTGRES_ADMIN_PASSWORD = '<mot-de-passe-postgresql>'
Remove-Item Env:\IMAGE_TAG -ErrorAction SilentlyContinue      # pas d'image : pas de Container Apps
az deployment group what-if --resource-group <groupe-recette> --parameters infra/main.recette.bicepparam
az deployment group create  --resource-group <groupe-recette> --parameters infra/main.recette.bicepparam --query properties.outputs
```

Reporter les sorties `acrName`, `apiAppName`, `workerAppName` dans les variables GitHub de l'environnement `recette`.

### 4.2 Secrets du Key Vault

```powershell
.\infra\scripts\Initialize-KeyVaultSecrets.ps1 -KeyVaultName <sortie keyVaultName> -Environment recette
```

- crée `jwt-secret` s'il n'existe pas ;
- crée le certificat `graph-cert` s'il n'existe pas et exporte la clé publique `spie-pv-recette-sharepoint.cer`
  (à joindre à la demande DSI, étape 4.4).

Pour recevoir l'alerte d'expiration du certificat : `az keyvault certificate contact add --vault-name <coffre> --email <adresse-equipe>`.

### 4.3 Image et création des applications

1. Pousser sur `main` (ou lancer **Déploiement recette** à la main). Le workflow construit et publie
   `spie-pv:<sha>` dans l'ACR, puis **s'arrête volontairement** avec un message : les Container Apps n'existent pas encore.
2. Lancer **Infrastructure** : environnement `recette`, `image_tag` = SHA du commit, *appliquer* coché. Les applications
   sont créées avec la vraie image, puis le workflow vérifie `GET /api/health`. La sortie `apiUrl` donne l'URL de recette.

Les migrations de base sont appliquées au démarrage de l'API (la sonde *startup* laisse environ 105 s). Ensuite, chaque
push sur `main` déploie automatiquement (CI, image, `az containerapp update`, contrôle de `/api/health` avec la
version attendue).

À ce stade, `SHAREPOINT_MODE=disabled` : l'application fonctionne, sans SharePoint.

### 4.4 App registration SharePoint (DSI SPIE)

Envoyer à la DSI [`sharepoint-dsi.md`](sharepoint-dsi.md), le dossier `infra/sharepoint/` et le fichier
`spie-pv-recette-sharepoint.cer`. La DSI renvoie : **tenant id**, **client id**, **site id**.

Les reporter dans `infra/main.recette.bicepparam` (`graphTenantId`, `graphClientId`, `sharepointSiteId`, ce ne sont pas
des secrets), committer, puis relancer **Infrastructure** (`image_tag` vide : l'image en place est conservée). Le mode
SharePoint passe à `graph`.

Vérification facultative, avec l'identité de l'application (lecture du site, refus d'un autre site, dépôt d'un fichier) :

```powershell
.\infra\sharepoint\Test-SharePointAccess.ps1 -TenantId <tenant-id-SPIE> -ClientId <client-id> -SiteId '<site-id>' -KeyVaultName <coffre> -OtherSiteUrl https://<tenant>.sharepoint.com/sites/<autre-site> -TestUpload
```

### 4.5 Administrateur initial

Dans un conteneur de l'API (même configuration, même base) :

```powershell
az containerapp exec --name spie-pv-recette-api --resource-group <groupe-recette> --command sh
# puis, dans le conteneur :
node dist/cli.js create-admin --email <prenom.nom@spie.com> --name "<Prénom Nom>"
exit
```

Le mot de passe provisoire s'affiche une seule fois ; il doit être changé à la première connexion. Autre commande :
`node dist/cli.js reset-password --email <e-mail>`. Si l'image ne contient pas de shell, passer la commande directement
(`--command "node dist/cli.js create-admin --email <e-mail> --name <Nom>"`, nom sans espace, à corriger ensuite dans le
back-office).

### 4.6 Test de dépôt (critère de fin du lot 0)

Connecté au back-office de recette avec le compte administrateur :

1. statut SharePoint (`GET /api/admin/sharepoint/status`) : le site cible doit apparaître ;
2. navigation dans le site (`GET /api/admin/sharepoint/browse`) et choix d'un dossier ;
3. dépôt de test (`POST /api/admin/sharepoint/test-upload`, dossier choisi ou dossier d'une affaire) ;
4. dans SharePoint, le fichier `TEST_DEPOT_spie-pv_<date>-<heure>_<xxxx>.txt` est présent, « Modifié par » = l'application.

---

## 5. Workflows GitHub Actions

| Workflow | Déclencheur | Contenu |
|---|---|---|
| `ci.yml` | push (hors `main`), pull request, appelé par `deploy-recette.yml` | Node 24, pnpm (version de `packageManager`), cache pnpm, `pnpm install --frozen-lockfile`, `lint`, `typecheck`, `test`, `build` ; compilation hors ligne des templates Bicep ; `docker build` sans publication |
| `deploy-recette.yml` | push sur `main`, manuel | CI, puis login OIDC, build + push `spie-pv:<sha>`, `az containerapp update` (API puis worker), attente des révisions, contrôle `/api/health`, purge des images au-delà des 15 plus récentes (ACR Basic : 10 Go, pas de rétention automatique) |
| `infra.yml` | manuel (environnement, tag, appliquer) | `az deployment group what-if`, puis `create` si demandé, sorties dans le résumé, contrôle de santé |

Redéployer l'infrastructure ne fait jamais revenir une ancienne image : sans tag saisi, `infra.yml` reprend le tag
actuellement déployé sur l'API. Depuis un poste, penser à définir `IMAGE_TAG` de la même façon, sinon les applications
ne sont pas mises à jour (elles ne sont pas supprimées non plus : mode incrémental).

---

## 6. Exploitation courante

| Besoin | Commande |
|---|---|
| Journaux en direct | `az containerapp logs show --name spie-pv-recette-api --resource-group <groupe> --follow` |
| Journaux historiques | Log Analytics, table `ContainerAppConsoleLogs_CL` ; télémétrie dans Application Insights |
| Révision active | `az containerapp revision list --name <app> --resource-group <groupe> --query "[?properties.active].name" -o tsv` |
| Redémarrer (relire les secrets) | `az containerapp revision restart --name <app> --resource-group <groupe> --revision <révision>` |
| Rotation de `jwt-secret` | `Initialize-KeyVaultSecrets.ps1 … -RotateJwtSecret -SkipGraphCertificate`, puis redémarrer API et worker (les jetons d'accès en cours sont invalidés) |
| Restauration PostgreSQL | `az postgres flexible-server restore --resource-group <groupe> --name <nouveau-serveur> --source-server <serveur> --restore-time <AAAA-MM-JJTHH:MM:SSZ>` (nouveau serveur ; mettre ensuite à jour `database-url`) |
| Restauration d'un blob supprimé | `az storage blob undelete --account-name <stockage> --container-name pv-files --name <blob> --auth-mode login` |
| Accès `psql` ponctuel | Ajouter son IP dans `postgresFirewallRules`, redéployer, `psql "host=<fqdn> dbname=spiepv user=spiepvadmin sslmode=require"`, puis retirer la règle |

### Renouvellement du certificat Graph (avant expiration)

1. `.\infra\sharepoint\New-GraphCertificate.ps1 -KeyVaultName <coffre> -Environment recette -Renew` : nouvelle version
   dans le coffre, nouvelle clé publique `.cer`.
2. La DSI ajoute la nouvelle clé publique **sans retirer l'ancienne** :
   `New-SharePointAppRegistration.ps1 -Environment recette -CertificateFile <nouveau .cer>`.
3. Redémarrer les révisions API et worker (elles relisent `GRAPH_CERT_PEM`), puis tester un dépôt.
4. La DSI retire l'ancienne clé (`az ad app credential delete --id <client-id> --key-id <key-id> --cert`).

Entre l'étape 1 et l'étape 2, un réplica nouvellement démarré lirait déjà le nouveau certificat : enchaîner les étapes
rapidement, hors heures de dépôt.

---

## 7. Coûts indicatifs (recette)

Ordres de grandeur **à confirmer avec la calculatrice de prix Azure** (France Central, paiement à l'usage, hors taxes,
hors remises) ; ils ne constituent pas un chiffrage.

| Ressource | Hypothèse | Ordre de grandeur mensuel |
|---|---|---|
| Container Apps | API 0,5 vCPU / 1 Gi et worker 1 vCPU / 2 Gi, 1 réplica permanent chacun, majoritairement inactifs | 30 à 50 € (jusqu'à ~100 € si le worker n'est jamais facturé au tarif « inactif ») |
| PostgreSQL Flexible Server | B1ms + 32 Go, sauvegardes 7 j | 15 à 25 € |
| Container Registry | Basic | ~5 € |
| Log Analytics + Application Insights | Quelques Go par mois (5 Go gratuits par compte de facturation), plafond 1 Go/jour | 0 à 15 € |
| Key Vault, stockage Blob | Faible volume | < 5 € |
| **Total recette** | | **≈ 55 à 100 € / mois** |

Leviers en recette : `apiMinReplicas = 0` hors période de tests (démarrage à froid accepté), worker à 0,5 vCPU / 1 Gi tant
que le rendu PDF (lot 1) n'est pas actif, arrêt du serveur PostgreSQL (`az postgres flexible-server stop`, redémarrage
automatique au bout de 7 jours). La production coûte un peu plus (ZRS, rétentions plus longues, un réplica de plus en
pointe) : de l'ordre de 70 à 130 € / mois avec ce dimensionnement.

---

## 8. Recette et production

| Sujet | Recette (lot 0) | Production (à décider avant le premier déploiement, lot 3) |
|---|---|---|
| Groupe de ressources, identité GitHub, ACR, Key Vault | Dédiés | Dédiés (`spie-pv-production-*`). Promotion d'image : `az acr import` depuis l'ACR de recette |
| App registration SharePoint | `spie-pv-recette-sharepoint` | `spie-pv-production-sharepoint`, certificat distinct |
| Site SharePoint | Site ou bibliothèque **de test** (à confirmer avec SPIE) | Site cible réel |
| Réseau PostgreSQL | Public + « Allow Azure services » (toute IP Azure, y compris d'autres clients : la base n'est protégée que par le mot de passe et TLS) | **Accès privé conseillé** : sous-réseau délégué + zone DNS privée, environnement Container Apps intégré au VNet. Non modifiable après la création du serveur et de l'environnement |
| Sauvegardes PostgreSQL | 7 jours | 14 jours (jusqu'à 35) ; géo-redondance à décider (à la création uniquement) |
| Compte applicatif PostgreSQL | Administrateur du serveur | Rôle dédié propriétaire du schéma, administrateur réservé à l'exploitation |
| Stockage | LRS, soft delete 30 j | ZRS, soft delete 90 j ; versioning des blobs à envisager |
| Log Analytics | 30 j, plafond 1 Go/jour | 90 j, sans plafond (un plafond atteint coupe aussi les alertes) |
| API | 1 à 2 réplicas | 1 à 3 réplicas ; domaine personnalisé et certificat managé si SPIE le souhaite |
| Alertes | — | Groupe d'actions : dépôts en erreur (spec 9), redémarrages, échecs de sonde, expiration du certificat |
| GitHub | Déploiement continu sur `main` | `infra.yml` avec relecteurs obligatoires ; workflow de déploiement applicatif à écrire (promotion d'une image validée en recette) |

---

## 9. Limites connues

- Les templates n'ont pas été compilés ni déployés lors de leur écriture (pas d'Azure CLI disponible) : la CI les
  compile (`az bicep build`, `build-params`) ; faire un `what-if` avant le premier `create`.
- `Grant-SharePointSiteAccess.ps1 -AuthMode AzCli` : le jeton d'un utilisateur Azure CLI ne porte généralement pas
  `Sites.FullControl.All` ; la DSI utilisera plutôt `-AuthMode MgGraph` (voir [`sharepoint-dsi.md`](sharepoint-dsi.md)).
- Key Vault avec purge protection : un coffre supprimé garde son nom réservé 90 jours. Recréer un environnement dans le
  même groupe de ressources après suppression impose de récupérer le coffre (`az keyvault recover`).
