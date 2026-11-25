# Richtet die Fotobooth für einen Test unter Windows ein (PHP-Entwicklungsserver, kein Apache).
# Voraussetzungen, die vorher installiert sein müssen:
#   PHP 8.4 (x64, Non Thread Safe) von https://windows.php.net/download, entpackt und im PATH
#   Composer von https://getcomposer.org/download/
#   Node.js 22 von https://nodejs.org/
#   Google Chrome
# Aufruf in PowerShell aus dem Projektordner:  powershell -ExecutionPolicy Bypass -File christmas\windows\setup.ps1

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..\..')

function Test-Tool([string]$Name, [string]$Hint) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        Write-Host "$Name fehlt. $Hint" -ForegroundColor Red
        return $false
    }
    return $true
}

$ready = $true
$ready = (Test-Tool 'php' 'PHP 8.4 installieren und zum PATH hinzufügen.') -and $ready
$ready = (Test-Tool 'composer' 'Composer installieren.') -and $ready
$ready = (Test-Tool 'node' 'Node.js 22 installieren.') -and $ready
if (-not $ready) { exit 1 }

$phpVersion = [version](& php -r 'echo PHP_VERSION;')
if ($phpVersion -lt [version]'8.4.1') {
    Write-Host "PHP $phpVersion ist zu alt, benötigt wird mindestens 8.4.1." -ForegroundColor Red
    exit 1
}
$nodeMajor = [int](& node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 20) {
    Write-Host "Node.js $nodeMajor ist zu alt, benötigt wird mindestens 20, empfohlen 22." -ForegroundColor Red
    exit 1
}

# Eine eigene php.ini, damit die benötigten Erweiterungen aktiv sind, ohne die Installation zu verändern.
$phpDirectory = Split-Path (Get-Command php).Source
$iniDirectory = Join-Path $PWD 'christmas\windows'

# PHP unter Windows bringt keine Zertifikate mit. Ohne sie scheitert der HTTPS-Upload in den Cloud-Speicher.
$certificates = Join-Path $iniDirectory 'cacert.pem'
if (-not (Test-Path $certificates)) {
    Write-Host 'Lade das Zertifikatspaket von curl.se ...'
    Invoke-WebRequest -Uri 'https://curl.se/ca/cacert.pem' -OutFile $certificates
}
$ini = @"
extension_dir="$phpDirectory\ext"
extension=curl
extension=exif
extension=fileinfo
extension=gd
extension=intl
extension=mbstring
extension=openssl
extension=zip
date.timezone=Europe/Berlin
upload_max_filesize=64M
post_max_size=72M
memory_limit=512M
curl.cainfo="$certificates"
openssl.cafile="$certificates"
"@
Set-Content -Path (Join-Path $iniDirectory 'php.ini') -Value $ini -Encoding ASCII
$env:PHPRC = $iniDirectory

Write-Host 'Prüfe PHP-Erweiterungen ...'
foreach ($extension in 'gd', 'mbstring', 'fileinfo', 'curl', 'openssl', 'zip', 'intl', 'exif') {
    if (-not (& php -m | Select-String -SimpleMatch -Quiet $extension)) {
        Write-Host "Erweiterung $extension fehlt. Liegt php_$extension.dll im Ordner $phpDirectory\ext?" -ForegroundColor Red
        exit 1
    }
}

Write-Host 'Installiere PHP-Abhängigkeiten ...'
& composer install --no-dev --no-interaction
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host 'Installiere Frontend-Abhängigkeiten und baue die Oberfläche ...'
& npm ci
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& npx gulp
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

New-Item -ItemType Directory -Force -Path 'config' | Out-Null
if (-not (Test-Path 'config\my.config.inc.php')) {
    Copy-Item 'christmas\config\my.config.inc.php.example' 'config\my.config.inc.php'
    Write-Host 'Konfiguration aus der Vorlage angelegt. Das Passwort für Galerie und Diashow ist noch leer und wird im Admin-Bereich unter http://localhost:8000/admin gesetzt.' -ForegroundColor Yellow
}
New-Item -ItemType File -Force -Path 'welcome\.skip_welcome' | Out-Null

Write-Host 'Fertig. Starten mit  powershell -ExecutionPolicy Bypass -File christmas\windows\start.ps1' -ForegroundColor Green
