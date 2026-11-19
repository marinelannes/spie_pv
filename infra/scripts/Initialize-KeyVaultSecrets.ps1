#Requires -Version 5.1
<#
.SYNOPSIS
    Initialise les secrets spie-pv qui ne sont pas gérés par le Bicep : « jwt-secret » et le certificat « graph-cert ».

.DESCRIPTION
    À exécuter une fois par environnement, après le premier déploiement du socle (Bicep sans imageTag) et AVANT le
    déploiement des Container Apps (elles référencent ces secrets et ne démarrent pas s'ils manquent).
    Rôles requis sur le Key Vault : « Key Vault Secrets Officer » et « Key Vault Certificates Officer »
    (paramètre keyVaultOperators du Bicep).

    - jwt-secret : 64 caractères hexadécimaux (256 bits) tirés d'un générateur cryptographique. Créé uniquement s'il
      n'existe pas (ou avec -RotateJwtSecret). La valeur n'est ni affichée, ni passée en ligne de commande (fichier
      temporaire supprimé aussitôt), ni stockée ailleurs que dans le coffre.
    - graph-cert : délégué à ..\sharepoint\New-GraphCertificate.ps1 (créé s'il n'existe pas, clé publique exportée).
    - database-url : écrit par le Bicep, rien à faire ici.

    Pourquoi pas dans le Bicep ? Un template ne sait pas « créer si absent » : une valeur générée (newGuid) changerait à
    chaque déploiement et invaliderait toutes les sessions ; un paramètre sécurisé obligerait à conserver le secret
    hors du coffre (GitHub) pour chaque redéploiement. Les certificats Key Vault n'ont pas de ressource ARM.

.PARAMETER KeyVaultName
    Nom du Key Vault (sortie keyVaultName du déploiement Bicep).

.PARAMETER Environment
    recette ou production.

.PARAMETER RotateJwtSecret
    Remplace jwt-secret par une nouvelle valeur. Les jetons d'accès en cours deviennent invalides ; redémarrer ensuite
    les révisions de l'API et du worker.

.PARAMETER SkipGraphCertificate
    Ne traite pas le certificat graph-cert.

.PARAMETER CertificateValidityMonths
    Validité du certificat graph-cert s'il est créé (12 par défaut, 24 au maximum).

.EXAMPLE
    .\infra\scripts\Initialize-KeyVaultSecrets.ps1 -KeyVaultName <nom-du-key-vault> -Environment recette
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)][string] $KeyVaultName,
    [Parameter(Mandatory = $true)][ValidateSet('recette', 'production')][string] $Environment,
    [switch] $RotateJwtSecret,
    [switch] $SkipGraphCertificate,
    [ValidateRange(1, 24)][int] $CertificateValidityMonths = 12
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\sharepoint\SpiePv.Commun.ps1')

Write-Etape 'Connexion Azure CLI'
Assert-AzConnecte | Out-Null

Write-Etape "Secret « jwt-secret » dans le Key Vault « $KeyVaultName »"
$existant = Invoke-AzCli -AllowFailure -Arguments @(
    'keyvault', 'secret', 'show',
    '--vault-name', $KeyVaultName,
    '--name', 'jwt-secret',
    '--query', 'id',
    '--output', 'tsv'
)
$secretPresent = ($existant.ExitCode -eq 0 -and -not [string]::IsNullOrWhiteSpace($existant.Output))
if (-not $secretPresent) {
    if ((Get-StatutHttp $existant.ErrorText) -eq 403) {
        throw "Accès refusé au Key Vault $KeyVaultName : le rôle « Key Vault Secrets Officer » est nécessaire (paramètre keyVaultOperators du Bicep)."
    }
    if ($existant.ErrorText -notmatch 'NotFound|not found|SecretNotFound') {
        throw "Lecture du secret impossible : $($existant.ErrorText)"
    }
}

if ($secretPresent -and -not $RotateJwtSecret) {
    Write-Ok 'Existe déjà : conservé (utiliser -RotateJwtSecret pour le remplacer).'
}
else {
    $action = $(if ($secretPresent) { 'Remplacer jwt-secret (rotation)' } else { 'Créer jwt-secret' })
    if ($PSCmdlet.ShouldProcess("$KeyVaultName/jwt-secret", $action)) {
        $octets = New-Object byte[] 32
        $generateur = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        try { $generateur.GetBytes($octets) } finally { $generateur.Dispose() }
        $valeur = -join ($octets | ForEach-Object { $_.ToString('x2') })

        $fichier = [System.IO.Path]::GetTempFileName()
        try {
            [System.IO.File]::WriteAllText($fichier, $valeur, (New-Object System.Text.UTF8Encoding($false)))
            Invoke-AzCli -Arguments @(
                'keyvault', 'secret', 'set',
                '--vault-name', $KeyVaultName,
                '--name', 'jwt-secret',
                '--file', $fichier,
                '--encoding', 'utf-8',
                '--content-type', 'text/plain',
                '--output', 'none'
            ) | Out-Null
        }
        finally {
            Remove-Item -LiteralPath $fichier -Force -ErrorAction SilentlyContinue
            $valeur = $null
        }
        Write-Ok 'jwt-secret écrit dans le coffre (valeur non affichée).'
        if ($secretPresent) {
            Write-Attention 'Rotation : redémarrer les révisions de l''API et du worker pour appliquer la nouvelle valeur.'
        }
    }
}

if (-not $SkipGraphCertificate) {
    $scriptCertificat = Join-Path $PSScriptRoot '..\sharepoint\New-GraphCertificate.ps1'
    & $scriptCertificat -KeyVaultName $KeyVaultName -Environment $Environment -ValidityMonths $CertificateValidityMonths -WhatIf:$WhatIfPreference
}

Write-Etape 'Terminé'
Write-Info 'Les Container Apps peuvent maintenant être déployées (Bicep avec IMAGE_TAG renseigné), voir docs/infra.md.'
