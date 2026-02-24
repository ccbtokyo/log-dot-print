# disable-service.ps1
# Disable automatic startup for the Log-Dot-Print service.
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

Set-Service -Name $ServiceName -StartupType Disabled
Write-Host "Service '$ServiceName' set to Disabled." -ForegroundColor Green
