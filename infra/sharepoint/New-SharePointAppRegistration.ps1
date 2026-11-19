#Requires -Version 5.1
<#
.SYNOPSIS
    Crée ou met à jour l'app registration « spie-pv-<env>-sharepoint » dans le tenant Entra ID de SPIE.

.DESCRIPTION
    À exécuter par la DSI SPIE, avec Azure CLI connecté au tenant SPIE :
        az login --tenant <tenant-id-SPIE> --allow-no-subscriptions
    Rôles Entra ID nécessaires :
      - « Application Administrator » ou « Cloud Application Administrator » : création de l'application ;
      - « Privileged Role Administrator » ou « Global Administrator » : consentement (-GrantAdminConsent).

    Étapes (idempotentes, le script peut être relancé sans créer de doublon) :
      1. Lecture de l'id du rôle applicatif Microsoft Graph « Sites.Selected » dans le tenant (pas de GUID en dur).
      2. Création de l'application mono-tenant si elle n'existe pas, puis de son principal de service.
      3. Déclaration de la seule permission d'application Microsoft Graph « Sites.Selected ».
      4. Ajout de la clé PUBLIQUE du certificat fourni par l'équipe projet (aucun secret, aucun mot de passe d'application) :
           -CertificateFile : fichier .cer transmis par l'équipe projet (cas général) ;
           -KeyVaultName    : certificat lu directement dans le Key Vault spie-pv, si celui-ci est dans le même tenant
                              et accessible au compte connecté (équivalent de « az ad app credential reset --keyvault »).
      5. Option -GrantAdminConsent : consentement administrateur pour Sites.Selected.

    « Sites.Selected » seule ne donne accès à AUCUN site SharePoint. L'écriture sur le seul site cible est accordée
    ensuite par Grant-SharePointSiteAccess.ps1.

.PARAMETER Environment
    recette ou production. Nom par défaut de l'application : spie-pv-<env>-sharepoint.

.PARAMETER CertificateFile
    Fichier .cer (PEM ou DER) contenant uniquement la clé publique, fourni par l'équipe projet.

.PARAMETER KeyVaultName
    Nom du Key Vault spie-pv contenant le certificat (mode « même tenant »).

.PARAMETER CertificateName
    Nom du certificat dans le Key Vault (graph-cert).

.PARAMETER DisplayName
    Nom de l'application, si différent de la convention.

.PARAMETER TenantId
    Tenant attendu : le script s'arrête si Azure CLI est connecté à un autre tenant.

.PARAMETER GrantAdminConsent
    Accorde le consentement administrateur pour Sites.Selected.

.EXAMPLE
    .\New-SharePointAppRegistration.ps1 -Environment recette -CertificateFile .\spie-pv-recette-sharepoint.cer -TenantId <tenant-id-SPIE> -GrantAdminConsent

.EXAMPLE
    .\New-SharePointAppRegistration.ps1 -Environment recette -CertificateFile .\spie-pv-recette-sharepoint.cer -WhatIf
#>
[CmdletBinding(SupportsShouldProcess = $true, DefaultParameterSetName = 'Fichier')]
param(
    [Parameter(Mandatory = $true)][ValidateSet('recette', 'production')][string] $Environment,
    [Parameter(Mandatory = $true, ParameterSetName = 'Fichier')][string] $CertificateFile,
    [Parameter(Mandatory = $true, ParameterSetName = 'KeyVault')][string] $KeyVaultName,
    [Parameter(ParameterSetName = 'KeyVault')][string] $CertificateName = 'graph-cert',
    [string] $DisplayName,
    [string] $TenantId,
    [switch] $GrantAdminConsent
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'SpiePv.Commun.ps1')

if (-not $DisplayName) { $DisplayName = "spie-pv-$Environment-sharepoint" }

# --- 0. Contexte ------------------------------------------------------------------------------------------------------
Write-Etape 'Connexion Azure CLI'
$compte = Assert-AzConnecte -TenantId $TenantId

