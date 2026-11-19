// =====================================================================================================================
// spie-pv - socle Azure (lot 0). Portée : groupe de ressources (créé au préalable, en France Central).
//
// Déploiement : az deployment group create -g <groupe> --parameters infra/main.<env>.bicepparam
// Ordre du premier déploiement et prérequis : docs/infra.md.
//
// Nommage : <prefixe>-<env>-<type> pour les ressources dont le nom est local au groupe ; pour les ressources dont le nom
// est global et contraint (ACR, Key Vault, stockage : sans tiret, longueur limitée ; PostgreSQL : DNS public), on
// ajoute un suffixe stable de 6 caractères dérivé de l'id du groupe (uniqueString).
//
// Images : les Container Apps (API + worker) ne sont créées que si imageTag est renseigné. Au tout premier
// déploiement l'image n'existe pas encore dans l'ACR : on déploie d'abord le reste du socle, on pousse l'image,
// puis on redéploie avec le tag (voir docs/infra.md, « Pourquoi pas d'image placeholder »).
// =====================================================================================================================

targetScope = 'resourceGroup'

metadata description = 'Socle Azure de spie-pv : identité managée, supervision, ACR, Key Vault, stockage, PostgreSQL, Container Apps (API + worker).'

// ---------------------------------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------------------------------

@description('Principal Entra ID (utilisateur, groupe ou principal de service).')
type principalRef = {
  @description('Object id du principal.')
  principalId: string

  @description('Type du principal.')
  principalType: 'User' | 'Group' | 'ServicePrincipal'
}

@description('Règle de pare-feu PostgreSQL.')
type firewallRule = {
  @description('Nom de la règle (lettres, chiffres, tirets, soulignés).')
  name: string

  @description('Première adresse IPv4 autorisée.')
  startIpAddress: string

  @description('Dernière adresse IPv4 autorisée.')
  endIpAddress: string
}

// ---------------------------------------------------------------------------------------------------------------------
// Paramètres généraux
// ---------------------------------------------------------------------------------------------------------------------

@description('Environnement cible.')
@allowed(['recette', 'production'])
param environmentName string

@description('Région Azure. La spec impose un hébergement en France (7.4) : France Central.')
param location string = 'francecentral'

@description('Préfixe des noms de ressources (minuscules, chiffres, tirets).')
@minLength(3)
@maxLength(10)
param namePrefix string = 'spie-pv'

// ---------------------------------------------------------------------------------------------------------------------
// Image applicative
// ---------------------------------------------------------------------------------------------------------------------

@description('Dépôt de l\'image dans l\'ACR.')
param imageRepository string = 'spie-pv'

@description('Tag de l\'image à déployer (SHA du commit). Vide = les Container Apps ne sont ni créées ni modifiées.')
param imageTag string = ''

// ---------------------------------------------------------------------------------------------------------------------
// SharePoint / Microsoft Graph (identifiants fournis par la DSI SPIE ; ce ne sont pas des secrets)
// ---------------------------------------------------------------------------------------------------------------------

@description('Mode SharePoint de l\'application (SHAREPOINT_MODE). En mode graph, si l\'un des trois identifiants ci-dessous est vide, l\'application est déployée en mode disabled (l\'API refuse de démarrer en mode graph incomplet).')
@allowed(['graph', 'disabled'])
param sharepointMode string = 'graph'

@description('Tenant Entra ID de SPIE (GRAPH_TENANT_ID). Vide = variable non définie.')
param graphTenantId string = ''

@description('Client id de l\'app registration spie-pv-<env>-sharepoint (GRAPH_CLIENT_ID). Vide = variable non définie.')
param graphClientId string = ''

@description('Id Graph du site SharePoint cible, forme « hote,guid,guid » (SHAREPOINT_SITE_ID). Vide = variable non définie.')
param sharepointSiteId string = ''

// ---------------------------------------------------------------------------------------------------------------------
// PostgreSQL
// ---------------------------------------------------------------------------------------------------------------------

