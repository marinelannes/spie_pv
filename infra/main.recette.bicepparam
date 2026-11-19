// Paramètres de l'environnement de RECETTE (lot 0).
// Usage : az deployment group create -g <groupe-recette> --parameters infra/main.recette.bicepparam
// Variables d'environnement lues à la compilation :
//   POSTGRES_ADMIN_PASSWORD (obligatoire) : mot de passe administrateur PostgreSQL, stable dans le temps ;
//   IMAGE_TAG (facultatif)                : tag de l'image spie-pv à déployer ; vide = Container Apps non créées/modifiées.
using './main.bicep'

param environmentName = 'recette'

param imageTag = readEnvironmentVariable('IMAGE_TAG', '')

// Jamais dans le dépôt : secret d'environnement GitHub POSTGRES_ADMIN_PASSWORD (workflow infra) ou variable locale.
param postgresAdminPassword = readEnvironmentVariable('POSTGRES_ADMIN_PASSWORD')

// Identifiants renvoyés par la DSI SPIE (docs/sharepoint-dsi.md). Ce ne sont pas des secrets.
// Tant qu'ils sont vides, les variables GRAPH_TENANT_ID / GRAPH_CLIENT_ID / SHAREPOINT_SITE_ID ne sont pas définies.
param graphTenantId = '' // '<tenant-id-SPIE>'
param graphClientId = '' // '<client-id-de-spie-pv-recette-sharepoint>'
param sharepointSiteId = '' // '<hote>.sharepoint.com,<guid-collection-de-sites>,<guid-site>'

// Dimensionnement d'entrée de gamme (spec 8.6).
param postgresSkuName = 'Standard_B1ms'
param postgresSkuTier = 'Burstable'
param postgresStorageSizeGB = 32
param postgresBackupRetentionDays = 7
param storageSkuName = 'Standard_LRS'
param blobSoftDeleteRetentionDays = 30
param logAnalyticsRetentionDays = 30
param logAnalyticsDailyQuotaGb = 1
param apiMinReplicas = 1
param apiMaxReplicas = 2

// Accès direct à PostgreSQL depuis un poste d'administration (facultatif, à retirer après usage).
param postgresFirewallRules = [
  // { name: 'poste-admin', startIpAddress: '<ip-publique>', endIpAddress: '<ip-publique>' }
]

// Opérateurs du Key Vault : exécutent les scripts post-déploiement (jwt-secret, certificat graph-cert).
// Object id : az ad user show --id <email> --query id -o tsv   ou   az ad group show --group <nom> --query id -o tsv
param keyVaultOperators = [
  // { principalId: '<object-id>', principalType: 'Group' }
]