# --- 1. Certificat (lu avant toute modification, pour échouer tôt) ----------------------------------------------------
Write-Etape 'Certificat (clé publique)'
if ($PSCmdlet.ParameterSetName -eq 'Fichier') {
    $cheminCertificat = (Resolve-Path -LiteralPath $CertificateFile).ProviderPath
    $texte = [System.IO.File]::ReadAllText($cheminCertificat)
    if ($texte -match 'PRIVATE KEY') {
        throw "Le fichier $cheminCertificat contient une clé privée. Seule la clé publique (.cer) doit être utilisée : supprimez ce fichier et demandez le .cer à l'équipe projet."
    }
    $x509 = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 -ArgumentList $cheminCertificat
    $empreinte = Get-EmpreinteCertificat -ThumbprintHex $x509.Thumbprint
    $sujetCertificat = $x509.Subject
    $expiration = $x509.NotAfter
    if ($expiration -lt (Get-Date)) { throw "Le certificat a expiré le $expiration." }
}
else {
    $r = Invoke-AzCli -Arguments @(
        'keyvault', 'certificate', 'show',
        '--vault-name', $KeyVaultName,
        '--name', $CertificateName,
        '--query', '{thumbprint: x509ThumbprintHex, expires: attributes.expires, subject: policy.x509CertificateProperties.subject}',
        '--output', 'json'
    )
    $infos = ConvertFrom-Json -InputObject $r.Output
    $empreinte = Get-EmpreinteCertificat -ThumbprintHex $infos.thumbprint
    $sujetCertificat = $infos.subject
    $expiration = $infos.expires
}
Write-Ok ("{0} - empreinte {1} - expire le {2}" -f $sujetCertificat, $empreinte.Hex, $expiration)

# --- 2. Rôle Sites.Selected -------------------------------------------------------------------------------------------
Write-Etape 'Permission Microsoft Graph « Sites.Selected »'
$roleSitesSelected = Get-SitesSelectedRoleId
Write-Ok "Id du rôle applicatif : $roleSitesSelected"

# --- 3. Application ---------------------------------------------------------------------------------------------------
Write-Etape "App registration « $DisplayName »"
$appIds = @(Split-Lignes (Invoke-AzCli -Arguments @('ad', 'app', 'list', '--display-name', $DisplayName, '--query', '[].appId', '--output', 'tsv')).Output)
if ($appIds.Count -gt 1) {
    throw ("Plusieurs applications portent le nom « {0} » ({1}). Supprimez les doublons ou précisez -DisplayName." -f $DisplayName, ($appIds -join ', '))
}
if ($appIds.Count -eq 1) {
    $appId = $appIds[0]
    Write-Ok "Existe déjà (client id $appId)"
}
else {
    if (-not $PSCmdlet.ShouldProcess($DisplayName, 'Créer l''app registration mono-tenant')) {
        Write-Info 'Simulation (-WhatIf) : l''application n''existe pas, les étapes suivantes s''appliqueraient à l''application créée.'
        return
    }
    $appId = (Invoke-AzCli -Arguments @(
            'ad', 'app', 'create',
            '--display-name', $DisplayName,
            '--sign-in-audience', 'AzureADMyOrg',
            '--query', 'appId',
            '--output', 'tsv'
        )).Output.Trim()
    Write-Ok "Créée (client id $appId)"
}

# --- 4. Principal de service ------------------------------------------------------------------------------------------
Write-Etape 'Principal de service (application d''entreprise)'
$sp = Invoke-AzCli -Arguments @('ad', 'sp', 'show', '--id', $appId, '--query', 'id', '--output', 'tsv') -AllowFailure
if ($sp.ExitCode -eq 0 -and $sp.Output) {
    $spObjectId = $sp.Output.Trim()
    Write-Ok "Existe déjà (object id $spObjectId)"
}
elseif ($PSCmdlet.ShouldProcess($appId, 'Créer le principal de service')) {
    $spObjectId = Invoke-AvecReessai -Description 'Création du principal de service' -Bloc {
        (Invoke-AzCli -Arguments @('ad', 'sp', 'create', '--id', $appId, '--query', 'id', '--output', 'tsv')).Output.Trim()
    }
    Write-Ok "Créé (object id $spObjectId)"
}

