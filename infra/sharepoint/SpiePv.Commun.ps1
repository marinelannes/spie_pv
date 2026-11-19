# Fonctions communes aux scripts d'exploitation spie-pv (chargées par « dot-sourcing »).
# Compatibles Windows PowerShell 5.1 et PowerShell 7. Prérequis : Azure CLI 2.67 ou plus récent (commande « az »).
#
# Précautions propres à Windows : « az » est un fichier .cmd, interprété par cmd.exe. On évite donc de passer en
# argument des caractères & | < > ^ hors guillemets (pas de requête OData à plusieurs paramètres dans les URL), et
# les corps JSON sont toujours transmis par fichier (--body @fichier), jamais en ligne de commande.

$script:GraphAppId = '00000003-0000-0000-c000-000000000000'
$script:SitesSelectedRoleIdAttendu = '883ea226-0bf2-4a8f-9f9d-92c9162a727d'
$script:GraphBaseUrl = 'https://graph.microsoft.com/v1.0'

function Write-Etape {
    param([string] $Message)
    Write-Host ''
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Info {
    param([string] $Message)
    Write-Host "    $Message"
}

function Write-Ok {
    param([string] $Message)
    Write-Host "    [OK] $Message" -ForegroundColor Green
}

function Write-Attention {
    param([string] $Message)
    Write-Host "    [ATTENTION] $Message" -ForegroundColor Yellow
}

function Write-Echec {
    param([string] $Message)
    Write-Host "    [ECHEC] $Message" -ForegroundColor Red
}

function Split-Lignes {
    # Découpe une sortie texte (az ... --output tsv) en tableau de lignes non vides.
    param([string] $Texte)
    if ([string]::IsNullOrWhiteSpace($Texte)) { return @() }
    return @($Texte -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

function Invoke-AzCli {
    # Exécute Azure CLI et renvoie { ExitCode, Output, ErrorText }.
    # Lève une exception si le code de retour est non nul, sauf avec -AllowFailure.
    # Les messages d'erreur ne reprennent que les premiers mots de la commande (jamais de valeur sensible).
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string[]] $Arguments,
        [switch] $AllowFailure
    )

    $preferencePrecedente = $ErrorActionPreference
    # Windows PowerShell 5.1 transforme chaque ligne de stderr en erreur : on les collecte sans interrompre le script.
    $ErrorActionPreference = 'Continue'
    try {
        $brut = & az @Arguments --only-show-errors 2>&1
        $codeRetour = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $preferencePrecedente
    }

    $sortie = New-Object System.Collections.Generic.List[string]
    $erreurs = New-Object System.Collections.Generic.List[string]
    foreach ($ligne in @($brut)) {
        if ($null -eq $ligne) { continue }
        if ($ligne -is [System.Management.Automation.ErrorRecord]) { $erreurs.Add($ligne.ToString()) }
        else { $sortie.Add([string] $ligne) }
    }

    $resultat = [pscustomobject]@{
        ExitCode  = $codeRetour
        Output    = ($sortie -join "`n").Trim()
        ErrorText = ($erreurs -join "`n").Trim()
    }

    if ($codeRetour -ne 0 -and -not $AllowFailure) {
        $commande = ($Arguments | Select-Object -First 3) -join ' '
        throw ("Échec de « az {0} » (code {1}) : {2}" -f $commande, $codeRetour, $resultat.ErrorText)
    }
    return $resultat
}

function Invoke-AvecReessai {
    # Relance un bloc en cas d'échec (délais de réplication d'Entra ID juste après une création).
    param(
        [Parameter(Mandatory = $true)][scriptblock] $Bloc,
        [int] $Tentatives = 6,
        [int] $DelaiSecondes = 10,
        [string] $Description = 'opération'
    )
    for ($i = 1; $i -le $Tentatives; $i++) {
        try {
            return & $Bloc
        }
        catch {
            if ($i -eq $Tentatives) { throw }
            Write-Info ("{0} : nouvel essai dans {1} s ({2}/{3})..." -f $Description, $DelaiSecondes, $i, $Tentatives)
            Start-Sleep -Seconds $DelaiSecondes
        }
    }
}

function Assert-AzCliDisponible {
    if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
        throw 'Azure CLI (az) est introuvable. Installation : https://learn.microsoft.com/cli/azure/install-azure-cli'
    }
}

function Assert-AzConnecte {
    # Vérifie la session Azure CLI et, si demandé, le tenant. Renvoie { tenantId, user }.
    param([string] $TenantId)
    Assert-AzCliDisponible
    $r = Invoke-AzCli -Arguments @('account', 'show', '--query', '{tenantId: tenantId, user: user.name}', '--output', 'json') -AllowFailure
    if ($r.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($r.Output)) {
        throw 'Azure CLI n''est pas connecté. Exécutez : az login --tenant <tenant-id> --allow-no-subscriptions'
    }
    $compte = ConvertFrom-Json -InputObject $r.Output
    if ($TenantId -and ($compte.tenantId -ne $TenantId)) {
        throw ("Azure CLI est connecté au tenant {0}, et non au tenant attendu {1}. Exécutez : az login --tenant {1} --allow-no-subscriptions" -f $compte.tenantId, $TenantId)
    }
    Write-Ok ("Connecté en tant que {0} (tenant {1})" -f $compte.user, $compte.tenantId)
    return $compte
}

