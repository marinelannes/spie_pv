#Requires -Version 5.1
<#
.SYNOPSIS
    Accorde à l'application spie-pv l'écriture sur UN SEUL site SharePoint (Sites.Selected), et affiche son id Graph.

.DESCRIPTION
    À exécuter par la DSI SPIE, après New-SharePointAppRegistration.ps1 (permission Sites.Selected consentie).
    Le compte utilisé doit être administrateur SharePoint (ou Global Administrator) et appeler Microsoft Graph avec
    la permission déléguée Sites.FullControl.All (ou un principal de service disposant de Sites.FullControl.All en
    permission d'application).

    Étapes (idempotentes) :
      1. Résolution de l'id Graph du site depuis son URL : GET /sites/{hote}:/{chemin}
      2. Lecture des permissions existantes du site pour cette application.
      3. Création (POST /sites/{id}/permissions, roles = ["write"]) ou mise à jour (PATCH) de la permission.
         Avec -Revoke : suppression de la permission (DELETE).
      4. Affichage de SHAREPOINT_SITE_ID à reporter dans la configuration spie-pv.

    Deux modes d'authentification pour les appels Graph (mêmes requêtes REST) :
      -AuthMode AzCli   : « az rest » avec la session Azure CLI courante. Le jeton d'un UTILISATEUR connecté par
                          « az login » ne porte généralement PAS les permissions SharePoint (l'application Azure CLI
                          n'a pas Sites.FullControl.All) : ce mode convient surtout à une session
                          « az login --service-principal » d'un principal d'administration ayant Sites.FullControl.All.
      -AuthMode MgGraph : module Microsoft.Graph.Authentication, connexion interactive avec le consentement
                          Sites.FullControl.All. Mode recommandé pour un administrateur.

.PARAMETER SiteUrl
    URL du site cible, ex. https://<tenant>.sharepoint.com/sites/<site>.

.PARAMETER ClientId
    Client id (appId) de l'application spie-pv-<env>-sharepoint.

.PARAMETER Environment
    recette ou production (nom affiché de l'application dans la permission).

.PARAMETER AppDisplayName
    Nom affiché de l'application, si différent de spie-pv-<env>-sharepoint.

.PARAMETER Role
    write (par défaut, nécessaire au dépôt des PV) ou read.

.PARAMETER AuthMode
    AzCli (par défaut) ou MgGraph.

.PARAMETER TenantId
    Tenant SPIE (contrôle de la session Azure CLI, ou tenant de connexion Microsoft Graph PowerShell).

.PARAMETER Revoke
    Retire la permission de l'application sur ce site.

.EXAMPLE
    .\Grant-SharePointSiteAccess.ps1 -SiteUrl https://<tenant>.sharepoint.com/sites/<site> -ClientId <client-id> -Environment recette -AuthMode MgGraph

.EXAMPLE
    .\Grant-SharePointSiteAccess.ps1 -SiteUrl https://<tenant>.sharepoint.com/sites/<site> -ClientId <client-id> -AuthMode MgGraph -Revoke
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)][string] $SiteUrl,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')][string] $ClientId,
    [ValidateSet('recette', 'production')][string] $Environment = 'recette',
    [string] $AppDisplayName,
    [ValidateSet('write', 'read')][string] $Role = 'write',
    [ValidateSet('AzCli', 'MgGraph')][string] $AuthMode = 'AzCli',
    [string] $TenantId,
    [switch] $Revoke
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'SpiePv.Commun.ps1')

if (-not $AppDisplayName) { $AppDisplayName = "spie-pv-$Environment-sharepoint" }

