# stop-service.ps1
# Stop the Log-Dot-Print Windows service.
# Requires administrator privileges.

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
$ServiceName = "LogDotPrint"

# --- Administrator privilege check ---
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Administrator privileges required. Restarting as administrator..." -ForegroundColor Yellow
    Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    exit
}

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $service) {
    Write-Error "Service '$ServiceName' not found."
    exit 1
}

if ($service.Status -eq 'Stopped') {
    Write-Host "Service is already stopped." -ForegroundColor Yellow
    return
}

Write-Host "Stopping service '$ServiceName'..." -ForegroundColor Yellow
Stop-Service -Name $ServiceName
Write-Host "  OK: Service stopped" -ForegroundColor Green
