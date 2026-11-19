// Paramètres de l'environnement de PRODUCTION (version minimale, à compléter au lot 3).
// Différences avec la recette et décisions à prendre AVANT le premier déploiement : docs/infra.md.
// Variables d'environnement lues à la compilation : POSTGRES_ADMIN_PASSWORD (obligatoire), IMAGE_TAG (facultatif).
using './main.bicep'

param environmentName = 'production'

param imageTag = readEnvironmentVariable('IMAGE_TAG', '')

param postgresAdminPassword = readEnvironmentVariable('POSTGRES_ADMIN_PASSWORD')

// App registration distincte de la recette : spie-pv-production-sharepoint (docs/sharepoint-dsi.md).
param graphTenantId = '' // '<tenant-id-SPIE>'
param graphClientId = '' // '<client-id-de-spie-pv-production-sharepoint>'
param sharepointSiteId = '' // '<hote>.sharepoint.com,<guid-collection-de-sites>,<guid-site>'

// Sauvegardes plus longues. Géo-redondance : à décider, non modifiable après la création du serveur.
param postgresBackupRetentionDays = 14
param postgresGeoRedundantBackup = false

// Redondance de zone pour les fichiers de PV, rétention plus longue des suppressions.
param storageSkuName = 'Standard_ZRS'
param blobSoftDeleteRetentionDays = 90

// Pas de plafond d'ingestion en production (un plafond atteint coupe aussi la télémétrie et les alertes).
param logAnalyticsRetentionDays = 90
param logAnalyticsDailyQuotaGb = -1

param apiMinReplicas = 1
param apiMaxReplicas = 3

param keyVaultOperators = [
  // { principalId: '<object-id>', principalType: 'Group' }
]
