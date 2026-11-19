// Supervision : espace Log Analytics + Application Insights basé sur cet espace (workspace-based).
// Les logs des Container Apps et la télémétrie de l'application arrivent dans le même espace.

@description('Nom de l\'espace Log Analytics.')
param logAnalyticsName string

@description('Nom de la ressource Application Insights.')
param appInsightsName string

@description('Région Azure.')
param location string

@description('Tags appliqués aux ressources.')
param tags object

@description('Durée de rétention des logs, en jours.')
@minValue(30)
@maxValue(730)
param retentionInDays int = 30

@description('Plafond d\'ingestion quotidien en Go (-1 = illimité). Au-delà, les logs ET la télémétrie Application Insights sont perdus jusqu\'au lendemain.')
param dailyQuotaGb int = -1

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: retentionInDays
    workspaceCapping: {
      dailyQuotaGb: dailyQuotaGb
    }
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
    IngestionMode: 'LogAnalytics'
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

@description('Identifiant de ressource de l\'espace Log Analytics.')
output logAnalyticsId string = logAnalytics.id

@description('Nom de l\'espace Log Analytics.')
output logAnalyticsName string = logAnalytics.name

@description('Nom de la ressource Application Insights.')
output appInsightsName string = appInsights.name

// La chaîne de connexion Application Insights n'est pas un secret (Microsoft la considère comme un identifiant
// d'ingestion) : elle est transmise en variable d'environnement non secrète, conformément au contrat applicatif.
@description('Chaîne de connexion Application Insights (APPLICATIONINSIGHTS_CONNECTION_STRING).')
output appInsightsConnectionString string = appInsights.properties.ConnectionString