function Invoke-Graph {
    # Appel Graph dans le mode choisi. Renvoie { Ok, Data, ErrorText, Status }.
    param(
        [Parameter(Mandatory = $true)][string] $Method,
        [Parameter(Mandatory = $true)][string] $Path,
        $Body = $null,
        [switch] $AllowFailure
    )
    $uri = $script:GraphBaseUrl + $Path
    if ($AuthMode -eq 'AzCli') {
        return Invoke-GraphAzRest -Method $Method -Uri $uri -Body $Body -AllowFailure:$AllowFailure
    }
    $parametres = @{
        Method      = $Method
        Uri         = $uri
        OutputType  = 'PSObject'
        ErrorAction = 'Stop'
    }
    if ($null -ne $Body) {
        $parametres['Body'] = ConvertTo-Json -InputObject $Body -Depth 10 -Compress
        $parametres['ContentType'] = 'application/json'
    }
    try {
        $donnees = Invoke-MgGraphRequest @parametres
        return [pscustomobject]@{ Ok = $true; Data = $donnees; ErrorText = ''; Status = 200 }
    }
    catch {
        $message = $_.Exception.Message
        if (-not $AllowFailure) { throw ("Graph {0} {1} : {2}" -f $Method, $Path, $message) }
        return [pscustomobject]@{ Ok = $false; Data = $null; ErrorText = $message; Status = (Get-StatutHttp $message) }
    }
}

function Test-PermissionDeLApplication {
    # Vrai si la permission de site concerne l'application $ClientId.
    param($Permission)
    foreach ($propriete in @('grantedToIdentitiesV2', 'grantedToIdentities')) {
        foreach ($identite in @($Permission.$propriete)) {
            if ($identite -and $identite.application -and ($identite.application.id -eq $ClientId)) { return $true }
        }
    }
    return $false
}

function Write-AideDroits {
    param([string] $Detail)
    Write-Echec 'Accès refusé par Microsoft Graph.'
    if ($Detail) { Write-Info $Detail }
    if ($AuthMode -eq 'AzCli') {
        Write-Info 'Le jeton Azure CLI d''un utilisateur ne porte pas Sites.FullControl.All. Relancez avec -AuthMode MgGraph :'
        Write-Info '  Install-Module Microsoft.Graph.Authentication -Scope CurrentUser   (une seule fois)'
        Write-Info ('  .\Grant-SharePointSiteAccess.ps1 -SiteUrl {0} -ClientId {1} -Environment {2} -AuthMode MgGraph' -f $SiteUrl, $ClientId, $Environment)
    }
    else {
        Write-Info 'Le compte doit être administrateur SharePoint (ou Global Administrator) et avoir consenti à Sites.FullControl.All.'
    }
}

# --- 0. Connexion -----------------------------------------------------------------------------------------------------
Write-Etape "Connexion (mode $AuthMode)"
if ($AuthMode -eq 'AzCli') {
    $tenantConnecte = (Assert-AzConnecte -TenantId $TenantId).tenantId
}
else {
    if (-not (Get-Module -ListAvailable -Name Microsoft.Graph.Authentication)) {
        throw 'Module Microsoft.Graph.Authentication absent. Installation : Install-Module Microsoft.Graph.Authentication -Scope CurrentUser'
    }
    Import-Module Microsoft.Graph.Authentication
    $connexion = @{ Scopes = @('Sites.FullControl.All'); NoWelcome = $true }
    if ($TenantId) { $connexion['TenantId'] = $TenantId }
    Connect-MgGraph @connexion
    $contexte = Get-MgContext
    $tenantConnecte = $contexte.TenantId
    Write-Ok ("Connecté en tant que {0} (tenant {1})" -f $contexte.Account, $tenantConnecte)
}

# --- 1. Site ----------------------------------------------------------------------------------------------------------
Write-Etape "Résolution du site $SiteUrl"
$cheminSite = ConvertTo-UrlSiteGraph -SiteUrl $SiteUrl
$site = Invoke-Graph -Method GET -Path $cheminSite -AllowFailure
if (-not $site.Ok) {
    if ($site.Status -eq 403 -or $site.Status -eq 401) { Write-AideDroits -Detail $site.ErrorText; exit 1 }
    if ($site.Status -eq 404) { throw "Site introuvable : $SiteUrl (vérifier l'URL exacte du site, sans bibliothèque ni dossier)." }
    throw $site.ErrorText
}
$siteId = $site.Data.id
Write-Ok ("{0} - {1}" -f $site.Data.displayName, $site.Data.webUrl)
Write-Info "Id Graph du site : $siteId"

