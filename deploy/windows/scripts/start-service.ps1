# start-service.ps1
# Start the Log-Dot-Print Windows service.
# Requires administrator privileges.

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
$ProjectRoot = Resolve-Path "$PSScriptRoot\..\..\.."
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
    Write-Error "Service '$ServiceName' not found. Run install-service.ps1 first."
    exit 1
}

if ($service.Status -eq 'Running') {
    Write-Host "Service is already running." -ForegroundColor Yellow
    exit 0
}

Write-Host "Starting service '$ServiceName'..." -ForegroundColor Yellow
Start-Service -Name $ServiceName
Write-Host "  OK: Service started" -ForegroundColor Green

# Health check after startup
Write-Host "Waiting 5 seconds for startup..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

$port = 3000
$configPath = Join-Path $ProjectRoot "config.json"
if (Test-Path $configPath) {
    try {
        $config = Get-Content $configPath -Raw | ConvertFrom-Json
        if ($config.server.port) { $port = $config.server.port }
    } catch {}
}

try {
    $response = Invoke-WebRequest -Uri "http://localhost:$port/api/health" -UseBasicParsing -TimeoutSec 10
    if ($response.StatusCode -eq 200) {
        Write-Host "  OK: Health check passed (port $port)" -ForegroundColor Green
    } else {
        Write-Host "  WARNING: Health check returned status $($response.StatusCode)" -ForegroundColor Red
    }
} catch {
    Write-Host "  WARNING: Health check failed: $_" -ForegroundColor Red
    Write-Host "  The service may still be starting up. Check status-service.ps1" -ForegroundColor Yellow
}
