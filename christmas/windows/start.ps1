# Startet die Fotobooth unter Windows mit dem PHP-Entwicklungsserver und öffnet Chrome.
# Aufruf:  powershell -ExecutionPolicy Bypass -File christmas\windows\start.ps1 [-Kiosk] [-Port 8000]
# Der PHP-Entwicklungsserver ist unter Windows einfädig und nur für Tests gedacht. Für den Abend ist ein Webserver
# wie Apache oder Nginx vorzuziehen.

param(
    [switch]$Kiosk,
    [int]$Port = 8000
)

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..\..')
$env:PHPRC = Join-Path $PWD 'christmas\windows'

if (-not (Test-Path (Join-Path $env:PHPRC 'php.ini'))) {
    Write-Host 'Bitte zuerst christmas\windows\setup.ps1 ausführen.' -ForegroundColor Red
    exit 1
}

$address = "http://localhost:$Port"
$arguments = @($address)
if ($Kiosk) { $arguments = @('--kiosk', $address) }
Start-Process -FilePath 'chrome' -ArgumentList $arguments

Write-Host "Photobooth läuft auf $address. Beenden mit Strg+C." -ForegroundColor Green
& php -S "localhost:$Port" -t .
