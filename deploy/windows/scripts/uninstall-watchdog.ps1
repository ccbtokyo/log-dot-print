# uninstall-watchdog.ps1
# Remove the watchdog scheduled task.
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

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Watchdog task '$TaskName' removed." -ForegroundColor Green
} else {
    Write-Host "Watchdog task '$TaskName' not found. Nothing to remove." -ForegroundColor Yellow
}
