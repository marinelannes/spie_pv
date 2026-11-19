// Key Vault en mode RBAC, avec suppression réversible et protection contre la purge.
// Secrets attendus par l'application (référencés par les Container Apps via l'identité managée) :
//   - database-url : écrit par ce template (main.bicep) à partir des paramètres PostgreSQL ;
//   - jwt-secret   : créé une fois par infra/scripts/Initialize-KeyVaultSecrets.ps1 (jamais dans le dépôt ni dans GitHub) ;
//   - graph-cert   : secret adossé au CERTIFICAT Key Vault « graph-cert » (PEM), créé par
//                    infra/sharepoint/New-GraphCertificate.ps1. Les certificats Key Vault n'ont pas de ressource ARM.

@description('Nom du Key Vault (3 à 24 caractères, unique dans Azure).')
@minLength(3)
@maxLength(24)
param name string

@description('Région Azure.')
param location string

@description('Tags appliqués à la ressource.')
param tags object

@description('Identifiant de l\'espace Log Analytics recevant le journal d\'audit du coffre (vide = pas de diagnostic).')
param logAnalyticsWorkspaceId string = ''

@description('Rétention des éléments supprimés, en jours. Non modifiable après la création.')
@minValue(7)
@maxValue(90)
param softDeleteRetentionInDays int = 90

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: softDeleteRetentionInDays
    // Irréversible une fois activée : un coffre supprimé reste réservé (nom compris) pendant la durée de rétention.
    enablePurgeProtection: true
    enabledForDeployment: false
    enabledForDiskEncryption: false
    enabledForTemplateDeployment: false
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: 'Allow'
    }
  }
}

// Journal d'audit du coffre (qui a lu quel secret, quand) vers Log Analytics.
resource auditDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = if (!empty(logAnalyticsWorkspaceId)) {
  name: 'audit-log-analytics'
  scope: keyVault
  properties: {
    workspaceId: logAnalyticsWorkspaceId
    logs: [
      {
        categoryGroup: 'audit'
        enabled: true
      }
    ]
  }
}

@description('Nom du Key Vault.')
output name string = keyVault.name

@description('Identifiant de ressource du Key Vault.')
output id string = keyVault.id

@description('URI du coffre, terminée par « / » (ex. https://<nom>.vault.azure.net/).')
output uri string = keyVault.properties.vaultUri