@description('Identifiant administrateur PostgreSQL (utilisé aussi par l\'application en lot 0).')
param postgresAdminLogin string = 'spiepvadmin'

@description('Mot de passe administrateur PostgreSQL. Doit rester identique d\'un déploiement à l\'autre (sinon il est changé).')
@secure()
@minLength(16)
param postgresAdminPassword string

@description('Nom de la base applicative.')
param postgresDatabaseName string = 'spiepv'

@description('SKU de calcul PostgreSQL.')
param postgresSkuName string = 'Standard_B1ms'

@description('Niveau de calcul PostgreSQL.')
@allowed(['Burstable', 'GeneralPurpose', 'MemoryOptimized'])
param postgresSkuTier string = 'Burstable'

@description('Stockage PostgreSQL initial, en Go.')
param postgresStorageSizeGB int = 32

@description('Rétention des sauvegardes PostgreSQL, en jours (restauration à un instant donné).')
@minValue(7)
@maxValue(35)
param postgresBackupRetentionDays int = 7

@description('Sauvegardes PostgreSQL géo-redondantes (choix possible uniquement à la création du serveur).')
param postgresGeoRedundantBackup bool = false

@description('Règles de pare-feu PostgreSQL supplémentaires (ex. poste d\'administration).')
param postgresFirewallRules firewallRule[] = []

@description('Extensions PostgreSQL à autoriser (azure.extensions), ex. « PGCRYPTO,CITEXT ». Vide = aucune.')
param postgresAllowedExtensions string = ''

// ---------------------------------------------------------------------------------------------------------------------
// Stockage, supervision, Key Vault
// ---------------------------------------------------------------------------------------------------------------------

@description('Redondance du compte de stockage.')
@allowed(['Standard_LRS', 'Standard_ZRS', 'Standard_GRS', 'Standard_GZRS'])
param storageSkuName string = 'Standard_LRS'

@description('Nom du conteneur Blob des fichiers de PV.')
param storageContainerName string = 'pv-files'

@description('Rétention des blobs et conteneurs supprimés (soft delete), en jours.')
@minValue(1)
@maxValue(365)
param blobSoftDeleteRetentionDays int = 30

@description('Rétention Log Analytics, en jours.')
@minValue(30)
@maxValue(730)
param logAnalyticsRetentionDays int = 30

@description('Plafond d\'ingestion Log Analytics en Go par jour (-1 = illimité).')
param logAnalyticsDailyQuotaGb int = -1

@description('Personnes ou groupes autorisés à gérer secrets et certificats du Key Vault (scripts post-déploiement).')
param keyVaultOperators principalRef[] = []

// ---------------------------------------------------------------------------------------------------------------------
// Dimensionnement des Container Apps (profil Consumption : 1 vCPU pour 2 Gi)
// ---------------------------------------------------------------------------------------------------------------------

@description('vCPU de l\'API.')
param apiCpu string = '0.5'

@description('Mémoire de l\'API.')
param apiMemory string = '1Gi'

@description('Réplicas minimum de l\'API (1 : pas de démarrage à froid, spec 8.6).')
@minValue(0)
@maxValue(10)
param apiMinReplicas int = 1

@description('Réplicas maximum de l\'API.')
@minValue(1)
@maxValue(10)
param apiMaxReplicas int = 2

@description('vCPU du worker (rendu PDF Chromium en lot 1).')
param workerCpu string = '1.0'

@description('Mémoire du worker.')
param workerMemory string = '2Gi'

// ---------------------------------------------------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------------------------------------------------

var tags = {
  projet: 'spie-pv'
  env: environmentName
}

var compactPrefix = toLower(replace(namePrefix, '-', ''))
var uniqueSuffix = take(uniqueString(resourceGroup().id, namePrefix, environmentName), 6)

