#Requires -Version 5.1
<#
.SYNOPSIS
    Vérifie, avec l'identité de l'application spie-pv (certificat), l'accès au site SharePoint cible.

.DESCRIPTION
    Vérification facultative, exécutée par l'équipe projet après le retour de la DSI :
      1. connexion en tant qu'application (client id + certificat PEM lu dans le Key Vault spie-pv) ;
      2. lecture du site cible et liste de ses bibliothèques de documents (doit réussir) ;
      3. option -OtherSiteUrl : lecture d'un AUTRE site du tenant (doit être refusée : preuve que l'accès est limité) ;
      4. option -TestUpload : dépôt d'un petit fichier texte de vérification dans la bibliothèque par défaut du site
         (comportement « conflictBehavior=fail » : jamais d'écrasement). Le fichier peut être supprimé ensuite.

    La session Azure CLI de l'application est ouverte dans un répertoire de configuration temporaire
    (AZURE_CONFIG_DIR) : la session de l'utilisateur n'est pas modifiée. Le PEM (clé privée) est écrit dans un
    dossier temporaire supprimé en fin de script, même en cas d'erreur.

    Prérequis : Azure CLI 2.67+ connecté au tenant de la souscription spie-pv, rôle « Key Vault Secrets Officer »
    (ou « Key Vault Secrets User ») sur le coffre pour lire le certificat.

.PARAMETER TenantId
    Tenant Entra ID de SPIE (GRAPH_TENANT_ID).

.PARAMETER ClientId
    Client id de l'application spie-pv-<env>-sharepoint (GRAPH_CLIENT_ID).

.PARAMETER SiteId
    Id Graph du site cible (SHAREPOINT_SITE_ID, forme hote,guid,guid).

.PARAMETER KeyVaultName
    Key Vault spie-pv contenant le certificat graph-cert.

.PARAMETER CertificateName
    Nom du certificat dans le coffre (graph-cert).

.PARAMETER PemFile
    Alternative au Key Vault : fichier PEM (clé privée + certificat). À manipuler avec précaution.

.PARAMETER OtherSiteUrl
    URL d'un autre site du tenant, auquel l'application ne doit PAS avoir accès.

.PARAMETER TestUpload
    Dépose un fichier texte de vérification dans la bibliothèque par défaut du site.

.PARAMETER UploadFolder
    Dossier (relatif à la racine de la bibliothèque) où déposer le fichier de vérification. Racine par défaut.

.EXAMPLE
    .\Test-SharePointAccess.ps1 -TenantId <tenant-id-SPIE> -ClientId <client-id> -SiteId '<hote>,<guid>,<guid>' -KeyVaultName <nom-du-key-vault> -OtherSiteUrl https://<tenant>.sharepoint.com/sites/<autre-site>

.EXAMPLE
    .\Test-SharePointAccess.ps1 -TenantId <tenant-id-SPIE> -ClientId <client-id> -SiteId '<hote>,<guid>,<guid>' -KeyVaultName <nom-du-key-vault> -TestUpload
#>
[CmdletBinding(DefaultParameterSetName = 'KeyVault')]
param(
    [Parameter(Mandatory = $true)][string] $TenantId,
    [Parameter(Mandatory = $true)][string] $ClientId,
    [Parameter(Mandatory = $true)][string] $SiteId,
    [Parameter(Mandatory = $true, ParameterSetName = 'KeyVault')][string] $KeyVaultName,
    [Parameter(ParameterSetName = 'KeyVault')][string] $CertificateName = 'graph-cert',
    [Parameter(Mandatory = $true, ParameterSetName = 'Pem')][string] $PemFile,
    [string] $OtherSiteUrl,
    [switch] $TestUpload,
    [string] $UploadFolder
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'SpiePv.Commun.ps1')

$resultats = New-Object System.Collections.Generic.List[object]
function Add-Resultat {
    param([string] $Test, [bool] $Reussi, [string] $Detail)
    $resultats.Add([pscustomobject]@{ Test = $Test; Resultat = $(if ($Reussi) { 'OK' } else { 'ECHEC' }); Detail = $Detail })
    if ($Reussi) { Write-Ok "$Test - $Detail" } else { Write-Echec "$Test - $Detail" }
}

function Get-ExplicationRefus {
    param($Reponse)
    switch ($Reponse.Status) {
        401 { return 'jeton sans rôle applicatif : consentement administrateur Sites.Selected manquant, ou certificat non associé à l''application.' }
        403 { return 'accès refusé : l''écriture sur ce site n''a pas été accordée (Grant-SharePointSiteAccess.ps1).' }
        404 { return 'site introuvable : vérifier SHAREPOINT_SITE_ID.' }
        default { return $Reponse.ErrorText }
    }
}

Assert-AzCliDisponible
$dossierTravail = Join-Path ([System.IO.Path]::GetTempPath()) ('spiepv-verif-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $dossierTravail | Out-Null
$configAzurePrecedente = $env:AZURE_CONFIG_DIR
$sessionApplicationOuverte = $false

try {
    # --- Certificat -----------------------------------------------------------------------------------------------
    Write-Etape 'Certificat de l''application'
    if ($PSCmdlet.ParameterSetName -eq 'KeyVault') {
        $pem = Join-Path $dossierTravail 'graph-cert.pem'
        # Session de l'utilisateur (avant bascule de AZURE_CONFIG_DIR) : lecture du secret adossé au certificat.
        Invoke-AzCli -Arguments @(
            'keyvault', 'secret', 'download',
            '--vault-name', $KeyVaultName,
            '--name', $CertificateName,
            '--file', $pem,
            '--encoding', 'utf-8'
        ) | Out-Null
        Write-Ok "PEM lu dans le Key Vault $KeyVaultName (fichier temporaire)."
    }
    else {
        $pem = (Resolve-Path -LiteralPath $PemFile).ProviderPath
    }
    $contenuPem = [System.IO.File]::ReadAllText($pem)
    if ($contenuPem -notmatch 'PRIVATE KEY' -or $contenuPem -notmatch 'BEGIN CERTIFICATE') {
        throw 'Le PEM doit contenir la clé privée et le certificat (certificat Key Vault créé avec le type application/x-pem-file).'
    }
    $contenuPem = $null

    # --- Connexion en tant qu'application ---------------------------------------------------------------------------
    Write-Etape 'Connexion en tant qu''application (session Azure CLI isolée)'
    $env:AZURE_CONFIG_DIR = Join-Path $dossierTravail 'azure-cli'
    $connexion = Invoke-AzCli -AllowFailure -Arguments @(
        'login', '--service-principal',
        '--username', $ClientId,
        '--tenant', $TenantId,
        '--certificate', $pem,
        '--allow-no-subscriptions',
        '--output', 'none'
    )
    if ($connexion.ExitCode -ne 0) {
        Add-Resultat -Test 'Authentification' -Reussi $false -Detail ("certificat refusé ou application introuvable : {0}" -f $connexion.ErrorText)
        throw 'Authentification impossible : arrêt des tests.'
    }
    $sessionApplicationOuverte = $true
    Add-Resultat -Test 'Authentification' -Reussi $true -Detail "application $ClientId authentifiée par certificat"

    # --- Site cible -------------------------------------------------------------------------------------------------
    Write-Etape 'Site cible'
    $site = Invoke-GraphAzRest -Method GET -Uri "$($script:GraphBaseUrl)/sites/$SiteId" -AllowFailure
    if ($site.Ok) {
        Add-Resultat -Test 'Lecture du site cible' -Reussi $true -Detail ("{0} ({1})" -f $site.Data.displayName, $site.Data.webUrl)
    }
    else {
        Add-Resultat -Test 'Lecture du site cible' -Reussi $false -Detail (Get-ExplicationRefus $site)
    }

    $bibliotheques = Invoke-GraphAzRest -Method GET -Uri "$($script:GraphBaseUrl)/sites/$SiteId/drives" -AllowFailure
    if ($bibliotheques.Ok) {
        $liste = @(@($bibliotheques.Data.value) | Where-Object { $_ })
        Add-Resultat -Test 'Liste des bibliothèques' -Reussi $true -Detail ("{0} bibliothèque(s)" -f $liste.Count)
        foreach ($bibliotheque in $liste) {
            Write-Info ("- {0} [{1}] {2}" -f $bibliotheque.name, $bibliotheque.driveType, $bibliotheque.webUrl)
        }
    }
    else {
        Add-Resultat -Test 'Liste des bibliothèques' -Reussi $false -Detail (Get-ExplicationRefus $bibliotheques)
    }

    # --- Autre site : doit être refusé ------------------------------------------------------------------------------
    if ($OtherSiteUrl) {
        Write-Etape "Autre site (doit être refusé) : $OtherSiteUrl"
        $autre = Invoke-GraphAzRest -Method GET -Uri ($script:GraphBaseUrl + (ConvertTo-UrlSiteGraph -SiteUrl $OtherSiteUrl)) -AllowFailure
        if ($autre.Ok) {
            Add-Resultat -Test 'Isolation (autre site)' -Reussi $false -Detail 'l''application lit un autre site : permission trop large (Sites.Read.All / Sites.ReadWrite.All ?) à retirer.'
        }
        elseif ($autre.Status -eq 403 -or $autre.Status -eq 404) {
            Add-Resultat -Test 'Isolation (autre site)' -Reussi $true -Detail ("accès refusé comme attendu (HTTP {0})" -f $autre.Status)
        }
        else {
            Add-Resultat -Test 'Isolation (autre site)' -Reussi $false -Detail ("réponse inattendue : {0}" -f $autre.ErrorText)
        }
    }

    # --- Dépôt d'un fichier de vérification -------------------------------------------------------------------------
    if ($TestUpload) {
        Write-Etape 'Dépôt d''un fichier de vérification'
        $bibliothequeParDefaut = Invoke-GraphAzRest -Method GET -Uri "$($script:GraphBaseUrl)/sites/$SiteId/drive" -AllowFailure
        if (-not $bibliothequeParDefaut.Ok) {
            Add-Resultat -Test 'Dépôt de fichier' -Reussi $false -Detail (Get-ExplicationRefus $bibliothequeParDefaut)
        }
        else {
            $horodatage = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
            $nomFichier = "spie-pv-verification-$horodatage.txt"
            $segments = @()
            if ($UploadFolder) {
                $segments += @($UploadFolder.Trim('/').Split('/') | Where-Object { $_ } | ForEach-Object { [System.Uri]::EscapeDataString($_) })
            }
            $segments += [System.Uri]::EscapeDataString($nomFichier)
            $cheminRelatif = $segments -join '/'

            $fichierLocal = Join-Path $dossierTravail $nomFichier
            $texte = "Fichier de vérification spie-pv (application $ClientId), déposé le $horodatage UTC. Peut être supprimé."
            [System.IO.File]::WriteAllText($fichierLocal, $texte, (New-Object System.Text.UTF8Encoding($false)))

            $uriDepot = "{0}/drives/{1}/root:/{2}:/content?@microsoft.graph.conflictBehavior=fail" -f $script:GraphBaseUrl, $bibliothequeParDefaut.Data.id, $cheminRelatif
            $depot = Invoke-GraphAzRest -Method PUT -Uri $uriDepot -BodyFile $fichierLocal -ContentType 'text/plain' -AllowFailure
            if ($depot.Ok) {
                Add-Resultat -Test 'Dépôt de fichier' -Reussi $true -Detail $depot.Data.webUrl
            }
            else {
                Add-Resultat -Test 'Dépôt de fichier' -Reussi $false -Detail (Get-ExplicationRefus $depot)
            }
        }
    }
}
finally {
    if ($sessionApplicationOuverte) {
        Invoke-AzCli -Arguments @('logout') -AllowFailure | Out-Null
    }
    if ($null -eq $configAzurePrecedente) {
        Remove-Item Env:\AZURE_CONFIG_DIR -ErrorAction SilentlyContinue
    }
    else {
        $env:AZURE_CONFIG_DIR = $configAzurePrecedente
    }
    Remove-Item -LiteralPath $dossierTravail -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Etape 'Synthèse'
$resultats | Format-Table -AutoSize | Out-String | Write-Host
$echecs = @($resultats | Where-Object { $_.Resultat -ne 'OK' }).Count
if ($echecs -gt 0) { exit 1 }
