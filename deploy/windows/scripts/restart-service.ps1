# restart-service.ps1
# Restart the Log-Dot-Print Windows service.
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

Write-Host "Restarting service '$ServiceName'..." -ForegroundColor Yellow

# Stop
& "$PSScriptRoot\stop-service.ps1"
Write-Host "Waiting 3 seconds..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

# Start
& "$PSScriptRoot\start-service.ps1"
