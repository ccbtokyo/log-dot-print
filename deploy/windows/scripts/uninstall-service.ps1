# uninstall-service.ps1
# Uninstall the Log-Dot-Print Windows service.
# Requires administrator privileges.

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
$WinswDir = Join-Path $PSScriptRoot "..\winsw"
$ServiceName = "LogDotPrint"
$ServiceExe = Join-Path $WinswDir "log-dot-print-service.exe"

# --- Administrator privilege check ---
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Administrator privileges required. Restarting as administrator..." -ForegroundColor Yellow
    Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    exit
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Log-Dot-Print Service Uninstall" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Stop service if running
$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($service) {
    if ($service.Status -eq 'Running') {
        Write-Host "Stopping service..." -ForegroundColor Yellow
        Stop-Service -Name $ServiceName
        Start-Sleep -Seconds 3
        Write-Host "  OK: Service stopped" -ForegroundColor Green
    }

    # 2. Uninstall service
    Write-Host "Uninstalling service..." -ForegroundColor Yellow
    if (Test-Path $ServiceExe) {
        Push-Location $WinswDir
        try {
            & $ServiceExe uninstall
        } finally {
            Pop-Location
        }
    } else {
        # Fallback: use sc.exe directly
        & sc.exe delete $ServiceName
    }
    Write-Host "  OK: Service uninstalled" -ForegroundColor Green
} else {
    Write-Host "Service '$ServiceName' not found. Nothing to uninstall." -ForegroundColor Yellow
}

# 3. Remove firewall rule
Write-Host "Removing firewall rule..." -ForegroundColor Yellow
$rule = Get-NetFirewallRule -DisplayName "Log-Dot-Print" -ErrorAction SilentlyContinue
if ($rule) {
    Remove-NetFirewallRule -DisplayName "Log-Dot-Print"
    Write-Host "  OK: Firewall rule removed" -ForegroundColor Green
} else {
    Write-Host "  No firewall rule found" -ForegroundColor Yellow
}

# 4. Offer to remove watchdog
$watchdogTask = Get-ScheduledTask -TaskName "LogDotPrint-Watchdog" -ErrorAction SilentlyContinue
if ($watchdogTask) {
    $confirm = Read-Host "Remove watchdog scheduled task as well? (y/N)"
    if ($confirm -eq 'y') {
        Unregister-ScheduledTask -TaskName "LogDotPrint-Watchdog" -Confirm:$false
        Write-Host "  OK: Watchdog task removed" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Uninstall complete" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
