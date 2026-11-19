// Environnement Container Apps (profil de charge « Consumption », facturation à l'usage),
// relié à Log Analytics pour les journaux des conteneurs (stdout/stderr, pino).

@description('Nom de l\'environnement Container Apps.')
param name string

@description('Région Azure.')
param location string

@description('Tags appliqués à la ressource.')
param tags object

@description('Nom de l\'espace Log Analytics (même groupe de ressources).')
param logAnalyticsName string

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: logAnalyticsName
}

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
    // Environnement « workload profiles » avec le seul profil Consumption (modèle actuel recommandé par Azure).
    // Production avec accès privé : ajouter vnetConfiguration.infrastructureSubnetId (à la création uniquement).
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
    zoneRedundant: false
  }
}

@description('Identifiant de ressource de l\'environnement.')
output id string = environment.id

@description('Nom de l\'environnement.')
output name string = environment.name

@description('Domaine par défaut des applications de l\'environnement.')
output defaultDomain string = environment.properties.defaultDomain
