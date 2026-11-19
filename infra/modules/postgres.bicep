// Azure Database for PostgreSQL - Flexible Server : données métier et file de tâches pg-boss.
//
// Réseau (recette) : accès public + règle « Allow Azure services » (0.0.0.0). ATTENTION : cette règle autorise
// toute adresse IP sortante d'Azure, y compris d'autres clients Azure ; seuls le mot de passe et TLS protègent
// alors la base. Option recommandée pour la production : accès privé (VNet) :
//   - serveur déployé dans un sous-réseau délégué (Microsoft.DBforPostgreSQL/flexibleServers) + zone DNS privée
//     privatelink.postgres.database.azure.com, network.publicNetworkAccess = 'Disabled' ;
//   - environnement Container Apps intégré au même VNet (infrastructureSubnetId).
//   Ces deux choix se font À LA CRÉATION (ni le serveur ni l'environnement Container Apps ne peuvent basculer
//   ensuite) : à trancher avant le premier déploiement de production.
//
// Les sous-ressources (base, pare-feu, paramètres) sont sérialisées : le service refuse les opérations
// concurrentes sur un même serveur (« ServerBusy »).

@description('Nom du serveur (minuscules, chiffres et tirets, unique dans Azure).')
@minLength(3)
@maxLength(63)
param name string

@description('Région Azure.')
param location string

@description('Tags appliqués aux ressources.')
param tags object

@description('Identifiant administrateur PostgreSQL.')
param administratorLogin string

@description('Mot de passe administrateur PostgreSQL.')
@secure()
param administratorLoginPassword string

@description('SKU de calcul (Burstable Standard_B1ms : plus petit tier, spec 8.6).')
param skuName string = 'Standard_B1ms'

@description('Niveau de calcul correspondant au SKU.')
@allowed(['Burstable', 'GeneralPurpose', 'MemoryOptimized'])
param skuTier string = 'Burstable'

@description('Version majeure de PostgreSQL.')
@allowed(['16'])
param version string = '16'

@description('Taille de stockage initiale en Go (agrandissement automatique activé, jamais réduite).')
param storageSizeGB int = 32

@description('Rétention des sauvegardes en jours (restauration à un instant donné dans cette fenêtre).')
@minValue(7)
@maxValue(35)
param backupRetentionDays int = 7

@description('Sauvegardes géo-redondantes. Ne peut être choisi qu\'à la création du serveur.')
param geoRedundantBackup bool = false

@description('Nom de la base applicative.')
param databaseName string = 'spiepv'

@description('Ajoute la règle « Allow Azure services » (0.0.0.0).')
param allowAzureServices bool = true

@description('Règles de pare-feu supplémentaires : [{ name, startIpAddress, endIpAddress }] (poste d\'administration, etc.).')
param firewallRules array = []

@description('Extensions PostgreSQL à autoriser (paramètre azure.extensions, ex. « PGCRYPTO,CITEXT »). Vide = aucune modification.')
param allowedExtensions string = ''

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: skuName
    tier: skuTier
  }
  properties: {
    version: version
    administratorLogin: administratorLogin
    administratorLoginPassword: administratorLoginPassword
    authConfig: {
      activeDirectoryAuth: 'Disabled'
      passwordAuth: 'Enabled'
    }
    storage: {
      storageSizeGB: storageSizeGB
      autoGrow: 'Enabled'
    }
    backup: {
      backupRetentionDays: backupRetentionDays
      geoRedundantBackup: geoRedundantBackup ? 'Enabled' : 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
    network: {
      publicNetworkAccess: 'Enabled'
    }
    // Maintenance planifiée le dimanche à 02:00 (UTC), hors heures ouvrées.
    maintenanceWindow: {
      customWindow: 'Enabled'
      dayOfWeek: 0
      startHour: 2
      startMinute: 0
    }
  }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: server
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

resource allowAzureServicesRule 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = if (allowAzureServices) {
  parent: server
  // Nom conventionnel utilisé par le portail pour la case « Autoriser l'accès public à partir de n'importe quel service Azure ».
  name: 'AllowAllAzureServicesAndResourcesWithinAzureIps'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
  dependsOn: [
    database
  ]
}

@batchSize(1)
resource extraFirewallRules 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = [
  for rule in firewallRules: {
    parent: server
    name: rule.name
    properties: {
      startIpAddress: rule.startIpAddress
      endIpAddress: rule.endIpAddress
    }
    dependsOn: [
      database
      allowAzureServicesRule
    ]
  }
]

// TLS obligatoire (valeur par défaut du service, fixée explicitement pour qu'elle ne puisse pas dériver).
resource requireSecureTransport 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: server
  name: 'require_secure_transport'
  properties: {
    value: 'on'
    source: 'user-override'
  }
  dependsOn: [
    database
    allowAzureServicesRule
    extraFirewallRules
  ]
}

resource extensionsAllowList 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = if (!empty(allowedExtensions)) {
  parent: server
  name: 'azure.extensions'
  properties: {
    value: allowedExtensions
    source: 'user-override'
  }
  dependsOn: [
    requireSecureTransport
  ]
}

@description('Nom du serveur.')
output name string = server.name

@description('Nom DNS du serveur (<nom>.postgres.database.azure.com).')
output fqdn string = server.properties.fullyQualifiedDomainName

@description('Nom de la base applicative.')
output databaseName string = database.name
