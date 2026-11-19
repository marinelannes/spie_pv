// Azure Container Registry (Basic), compte administrateur désactivé :
// les Container Apps tirent les images avec l'identité managée (rôle AcrPull),
// la CI pousse avec son identité fédérée GitHub (OIDC).

@description('Nom du registre (alphanumérique, unique dans Azure).')
@minLength(5)
@maxLength(50)
param name string

@description('Région Azure.')
param location string

@description('Tags appliqués à la ressource.')
param tags object

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

@description('Nom du registre.')
output name string = registry.name

@description('Identifiant de ressource du registre.')
output id string = registry.id

@description('Serveur de connexion (ex. <nom>.azurecr.io).')
output loginServer string = registry.properties.loginServer
