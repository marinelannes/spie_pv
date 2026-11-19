// Écrit un secret dans un Key Vault existant (plan de contrôle ARM : le rôle Contributor du déployeur suffit,
// aucun rôle de données Key Vault n'est nécessaire). La valeur n'apparaît ni dans les sorties ni dans l'historique.

@description('Nom du Key Vault existant.')
param keyVaultName string

@description('Nom du secret.')
param secretName string

@description('Valeur du secret.')
@secure()
param secretValue string

@description('Type de contenu informatif du secret.')
param contentType string = 'text/plain'

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource secret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: secretName
  properties: {
    value: secretValue
    contentType: contentType
    attributes: {
      enabled: true
    }
  }
}

@description('Nom du secret écrit (jamais sa valeur).')
output name string = secret.name
