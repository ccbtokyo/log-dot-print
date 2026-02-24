# watchdog.ps1
# Health check watchdog for Log-Dot-Print.
# Called every 5 minutes by Windows Task Scheduler.

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
$ProjectRoot = Resolve-Path "$PSScriptRoot\..\..\.."
$ServiceName = "LogDotPrint"

$logsDir = Join-Path $ProjectRoot "logs"
if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir | Out-Null }
$logFile = Join-Path $logsDir "watchdog.log"

# Consecutive failure counter file
$counterFile = Join-Path $logsDir "watchdog-failures.txt"

function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $entry = "[$timestamp] $Message"
    Add-Content -Path $logFile -Value $entry -Encoding UTF8

    # Trim log to last 1000 lines to prevent unbounded growth
    $lineCount = (Get-Content $logFile -ErrorAction SilentlyContinue | Measure-Object -Line).Lines
    if ($lineCount -gt 1000) {
        $content = Get-Content $logFile -Tail 500
        Set-Content -Path $logFile -Value $content -Encoding UTF8
    }
}

function Get-FailureCount {
    if (Test-Path $counterFile) {
        $val = Get-Content $counterFile -Raw
        return [int]$val
    }
    return 0
}

function Set-FailureCount {
    param([int]$Count)
    Set-Content -Path $counterFile -Value $Count
}

# 1. Check service status
$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $service) {
    Write-Log "ERROR: Service '$ServiceName' not found."
    exit 1
}

if ($service.Status -ne 'Running') {
    Write-Log "WARN: Service is $($service.Status). Starting..."
    try {
        Start-Service -Name $ServiceName
        Start-Sleep -Seconds 5
        $service = Get-Service -Name $ServiceName
        if ($service.Status -eq 'Running') {
            Write-Log "OK: Service restarted successfully."
            Set-FailureCount 0
        } else {
            Write-Log "ERROR: Failed to start service. Status: $($service.Status)"
        }
    } catch {
        Write-Log "ERROR: Could not start service: $_"
    }
    exit
}

# 2. Health check (service is running)
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
        Write-Log "OK: Health check passed (port $port)."
        Set-FailureCount 0
        exit
    }
    Write-Log "WARN: Health check returned $($response.StatusCode)."
} catch {
    Write-Log "WARN: Health check failed: $_"
}

# 3. Handle failure
$failures = (Get-FailureCount) + 1
Set-FailureCount $failures
Write-Log "Consecutive failures: $failures"

if ($failures -ge 3) {
    Write-Log "CRITICAL: 3 consecutive failures. Restarting service..."
    try {
        Restart-Service -Name $ServiceName
        Start-Sleep -Seconds 5
        $service = Get-Service -Name $ServiceName
        if ($service.Status -eq 'Running') {
            Write-Log "OK: Service restarted after 3 failures."
            Set-FailureCount 0
        } else {
            Write-Log "ERROR: Service restart failed. Status: $($service.Status)"
        }
    } catch {
        Write-Log "ERROR: Could not restart service: $_"
    }
}
