// Container App générique (utilisée pour l'API et pour le worker, même image spie-pv).
//  - image tirée de l'ACR avec l'identité managée user-assigned (rôle AcrPull) ;
//  - secrets = références Key Vault lues avec la même identité (rôle Key Vault Secrets User) ;
//  - ingress HTTPS externe et sondes HTTP facultatifs (API uniquement).

@description('Nom de la Container App (minuscules, chiffres et tirets, 32 caractères maximum).')
@minLength(2)
@maxLength(32)
param name string

@description('Région Azure.')
param location string

@description('Tags appliqués à la ressource.')
param tags object

@description('Identifiant de l\'environnement Container Apps.')
param environmentId string

@description('Profil de charge de l\'environnement.')
param workloadProfileName string = 'Consumption'

@description('Nom du conteneur dans la révision.')
param containerName string

@description('Image complète (<registre>/<dépôt>:<tag>).')
param image string

@description('Identifiant de ressource de l\'identité managée user-assigned.')
param identityId string

@description('Serveur de connexion de l\'ACR (<nom>.azurecr.io).')
param registryServer string

@description('Commande du conteneur (remplace l\'ENTRYPOINT de l\'image). Vide = commande par défaut de l\'image.')
param command string[] = []

@description('Variables d\'environnement : [{ name, value }] ou [{ name, secretRef }].')
param env array = []

@description('Secrets de l\'application : [{ name, keyVaultUrl, identity }].')
param secrets array = []

@description('Active l\'ingress HTTPS externe.')
param ingressEnabled bool = false

@description('Port d\'écoute du conteneur (ingress et sondes).')
param targetPort int = 3000

@description('Chemin de la sonde de santé HTTP. Vide = aucune sonde.')
param healthPath string = ''

@description('vCPU du conteneur (chaîne décimale, ex. « 0.5 »). Profil Consumption : ratio 1 vCPU pour 2 Gi.')
param cpu string = '0.5'

@description('Mémoire du conteneur (ex. « 1Gi »).')
param memory string = '1Gi'

@description('Nombre minimal de réplicas.')
@minValue(0)
@maxValue(10)
param minReplicas int = 1

@description('Nombre maximal de réplicas.')
@minValue(1)
@maxValue(10)
param maxReplicas int = 1

@description('Requêtes HTTP simultanées par réplica avant ajout d\'un réplica (si ingress).')
param httpConcurrentRequests int = 50

var healthCheck = {
  path: healthPath
  port: targetPort
  scheme: 'HTTP'
}

// Startup : laisse jusqu'à ~105 s au premier démarrage (migrations de base appliquées au démarrage de l'API).
// Liveness / Readiness : prennent le relais une fois la sonde Startup réussie.
var healthProbes = [
  {
    type: 'Startup'
    httpGet: healthCheck
    initialDelaySeconds: 5
    periodSeconds: 10
    timeoutSeconds: 5
    failureThreshold: 10
  }
  {
    type: 'Liveness'
    httpGet: healthCheck
    periodSeconds: 30
    timeoutSeconds: 5
    failureThreshold: 3
  }
  {
    type: 'Readiness'
    httpGet: healthCheck
    periodSeconds: 10
    timeoutSeconds: 5
    failureThreshold: 3
  }
]

var probes = empty(healthPath) ? [] : healthProbes

var ingressConfig = {
  external: true
  targetPort: targetPort
  transport: 'auto'
  // HTTPS uniquement : les requêtes HTTP sont redirigées vers HTTPS par l'ingress.
  allowInsecure: false
  traffic: [
    {
      latestRevision: true
      weight: 100
    }
  ]
}

var httpScaleRules = [
  {
    name: 'http-concurrence'
    http: {
      metadata: {
        concurrentRequests: string(httpConcurrentRequests)
      }
    }
  }
]

var baseContainer = {
  name: containerName
  image: image
  env: env
  resources: {
    cpu: json(cpu)
    memory: memory
  }
  probes: probes
}

var commandOverride = {
  command: command
}

var container = empty(command) ? baseContainer : union(baseContainer, commandOverride)

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: name
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identityId}': {}
    }
  }
  properties: {
    environmentId: environmentId
    workloadProfileName: workloadProfileName
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: ingressEnabled ? ingressConfig : null
      registries: [
        {
          server: registryServer
          identity: identityId
        }
      ]
      secrets: secrets
    }
    template: {
      containers: [
        container
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
        rules: ingressEnabled ? httpScaleRules : []
      }
    }
  }
}

@description('Nom de la Container App.')
output name string = app.name

@description('FQDN public de l\'application (vide si pas d\'ingress).')
output fqdn string = ingressEnabled ? app.properties.configuration.ingress.fqdn : ''

@description('Nom de la dernière révision créée.')
output latestRevisionName string = app.properties.latestRevisionName