# --- 5. Permission déclarée -------------------------------------------------------------------------------------------
Write-Etape 'Permission d''application déclarée'
$permissionsGraph = @(Split-Lignes (Invoke-AzCli -Arguments @(
            'ad', 'app', 'show', '--id', $appId,
            '--query', "requiredResourceAccess[?resourceAppId=='$($script:GraphAppId)'].resourceAccess[].id",
            '--output', 'tsv'
        )).Output)
$toutesPermissions = @(Split-Lignes (Invoke-AzCli -Arguments @(
            'ad', 'app', 'show', '--id', $appId,
            '--query', 'requiredResourceAccess[].resourceAccess[].id',
            '--output', 'tsv'
        )).Output)

if ($permissionsGraph -contains $roleSitesSelected) {
    Write-Ok 'Sites.Selected (Application) déjà déclarée.'
}
elseif ($PSCmdlet.ShouldProcess($appId, 'Déclarer la permission Microsoft Graph Sites.Selected (Application)')) {
    Invoke-AvecReessai -Description 'Ajout de la permission' -Bloc {
        Invoke-AzCli -Arguments @(
            'ad', 'app', 'permission', 'add',
            '--id', $appId,
            '--api', $script:GraphAppId,
            '--api-permissions', "$roleSitesSelected=Role",
            '--output', 'none'
        ) | Out-Null
    } | Out-Null
    Write-Ok 'Sites.Selected (Application) déclarée.'
}
$autres = @($toutesPermissions | Where-Object { $_ -ne $roleSitesSelected })
if ($autres.Count -gt 0) {
    Write-Attention ("L'application déclare d'autres permissions ({0}). spie-pv n'a besoin que de Sites.Selected : à retirer." -f ($autres -join ', '))
}

# --- 6. Certificat ----------------------------------------------------------------------------------------------------
Write-Etape 'Clé publique du certificat'
$clesExistantes = @(Split-Lignes (Invoke-AzCli -Arguments @(
            'ad', 'app', 'credential', 'list', '--id', $appId, '--cert',
            '--query', '[].customKeyIdentifier',
            '--output', 'tsv'
        )).Output)
$dejaPresente = @($clesExistantes | Where-Object { $_ -ieq $empreinte.Hex -or $_ -ceq $empreinte.Base64 }).Count -gt 0

if ($dejaPresente) {
    Write-Ok 'Cette clé publique est déjà associée à l''application.'
}
elseif ($PSCmdlet.ShouldProcess($appId, "Ajouter la clé publique du certificat $($empreinte.Hex) (sans supprimer les clés existantes)")) {
    if ($PSCmdlet.ParameterSetName -eq 'Fichier') {
        $argumentsCle = @('ad', 'app', 'credential', 'reset', '--id', $appId, '--cert', "@$cheminCertificat", '--append', '--output', 'none')
    }
    else {
        $argumentsCle = @('ad', 'app', 'credential', 'reset', '--id', $appId, '--keyvault', $KeyVaultName, '--cert', $CertificateName, '--append', '--output', 'none')
    }
    $ajout = Invoke-AvecReessai -Description 'Ajout de la clé publique' -Bloc {
        $tentative = Invoke-AzCli -Arguments $argumentsCle -AllowFailure
        # Un doublon refusé par Entra ID signifie que la clé est déjà là : pas d'erreur, pas de nouvel essai.
        if ($tentative.ExitCode -ne 0 -and $tentative.ErrorText -notmatch 'already exist|duplicate') { throw $tentative.ErrorText }
        $tentative
    }
    if ($ajout.ExitCode -eq 0) { Write-Ok 'Clé publique ajoutée.' }
    else { Write-Ok 'Clé publique déjà associée (doublon refusé par Entra ID).' }
}
if ($clesExistantes.Count -gt 0 -and -not $dejaPresente) {
    Write-Info ("{0} autre(s) clé(s) déjà présente(s) : conservée(s). Retirer l'ancienne après bascule : az ad app credential delete --id {1} --key-id <key-id> --cert" -f $clesExistantes.Count, $appId)
}

