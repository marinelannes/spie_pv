#Requires -Version 5.1
<#
.SYNOPSIS
    Crée (si absent) le certificat auto-signé « graph-cert » dans le Key Vault spie-pv et exporte sa clé PUBLIQUE.

.DESCRIPTION
    À exécuter par l'équipe projet (exploitant de la souscription Azure), après le déploiement du socle Bicep.
    Rôle requis sur le Key Vault : « Key Vault Certificates Officer » (paramètre keyVaultOperators du Bicep).

    - Le certificat est généré DANS le Key Vault : la clé privée n'en sort jamais (sauf vers l'application, via
      l'identité managée).
    - Politique : RSA 2048, auto-signé, contenu du secret au format PEM (application/x-pem-file), lu par
      ClientCertificateCredential (@azure/identity) via le secret Key Vault « graph-cert » -> GRAPH_CERT_PEM.
    - Pas de renouvellement automatique (AutoRenew) : un nouveau certificat doit être déclaré dans l'app registration
      AVANT d'être utilisé, sinon l'authentification Graph échoue. Le coffre envoie une alerte aux contacts du coffre
      30 jours avant l'expiration ; le renouvellement se fait avec -Renew (voir docs/infra.md).
    - La clé publique est exportée dans un fichier .cer (PEM) à transmettre à la DSI SPIE pour
      New-SharePointAppRegistration.ps1 -CertificateFile. Ce fichier ne contient aucun secret.

    Idempotent : si le certificat existe et que -Renew n'est pas demandé, il est seulement réexporté.

.PARAMETER KeyVaultName
    Nom du Key Vault (sortie keyVaultName du déploiement Bicep).

.PARAMETER Environment
    recette ou production (sujet du certificat et nom du fichier exporté).

.PARAMETER CertificateName
    Nom du certificat dans le coffre. Contrat applicatif : graph-cert.

.PARAMETER ValidityMonths
    Durée de validité en mois (12 par défaut, 24 au maximum).

.PARAMETER Renew
    Crée une nouvelle version du certificat même s'il existe (rotation).

.PARAMETER OutputDirectory
    Dossier de destination du fichier .cer (dossier courant par défaut).

.EXAMPLE
    .\New-GraphCertificate.ps1 -KeyVaultName <nom-du-key-vault> -Environment recette

.EXAMPLE
    .\New-GraphCertificate.ps1 -KeyVaultName <nom-du-key-vault> -Environment production -ValidityMonths 24 -Renew
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)][string] $KeyVaultName,
    [Parameter(Mandatory = $true)][ValidateSet('recette', 'production')][string] $Environment,
    [string] $CertificateName = 'graph-cert',
    [ValidateRange(1, 24)][int] $ValidityMonths = 12,
    [switch] $Renew,
    [string] $OutputDirectory = '.'
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'SpiePv.Commun.ps1')

$sujet = "CN=spie-pv-$Environment-sharepoint"

function Get-CertificatCoffre {
    $r = Invoke-AzCli -AllowFailure -Arguments @(
        'keyvault', 'certificate', 'show',
        '--vault-name', $KeyVaultName,
        '--name', $CertificateName,
        '--query', '{thumbprint: x509ThumbprintHex, expires: attributes.expires, enabled: attributes.enabled, contentType: policy.secretProperties.contentType, subject: policy.x509CertificateProperties.subject}',
        '--output', 'json'
    )
    if ($r.ExitCode -eq 0 -and -not [string]::IsNullOrWhiteSpace($r.Output)) {
        return ConvertFrom-Json -InputObject $r.Output
    }
    if ((Get-StatutHttp $r.ErrorText) -eq 403) {
        throw "Accès refusé au Key Vault $KeyVaultName : le rôle « Key Vault Certificates Officer » est nécessaire (paramètre keyVaultOperators du Bicep)."
    }
    if ($r.ErrorText -notmatch 'NotFound|not found|CertificateNotFound') {
        throw "Lecture du certificat impossible : $($r.ErrorText)"
    }
    return $null
}

Write-Etape 'Connexion Azure CLI'
Assert-AzConnecte | Out-Null

Write-Etape "Certificat « $CertificateName » dans le Key Vault « $KeyVaultName »"
$certificat = Get-CertificatCoffre