function Get-StatutHttp {
    # Déduit le statut HTTP d'un message d'erreur « az rest » ou Microsoft Graph PowerShell (0 si inconnu).
    param([string] $Texte)
    if ([string]::IsNullOrWhiteSpace($Texte)) { return 0 }
    if ($Texte -match 'Unauthorized|\b401\b|InvalidAuthenticationToken') { return 401 }
    if ($Texte -match 'Forbidden|\b403\b|accessDenied|Authorization_RequestDenied') { return 403 }
    if ($Texte -match 'Not Found|NotFound|\b404\b|itemNotFound') { return 404 }
    if ($Texte -match 'Conflict|\b409\b|nameAlreadyExists') { return 409 }
    return 0
}

function Invoke-GraphAzRest {
    # Appel Microsoft Graph via « az rest » (jeton de la session Azure CLI courante).
    #  -Body     : objet sérialisé en JSON (transmis par fichier temporaire) ;
    #  -BodyFile : fichier envoyé tel quel (dépôt de contenu).
    # Renvoie { Ok, Data, ErrorText, Status }.
    param(
        [Parameter(Mandatory = $true)][ValidateSet('GET', 'POST', 'PATCH', 'PUT', 'DELETE')][string] $Method,
        [Parameter(Mandatory = $true)][string] $Uri,
        $Body = $null,
        [string] $BodyFile,
        [string] $ContentType = 'application/json',
        [switch] $AllowFailure
    )

    $arguments = @('rest', '--method', $Method.ToLowerInvariant(), '--uri', $Uri)
    $fichierTemporaire = $null
    try {
        if ($null -ne $Body) {
            $fichierTemporaire = [System.IO.Path]::GetTempFileName()
            $json = ConvertTo-Json -InputObject $Body -Depth 10 -Compress
            [System.IO.File]::WriteAllText($fichierTemporaire, $json, (New-Object System.Text.UTF8Encoding($false)))
            $arguments += @('--body', "@$fichierTemporaire", '--headers', "Content-Type=$ContentType")
        }
        elseif ($BodyFile) {
            $arguments += @('--body', "@$BodyFile", '--headers', "Content-Type=$ContentType")
        }
        $r = Invoke-AzCli -Arguments $arguments -AllowFailure
    }
    finally {
        if ($fichierTemporaire) { Remove-Item -LiteralPath $fichierTemporaire -Force -ErrorAction SilentlyContinue }
    }

    $donnees = $null
    if ($r.ExitCode -eq 0 -and -not [string]::IsNullOrWhiteSpace($r.Output)) {
        $donnees = ConvertFrom-Json -InputObject $r.Output
    }
    if ($r.ExitCode -ne 0 -and -not $AllowFailure) {
        throw ("Graph {0} {1} : {2}" -f $Method, $Uri, $r.ErrorText)
    }
    return [pscustomobject]@{
        Ok        = ($r.ExitCode -eq 0)
        Data      = $donnees
        ErrorText = $r.ErrorText
        Status    = $(if ($r.ExitCode -eq 0) { 200 } else { Get-StatutHttp $r.ErrorText })
    }
}

function Get-SitesSelectedRoleId {
    # Id du rôle applicatif « Sites.Selected » lu sur le principal de service Microsoft Graph du tenant
    # (pas de GUID en dur ; on signale seulement un écart avec la valeur documentée).
    $r = Invoke-AzCli -Arguments @('ad', 'sp', 'show', '--id', $script:GraphAppId, '--query', "appRoles[?value=='Sites.Selected'].id", '--output', 'tsv')
    $id = Split-Lignes $r.Output | Select-Object -First 1
    if (-not $id) { throw 'Rôle applicatif « Sites.Selected » introuvable sur le principal de service Microsoft Graph.' }
    if ($id -ne $script:SitesSelectedRoleIdAttendu) {
        Write-Attention ("Id de Sites.Selected inattendu : {0} (documenté : {1}). L'id lu dans le tenant est utilisé." -f $id, $script:SitesSelectedRoleIdAttendu)
    }
    return $id
}

function ConvertTo-UrlSiteGraph {
    # https://<hote>/sites/<site>  ->  /sites/<hote>:/sites/<site>   (site racine : /sites/<hote>)
    param([Parameter(Mandatory = $true)][string] $SiteUrl)
    $uri = $null
    if (-not [System.Uri]::TryCreate($SiteUrl.Trim(), [System.UriKind]::Absolute, [ref] $uri) -or $uri.Scheme -ne 'https') {
        throw "URL de site invalide : « $SiteUrl ». Forme attendue : https://<tenant>.sharepoint.com/sites/<site>"
    }
    $chemin = $uri.AbsolutePath.TrimEnd('/')
    if ([string]::IsNullOrEmpty($chemin)) {
        return ('/sites/{0}' -f $uri.Host)
    }
    return ('/sites/{0}:{1}' -f $uri.Host, $chemin)
}

function Get-EmpreinteCertificat {
    # Renvoie { Hex, Base64 } de l'empreinte SHA-1 d'un certificat (format utilisé par Entra ID pour les clés).
    param([Parameter(Mandatory = $true)][string] $ThumbprintHex)
    $hex = $ThumbprintHex.Trim().ToUpperInvariant()
    $octets = New-Object byte[] ([int]($hex.Length / 2))
    for ($i = 0; $i -lt $octets.Length; $i++) {
        $octets[$i] = [Convert]::ToByte($hex.Substring($i * 2, 2), 16)
    }
    return [pscustomobject]@{
        Hex    = $hex
        Base64 = [Convert]::ToBase64String($octets)
    }
}
