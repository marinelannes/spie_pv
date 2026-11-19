// Compte de stockage Blob : signatures, PDF et copie de secours des fichiers déposés dans SharePoint (spec 5.4, 7.4).
// Accès uniquement par Entra ID (identité managée, rôle Storage Blob Data Contributor) : clés partagées désactivées.

@description('Nom du compte de stockage (3 à 24 caractères, minuscules et chiffres, unique dans Azure).')
@minLength(3)
@maxLength(24)
param name string

@description('Région Azure.')
param location string

@description('Tags appliqués aux ressources.')
param tags object

@description('Redondance du compte (LRS en recette, ZRS conseillé en production).')
@allowed(['Standard_LRS', 'Standard_ZRS', 'Standard_GRS', 'Standard_GZRS'])
param skuName string = 'Standard_LRS'

@description('Nom du conteneur des fichiers de PV.')
param containerName string = 'pv-files'

@description('Durée de conservation des blobs et conteneurs supprimés (soft delete), en jours.')
@minValue(1)
@maxValue(365)
param softDeleteRetentionDays int = 30

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: name
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: {
    name: skuName
  }
  properties: {
    accessTier: 'Hot'
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    // Authentification Entra ID uniquement : pas de clé de compte ni de SAS signée par clé.
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    allowCrossTenantReplication: false
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: 'Allow'
    }
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    // Suppression réversible des blobs et des conteneurs (spec 7.4).
    deleteRetentionPolicy: {
      enabled: true
      days: softDeleteRetentionDays
    }
    containerDeleteRetentionPolicy: {
      enabled: true
      days: softDeleteRetentionDays
    }
  }
}

resource container 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: containerName
  properties: {
    publicAccess: 'None'
  }
}

@description('Nom du compte de stockage.')
output name string = storage.name

@description('Identifiant de ressource du compte de stockage.')
output id string = storage.id

@description('Point de terminaison Blob (AZURE_STORAGE_ACCOUNT_URL), terminé par « / ».')
output blobEndpoint string = storage.properties.primaryEndpoints.blob

@description('Nom du conteneur des fichiers de PV.')
output containerName string = container.name