if ($certificat -and -not $Renew) {
    Write-Ok ("Existe déjà (empreinte {0}, expire le {1})" -f $certificat.thumbprint, $certificat.expires)
    if ($certificat.contentType -ne 'application/x-pem-file') {
        Write-Attention ("Type de contenu « {0} » : l'application attend un PEM (application/x-pem-file). Recréez le certificat avec -Renew." -f $certificat.contentType)
    }
}
else {
    $action = $(if ($certificat) { 'Créer une nouvelle version (rotation)' } else { 'Créer le certificat auto-signé' })
    if (-not $PSCmdlet.ShouldProcess("$KeyVaultName/$CertificateName", $action)) {
        Write-Info 'Simulation (-WhatIf) : aucun certificat créé.'
        return
    }

    $politique = [ordered]@{
        issuerParameters          = [ordered]@{ name = 'Self' }
        keyProperties             = [ordered]@{
            exportable = $true
            keyType    = 'RSA'
            keySize    = 2048
            reuseKey   = $false
        }
        secretProperties          = [ordered]@{ contentType = 'application/x-pem-file' }
        x509CertificateProperties = [ordered]@{
            subject          = $sujet
            keyUsage         = @('digitalSignature', 'keyEncipherment')
            ekus             = @('1.3.6.1.5.5.7.3.2')
            validityInMonths = $ValidityMonths
        }
        lifetimeActions           = @(
            [ordered]@{
                trigger = [ordered]@{ daysBeforeExpiry = 30 }
                action  = [ordered]@{ actionType = 'EmailContacts' }
            }
        )
    }

    $fichierPolitique = [System.IO.Path]::GetTempFileName()
    try {
        $json = ConvertTo-Json -InputObject $politique -Depth 10
        [System.IO.File]::WriteAllText($fichierPolitique, $json, (New-Object System.Text.UTF8Encoding($false)))
        Invoke-AzCli -Arguments @(
            'keyvault', 'certificate', 'create',
            '--vault-name', $KeyVaultName,
            '--name', $CertificateName,
            '--policy', "@$fichierPolitique",
            '--output', 'none'
        ) | Out-Null
    }
    finally {
        Remove-Item -LiteralPath $fichierPolitique -Force -ErrorAction SilentlyContinue
    }

    # La création est asynchrone côté Key Vault : on attend que la nouvelle version soit émise.
    $empreintePrecedente = $(if ($certificat) { $certificat.thumbprint } else { '' })
    $certificat = $null
    for ($i = 0; $i -lt 30; $i++) {
        $candidat = Get-CertificatCoffre
        if ($candidat -and $candidat.thumbprint -and $candidat.thumbprint -ne $empreintePrecedente) {
            $certificat = $candidat
            break
        }
        Start-Sleep -Seconds 2
    }
    if (-not $certificat) {
        throw "Le certificat n'est pas disponible après 60 s. Vérifiez : az keyvault certificate pending show --vault-name $KeyVaultName --name $CertificateName"
    }
    Write-Ok ("Certificat créé (empreinte {0}, expire le {1})" -f $certificat.thumbprint, $certificat.expires)
}

Write-Etape 'Export de la clé publique (à transmettre à la DSI SPIE)'
if ($WhatIfPreference) {
    Write-Info 'Simulation (-WhatIf) : pas d''export.'
    return
}
$dossier = (Resolve-Path -LiteralPath $OutputDirectory).ProviderPath
$fichierCer = Join-Path $dossier ("spie-pv-{0}-sharepoint.cer" -f $Environment)
if (Test-Path -LiteralPath $fichierCer) { Remove-Item -LiteralPath $fichierCer -Force }
Invoke-AzCli -Arguments @(
    'keyvault', 'certificate', 'download',
    '--vault-name', $KeyVaultName,
    '--name', $CertificateName,
    '--file', $fichierCer,
    '--encoding', 'PEM',
    '--output', 'none'
) | Out-Null

$contenu = [System.IO.File]::ReadAllText($fichierCer)
if ($contenu -match 'PRIVATE KEY') {
    Remove-Item -LiteralPath $fichierCer -Force
    throw 'Le fichier exporté contient une clé privée : export annulé et fichier supprimé.'
}
Write-Ok "Clé publique exportée : $fichierCer"

Write-Etape 'Suite'
Write-Info ("Empreinte SHA-1 : {0}" -f $certificat.thumbprint)
Write-Info ("Expiration      : {0}" -f $certificat.expires)
Write-Info 'Transmettre le fichier .cer à la DSI SPIE (docs/sharepoint-dsi.md). Il ne contient aucun secret.'
Write-Info 'Après une rotation (-Renew) : attendre que la DSI ait ajouté la nouvelle clé publique à l''app registration,'
Write-Info 'puis redémarrer les révisions de l''API et du worker pour qu''elles relisent GRAPH_CERT_PEM.'