var names = {
  identity: '${namePrefix}-${environmentName}-id'
  logAnalytics: '${namePrefix}-${environmentName}-log'
  appInsights: '${namePrefix}-${environmentName}-appi'
  containerAppsEnvironment: '${namePrefix}-${environmentName}-cae'
  apiApp: '${namePrefix}-${environmentName}-api'
  workerApp: '${namePrefix}-${environmentName}-worker'
  postgres: '${namePrefix}-${environmentName}-psql-${uniqueSuffix}'
  registry: take('${compactPrefix}${environmentName}acr${uniqueSuffix}', 50)
  keyVault: take('${compactPrefix}${environmentName}kv${uniqueSuffix}', 24)
  storage: take('${compactPrefix}${environmentName}st${uniqueSuffix}', 24)
}

var deployApps = !empty(imageTag)

// Tant que la DSI n'a pas fourni les identifiants Graph, l'API démarre en mode SharePoint « disabled »
// (sinon sa validation de configuration échoue au démarrage).
var graphConfigured = !empty(graphTenantId) && !empty(graphClientId) && !empty(sharepointSiteId)
var effectiveSharepointMode = (sharepointMode == 'graph' && !graphConfigured) ? 'disabled' : sharepointMode

// Préfixe des noms de déploiements imbriqués (limités à 64 caractères).
var deploymentPrefix = take(deployment().name, 40)

// ---------------------------------------------------------------------------------------------------------------------
// Socle
// ---------------------------------------------------------------------------------------------------------------------

module identity 'modules/identity.bicep' = {
  name: '${deploymentPrefix}-identity'
  params: {
    name: names.identity
    location: location
    tags: tags
  }
}

module monitoring 'modules/monitoring.bicep' = {
  name: '${deploymentPrefix}-monitoring'
  params: {
    logAnalyticsName: names.logAnalytics
    appInsightsName: names.appInsights
    location: location
    tags: tags
    retentionInDays: logAnalyticsRetentionDays
    dailyQuotaGb: logAnalyticsDailyQuotaGb
  }
}

module registry 'modules/registry.bicep' = {
  name: '${deploymentPrefix}-registry'
  params: {
    name: names.registry
    location: location
    tags: tags
  }
}

module keyVault 'modules/keyvault.bicep' = {
  name: '${deploymentPrefix}-keyvault'
  params: {
    name: names.keyVault
    location: location
    tags: tags
    logAnalyticsWorkspaceId: monitoring.outputs.logAnalyticsId
  }
}

module storage 'modules/storage.bicep' = {
  name: '${deploymentPrefix}-storage'
  params: {
    name: names.storage
    location: location
    tags: tags
    skuName: storageSkuName
    containerName: storageContainerName
    softDeleteRetentionDays: blobSoftDeleteRetentionDays
  }
}

module postgres 'modules/postgres.bicep' = {
  name: '${deploymentPrefix}-postgres'
  params: {
    name: names.postgres
    location: location
    tags: tags
    administratorLogin: postgresAdminLogin
    administratorLoginPassword: postgresAdminPassword
    skuName: postgresSkuName
    skuTier: postgresSkuTier
    storageSizeGB: postgresStorageSizeGB
    backupRetentionDays: postgresBackupRetentionDays
    geoRedundantBackup: postgresGeoRedundantBackup
    databaseName: postgresDatabaseName
    allowAzureServices: true
    firewallRules: postgresFirewallRules
    allowedExtensions: postgresAllowedExtensions
  }
}

// DATABASE_URL, construite ici pour ne jamais transiter ailleurs que dans le Key Vault.
// Identifiant et mot de passe sont encodés (caractères spéciaux) ; TLS imposé (sslmode=require).
module databaseUrlSecret 'modules/keyvault-secret.bicep' = {
  name: '${deploymentPrefix}-secret-database-url'
  params: {
    keyVaultName: keyVault.outputs.name
    secretName: 'database-url'
    secretValue: 'postgres://${uriComponent(postgresAdminLogin)}:${uriComponent(postgresAdminPassword)}@${postgres.outputs.fqdn}:5432/${postgres.outputs.databaseName}?sslmode=require'
  }
}

module roles 'modules/role-assignments.bicep' = {
  name: '${deploymentPrefix}-roles'
  params: {
    principalId: identity.outputs.principalId
    registryName: registry.outputs.name
    keyVaultName: keyVault.outputs.name
    storageAccountName: storage.outputs.name
    keyVaultOperators: keyVaultOperators
  }
}