# --- 7. Consentement administrateur -----------------------------------------------------------------------------------
Write-Etape 'Consentement administrateur pour Sites.Selected'
$consentement = 'non vérifié'
if ($spObjectId) {
    $graphSpObjectId = (Invoke-AzCli -Arguments @('ad', 'sp', 'show', '--id', $script:GraphAppId, '--query', 'id', '--output', 'tsv')).Output.Trim()
    $attributions = Invoke-GraphAzRest -Method GET -Uri "$($script:GraphBaseUrl)/servicePrincipals/$spObjectId/appRoleAssignments" -AllowFailure
    $dejaAccorde = $false
    if ($attributions.Ok -and $attributions.Data) {
        $dejaAccorde = @($attributions.Data.value | Where-Object { $_.appRoleId -eq $roleSitesSelected -and $_.resourceId -eq $graphSpObjectId }).Count -gt 0
    }

    if ($dejaAccorde) {
        $consentement = 'accordé'
        Write-Ok 'Consentement déjà accordé.'
    }
    elseif (-not $GrantAdminConsent) {
        $consentement = 'EN ATTENTE'
        Write-Attention 'Consentement non accordé. Relancer avec -GrantAdminConsent (Privileged Role Administrator ou Global Administrator),'
        Write-Info ('ou portail Entra : Inscriptions d''applications > {0} > Autorisations de l''API > Accorder un consentement d''administrateur.' -f $DisplayName)
    }
    elseif ($PSCmdlet.ShouldProcess($DisplayName, 'Accorder le consentement administrateur pour Sites.Selected')) {
        $corps = @{
            principalId = $spObjectId
            resourceId  = $graphSpObjectId
            appRoleId   = $roleSitesSelected
        }
        try {
            # Réessais : le principal de service fraîchement créé peut ne pas encore être répliqué.
            $resultat = Invoke-AvecReessai -Description 'Consentement' -Bloc {
                $tentative = Invoke-GraphAzRest -Method POST -Uri "$($script:GraphBaseUrl)/servicePrincipals/$graphSpObjectId/appRoleAssignedTo" -Body $corps -AllowFailure
                if (-not $tentative.Ok -and $tentative.Status -ne 403) { throw $tentative.ErrorText }
                $tentative
            }
        }
        catch {
            $resultat = [pscustomobject]@{ Ok = $false; ErrorText = $_.Exception.Message }
        }
        if ($resultat.Ok) {
            $consentement = 'accordé'
            Write-Ok 'Consentement accordé.'
        }
        else {
            # Repli : commande de consentement intégrée à Azure CLI.
            $repli = Invoke-AzCli -Arguments @('ad', 'app', 'permission', 'admin-consent', '--id', $appId, '--output', 'none') -AllowFailure
            if ($repli.ExitCode -eq 0) {
                $consentement = 'accordé'
                Write-Ok 'Consentement accordé (az ad app permission admin-consent).'
            }
            else {
                $consentement = 'EN ATTENTE'
                Write-Echec 'Consentement refusé : rôle « Privileged Role Administrator » ou « Global Administrator » requis.'
                Write-Info $resultat.ErrorText
                Write-Info 'Alternative : portail Entra > Inscriptions d''applications > Autorisations de l''API > Accorder un consentement d''administrateur.'
            }
        }
    }
}

# --- Récapitulatif ----------------------------------------------------------------------------------------------------
Write-Etape 'Récapitulatif (à transmettre à l''équipe projet)'
Write-Info ("GRAPH_TENANT_ID  = {0}" -f $compte.tenantId)
Write-Info ("GRAPH_CLIENT_ID  = {0}" -f $appId)
Write-Info ("Application      = {0}" -f $DisplayName)
Write-Info ("Certificat       = {0} (expire le {1})" -f $empreinte.Hex, $expiration)
Write-Info ("Consentement     = {0}" -f $consentement)
Write-Host ''
Write-Info 'Étape suivante : accorder l''écriture sur le site cible uniquement :'
Write-Info ("  .\Grant-SharePointSiteAccess.ps1 -SiteUrl https://<tenant>.sharepoint.com/sites/<site> -ClientId {0} -Environment {1}" -f $appId, $Environment)
