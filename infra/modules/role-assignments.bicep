// Attributions de rôles Azure (RBAC), au plus juste et au niveau de chaque ressource :
//  - identité managée des conteneurs : AcrPull (ACR), Key Vault Secrets User (KV), Storage Blob Data Contributor (stockage) ;
//  - opérateurs du Key Vault (facultatif) : Key Vault Secrets Officer + Key Vault Certificates Officer, nécessaires
//    pour exécuter les scripts post-déploiement (jwt-secret, certificat graph-cert, vérification SharePoint).
// Le déployeur (identité GitHub) doit pouvoir créer ces attributions : voir docs/infra.md.

@description('Object id (principal) de l\'identité managée des conteneurs.')
param principalId string

@description('Nom de l\'ACR.')
param registryName string

@description('Nom du Key Vault.')
param keyVaultName string

@description('Nom du compte de stockage.')
param storageAccountName string

@description('Opérateurs du Key Vault : [{ principalId, principalType }] (principalType : User, Group ou ServicePrincipal).')
param keyVaultOperators array = []

// Identifiants des rôles intégrés Azure (identiques dans tous les tenants).
var roleIds = {
  acrPull: '7f951dda-4ed3-4680-a7ca-43fe172d538d'
  keyVaultSecretsUser: '4633458b-17de-408a-b874-0445c86b69e6'
  keyVaultSecretsOfficer: 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7'
  keyVaultCertificatesOfficer: 'a4417e6f-fecd-4de8-b567-7b0420556985'
  storageBlobDataContributor: 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
}

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: registryName
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, principalId, roleIds.acrPull)
  scope: registry
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleIds.acrPull)
    principalId: principalId
    principalType: 'ServicePrincipal'
    description: 'spie-pv : tirage des images par les Container Apps'
  }
}

resource keyVaultSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, principalId, roleIds.keyVaultSecretsUser)
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleIds.keyVaultSecretsUser)
    principalId: principalId
    principalType: 'ServicePrincipal'
    description: 'spie-pv : lecture des secrets (database-url, jwt-secret, graph-cert) par les Container Apps'
  }
}

resource storageBlobDataContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, principalId, roleIds.storageBlobDataContributor)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleIds.storageBlobDataContributor)
    principalId: principalId
    principalType: 'ServicePrincipal'
    description: 'spie-pv : lecture et écriture des fichiers de PV'
  }
}

resource operatorSecretsOfficer 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for operator in keyVaultOperators: {
    name: guid(keyVault.id, operator.principalId, roleIds.keyVaultSecretsOfficer)
    scope: keyVault
    properties: {
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleIds.keyVaultSecretsOfficer)
      principalId: operator.principalId
      principalType: operator.principalType
      description: 'spie-pv : gestion des secrets par un opérateur'
    }
  }
]

resource operatorCertificatesOfficer 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for operator in keyVaultOperators: {
    name: guid(keyVault.id, operator.principalId, roleIds.keyVaultCertificatesOfficer)
    scope: keyVault
    properties: {
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleIds.keyVaultCertificatesOfficer)
      principalId: operator.principalId
      principalType: operator.principalType
      description: 'spie-pv : gestion du certificat Graph par un opérateur'
    }
  }
]