# --- 2. Permissions existantes ----------------------------------------------------------------------------------------
Write-Etape "Permissions de l'application $ClientId sur ce site"
$liste = Invoke-Graph -Method GET -Path "/sites/$siteId/permissions" -AllowFailure
if (-not $liste.Ok) {
    if ($liste.Status -eq 403 -or $liste.Status -eq 401) { Write-AideDroits -Detail $liste.ErrorText; exit 1 }
    throw $liste.ErrorText
}
$permissionsApp = @(@($liste.Data.value) | Where-Object { $_ -and (Test-PermissionDeLApplication -Permission $_) })

$rolesActuels = @()
foreach ($permission in $permissionsApp) {
    $detail = Invoke-Graph -Method GET -Path "/sites/$siteId/permissions/$($permission.id)"
    $rolesActuels += @($detail.Data.roles)
    Write-Info ("Permission existante {0} : rôles [{1}]" -f $permission.id, (@($detail.Data.roles) -join ', '))
}
if ($permissionsApp.Count -eq 0) { Write-Info 'Aucune permission existante.' }

# --- 3. Révocation ou attribution -------------------------------------------------------------------------------------
if ($Revoke) {
    Write-Etape 'Révocation'
    foreach ($permission in $permissionsApp) {
        if ($PSCmdlet.ShouldProcess("$SiteUrl", "Supprimer la permission $($permission.id) de l'application $ClientId")) {
            Invoke-Graph -Method DELETE -Path "/sites/$siteId/permissions/$($permission.id)" | Out-Null
            Write-Ok "Permission $($permission.id) supprimée."
        }
    }
    Write-Info 'L''application n''a plus accès à ce site. (Supprimer aussi l''app registration si elle n''est plus utilisée.)'
    return
}

Write-Etape "Attribution du rôle « $Role »"
if ($permissionsApp.Count -eq 0) {
    if ($PSCmdlet.ShouldProcess($SiteUrl, "Accorder le rôle $Role à l'application $AppDisplayName ($ClientId)")) {
        $corps = @{
            roles               = @($Role)
            grantedToIdentities = @(
                @{
                    application = @{
                        id          = $ClientId
                        displayName = $AppDisplayName
                    }
                }
            )
        }
        $creation = Invoke-Graph -Method POST -Path "/sites/$siteId/permissions" -Body $corps -AllowFailure
        if (-not $creation.Ok) {
            if ($creation.Status -eq 403 -or $creation.Status -eq 401) { Write-AideDroits -Detail $creation.ErrorText; exit 1 }
            throw $creation.ErrorText
        }
        Write-Ok ("Rôle « {0} » accordé (permission {1})." -f $Role, $creation.Data.id)
    }
}
elseif ($rolesActuels -contains $Role -and @($rolesActuels | Where-Object { $_ -ne $Role }).Count -eq 0) {
    Write-Ok "Rôle « $Role » déjà accordé : rien à faire."
}
else {
    $premiere = $permissionsApp[0]
    if ($PSCmdlet.ShouldProcess($SiteUrl, "Remplacer les rôles [$($rolesActuels -join ', ')] par [$Role]")) {
        Invoke-Graph -Method PATCH -Path "/sites/$siteId/permissions/$($premiere.id)" -Body @{ roles = @($Role) } | Out-Null
        Write-Ok "Rôles mis à jour : [$Role]."
    }
    if ($permissionsApp.Count -gt 1) {
        Write-Attention 'Plusieurs permissions existent pour cette application : relancer avec -Revoke puis réattribuer pour n''en garder qu''une.'
    }
}

# --- 4. Récapitulatif -------------------------------------------------------------------------------------------------
Write-Etape 'À transmettre à l''équipe projet'
Write-Info ("GRAPH_TENANT_ID    = {0}" -f $tenantConnecte)
Write-Info ("GRAPH_CLIENT_ID    = {0}" -f $ClientId)
Write-Info ("SHAREPOINT_SITE_ID = {0}" -f $siteId)
Write-Info ("Site               = {0}" -f $site.Data.webUrl)
