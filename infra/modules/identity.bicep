// Identité managée user-assigned partagée par l'API et le worker.
// Elle sert à : tirer les images de l'ACR, lire les secrets du Key Vault, écrire dans le Blob Storage.

@description('Nom de l\'identité managée.')
param name string

@description('Région Azure.')
param location string

@description('Tags appliqués à la ressource.')
param tags object

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: name
  location: location
  tags: tags
}

@description('Identifiant de ressource de l\'identité (pour les références Key Vault et ACR des Container Apps).')
output id string = identity.id

@description('Nom de l\'identité.')
output name string = identity.name

@description('Object id (principal) de l\'identité, pour les attributions de rôles.')
output principalId string = identity.properties.principalId

@description('Client id de l\'identité, exposé aux conteneurs dans AZURE_CLIENT_ID (DefaultAzureCredential).')
output clientId string = identity.properties.clientId