module containerAppsEnvironment 'modules/container-apps-env.bicep' = {
  name: '${deploymentPrefix}-cae'
  params: {
    name: names.containerAppsEnvironment
    location: location
    tags: tags
    logAnalyticsName: monitoring.outputs.logAnalyticsName
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Applications (API + worker, même image)
// ---------------------------------------------------------------------------------------------------------------------

var containerImage = '${registry.outputs.loginServer}/${imageRepository}:${imageTag}'

// Secrets Container Apps = références Key Vault (version la plus récente), lues avec l'identité managée.
// jwt-secret et graph-cert DOIVENT exister dans le coffre avant la création des applications
// (infra/scripts/Initialize-KeyVaultSecrets.ps1), sinon la révision ne démarre pas.
var appSecrets = [
  {
    name: 'database-url'
    keyVaultUrl: '${keyVault.outputs.uri}secrets/database-url'
    identity: identity.outputs.id
  }
  {
    name: 'jwt-secret'
    keyVaultUrl: '${keyVault.outputs.uri}secrets/jwt-secret'
    identity: identity.outputs.id
  }
  {
    name: 'graph-cert'
    keyVaultUrl: '${keyVault.outputs.uri}secrets/graph-cert'
    identity: identity.outputs.id
  }
]

var baseEnv = [
  {
    name: 'NODE_ENV'
    value: 'production'
  }
  {
    name: 'PORT'
    value: '3000'
  }
  {
    name: 'COOKIE_SECURE'
    value: 'true'
  }
  {
    name: 'WEB_DIST_DIR'
    value: '/app/public'
  }
  {
    name: 'SHAREPOINT_MODE'
    value: effectiveSharepointMode
  }
  {
    // Libellé de l'environnement, repris notamment dans le fichier de test SharePoint.
    name: 'APP_ENV_LABEL'
    value: environmentName
  }
  {
    // Version exposée par GET /api/health (tag d'image = SHA du commit) ; mise à jour aussi par deploy-recette.yml.
    name: 'APP_VERSION'
    value: imageTag
  }
  {
    name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
    value: monitoring.outputs.appInsightsConnectionString
  }
  {
    name: 'AZURE_STORAGE_ACCOUNT_URL'
    value: storage.outputs.blobEndpoint
  }
  {
    name: 'AZURE_STORAGE_CONTAINER'
    value: storage.outputs.containerName
  }
  {
    name: 'AZURE_CLIENT_ID'
    value: identity.outputs.clientId
  }
  {
    name: 'DATABASE_URL'
    secretRef: 'database-url'
  }
  {
    name: 'JWT_SECRET'
    secretRef: 'jwt-secret'
  }
  {
    name: 'GRAPH_CERT_PEM'
    secretRef: 'graph-cert'
  }
]

// Identifiants Graph : définis seulement lorsqu'ils sont connus (réponse de la DSI).
var graphTenantEnv = empty(graphTenantId) ? [] : [
  {
    name: 'GRAPH_TENANT_ID'
    value: graphTenantId
  }
]

var graphClientEnv = empty(graphClientId) ? [] : [
  {
    name: 'GRAPH_CLIENT_ID'
    value: graphClientId
  }
]

var sharepointSiteEnv = empty(sharepointSiteId) ? [] : [
  {
    name: 'SHAREPOINT_SITE_ID'
    value: sharepointSiteId
  }
]

var appEnv = concat(baseEnv, graphTenantEnv, graphClientEnv, sharepointSiteEnv)

module api 'modules/container-app.bicep' = if (deployApps) {
  name: '${deploymentPrefix}-app-api'
  params: {
    name: names.apiApp
    location: location
    tags: tags
    environmentId: containerAppsEnvironment.outputs.id
    containerName: 'api'
    image: containerImage
    identityId: identity.outputs.id
    registryServer: registry.outputs.loginServer
    // Commande par défaut de l'image : node dist/server.js (port 3000).
    env: appEnv
    secrets: appSecrets
    ingressEnabled: true
    targetPort: 3000
    healthPath: '/api/health'
    cpu: apiCpu
    memory: apiMemory
    minReplicas: apiMinReplicas
    maxReplicas: apiMaxReplicas
  }
  dependsOn: [
    roles
    databaseUrlSecret
  ]
}

module worker 'modules/container-app.bicep' = if (deployApps) {
  name: '${deploymentPrefix}-app-worker'
  params: {
    name: names.workerApp
    location: location
    tags: tags
    environmentId: containerAppsEnvironment.outputs.id
    containerName: 'worker'
    image: containerImage
    identityId: identity.outputs.id
    registryServer: registry.outputs.loginServer
    command: [
      'node'
      'dist/worker.js'
    ]
    env: appEnv
    secrets: appSecrets
    // Pas d'ingress : le worker consomme la file pg-boss dans PostgreSQL.
    ingressEnabled: false
    cpu: workerCpu
    memory: workerMemory
    minReplicas: 1
    maxReplicas: 1
  }
  dependsOn: [
    roles
    databaseUrlSecret
  ]
}

// ---------------------------------------------------------------------------------------------------------------------
// Sorties (aucun secret)
// ---------------------------------------------------------------------------------------------------------------------

@description('Groupe de ressources.')
output resourceGroupName string = resourceGroup().name

@description('Les Container Apps ont-elles été déployées par ce déploiement ?')
output appsDeployed bool = deployApps

@description('Image déployée (vide si les applications ne sont pas déployées).')
output containerImage string = deployApps ? containerImage : ''

@description('Mode SharePoint effectivement appliqué (disabled tant que les identifiants Graph manquent).')
output sharepointMode string = effectiveSharepointMode

@description('FQDN public de l\'API (vide si non déployée).')
output apiFqdn string = deployApps ? api.outputs.fqdn : ''

@description('URL publique de l\'API et de la PWA (vide si non déployée).')
output apiUrl string = deployApps ? 'https://${api.outputs.fqdn}' : ''

@description('Nom de la Container App API (variable GitHub API_APP_NAME).')
output apiAppName string = names.apiApp

@description('Nom de la Container App worker (variable GitHub WORKER_APP_NAME).')
output workerAppName string = names.workerApp

@description('Nom de l\'environnement Container Apps.')
output containerAppsEnvironmentName string = containerAppsEnvironment.outputs.name

@description('Nom de l\'ACR (variable GitHub ACR_NAME).')
output acrName string = registry.outputs.name

@description('Serveur de connexion de l\'ACR.')
output acrLoginServer string = registry.outputs.loginServer

@description('Nom du Key Vault (scripts post-déploiement).')
output keyVaultName string = keyVault.outputs.name

@description('URI du Key Vault.')
output keyVaultUri string = keyVault.outputs.uri

@description('Nom de l\'identité managée des conteneurs.')
output managedIdentityName string = identity.outputs.name

@description('Client id de l\'identité managée (AZURE_CLIENT_ID dans les conteneurs).')
output managedIdentityClientId string = identity.outputs.clientId

@description('Object id de l\'identité managée.')
output managedIdentityPrincipalId string = identity.outputs.principalId

@description('Nom du serveur PostgreSQL.')
output postgresServerName string = postgres.outputs.name

@description('FQDN du serveur PostgreSQL.')
output postgresFqdn string = postgres.outputs.fqdn

@description('Nom de la base applicative.')
output postgresDatabaseName string = postgres.outputs.databaseName

@description('Nom du compte de stockage.')
output storageAccountName string = storage.outputs.name

@description('Point de terminaison Blob (AZURE_STORAGE_ACCOUNT_URL).')
output storageBlobEndpoint string = storage.outputs.blobEndpoint

@description('Nom de l\'espace Log Analytics.')
output logAnalyticsWorkspaceName string = monitoring.outputs.logAnalyticsName

@description('Nom de la ressource Application Insights.')
output appInsightsName string = monitoring.outputs.appInsightsName
