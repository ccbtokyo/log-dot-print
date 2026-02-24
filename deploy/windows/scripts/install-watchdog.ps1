# install-watchdog.ps1
# Register the watchdog as a Windows Scheduled Task (5-minute interval).
# Requires administrator privileges.

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
$TaskName = "LogDotPrint-Watchdog"

# --- Administrator privilege check ---
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Administrator privileges required. Restarting as administrator..." -ForegroundColor Yellow
    Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    exit
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Log-Dot-Print Watchdog Installation" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Remove existing task if present
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Removing existing watchdog task..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$watchdogScript = Join-Path $PSScriptRoot "watchdog.ps1"
if (-not (Test-Path $watchdogScript)) {
    Write-Error "watchdog.ps1 not found at: $watchdogScript"
    exit 1
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$watchdogScript`""

$trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Minutes 5) `
    -Once -At (Get-Date)

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopOnIdleEnd `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

Register-ScheduledTask -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -RunLevel Highest `
    -User "SYSTEM" `
    -Description "Log-Dot-Print health check watchdog (5-min interval)" | Out-Null

Write-Host "  OK: Watchdog scheduled task registered" -ForegroundColor Green
Write-Host "  Task: $TaskName" -ForegroundColor White
Write-Host "  Interval: 5 minutes" -ForegroundColor White
Write-Host "  User: SYSTEM" -ForegroundColor White
