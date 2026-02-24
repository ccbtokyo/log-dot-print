# status-service.ps1
# Display diagnostic information for the Log-Dot-Print service.
# Does not require administrator privileges.

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
$ProjectRoot = Resolve-Path "$PSScriptRoot\..\..\.."
$ServiceName = "LogDotPrint"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Log-Dot-Print Status" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Service status
Write-Host "[Service]" -ForegroundColor Yellow
$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($service) {
    $color = switch ($service.Status) {
        'Running' { 'Green' }
        'Stopped' { 'Red' }
        default   { 'Yellow' }
    }
    Write-Host "  Status: $($service.Status)" -ForegroundColor $color
    Write-Host "  StartType: $($service.StartType)" -ForegroundColor White
} else {
    Write-Host "  Service not installed" -ForegroundColor Red
}

# 2. Health check
Write-Host ""
Write-Host "[Health Check]" -ForegroundColor Yellow
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
    Write-Host "  http://localhost:$port/api/health -> $($response.StatusCode)" -ForegroundColor Green
    Write-Host "  $($response.Content)" -ForegroundColor White
} catch {
    Write-Host "  http://localhost:$port/api/health -> FAILED" -ForegroundColor Red
    Write-Host "  $_" -ForegroundColor Red
}

# 3. Recent logs
Write-Host ""
Write-Host "[Recent Logs (last 20 lines)]" -ForegroundColor Yellow
$logsDir = Join-Path $ProjectRoot "logs"
if (Test-Path $logsDir) {
    $logFiles = Get-ChildItem $logsDir -Filter "*.log" | Sort-Object LastWriteTime -Descending
    if ($logFiles) {
        $latestLog = $logFiles[0]
        Write-Host "  File: $($latestLog.Name)" -ForegroundColor White
        Get-Content $latestLog.FullName -Tail 20 | ForEach-Object { Write-Host "  $_" }
    } else {
        Write-Host "  No log files found" -ForegroundColor Yellow
    }
} else {
    Write-Host "  logs/ directory not found" -ForegroundColor Yellow
}

# 4. Printer status
Write-Host ""
Write-Host "[Printers]" -ForegroundColor Yellow
try {
    $printers = Get-CimInstance Win32_Printer | Select-Object Name, PrinterStatus, WorkOffline
    foreach ($p in $printers) {
        $statusText = switch ($p.PrinterStatus) {
            1 { "Other" }
            2 { "Unknown" }
            3 { "Idle" }
            4 { "Printing" }
            5 { "Warmup" }
            6 { "Stopped" }
            7 { "Offline" }
            default { "Status=$($p.PrinterStatus)" }
        }
        $offlineTag = if ($p.WorkOffline) { " [OFFLINE]" } else { "" }
        Write-Host "  $($p.Name): $statusText$offlineTag" -ForegroundColor White
    }
} catch {
    Write-Host "  Could not query printers: $_" -ForegroundColor Red
}

# 5. Disk usage
Write-Host ""
Write-Host "[Disk Usage]" -ForegroundColor Yellow
$dataDir = Join-Path $ProjectRoot "data"
if (Test-Path $dataDir) {
    $dataSize = (Get-ChildItem $dataDir -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
    $dataSizeMB = [math]::Round(($dataSize / 1MB), 2)
    Write-Host "  data/: $dataSizeMB MB" -ForegroundColor White
} else {
    Write-Host "  data/: (not found)" -ForegroundColor Yellow
}

if (Test-Path $logsDir) {
    $logsSize = (Get-ChildItem $logsDir -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
    $logsSizeMB = [math]::Round(($logsSize / 1MB), 2)
    Write-Host "  logs/: $logsSizeMB MB" -ForegroundColor White
}

# 6. Process memory
Write-Host ""
Write-Host "[Process Memory]" -ForegroundColor Yellow
$bunProcesses = Get-Process -Name "bun" -ErrorAction SilentlyContinue
if ($bunProcesses) {
    foreach ($proc in $bunProcesses) {
        $memMB = [math]::Round(($proc.WorkingSet64 / 1MB), 1)
        Write-Host "  PID $($proc.Id): $memMB MB (Working Set)" -ForegroundColor White
    }
} else {
    Write-Host "  No bun processes found" -ForegroundColor Yellow
}

# 7. Watchdog status
Write-Host ""
Write-Host "[Watchdog]" -ForegroundColor Yellow
$watchdogTask = Get-ScheduledTask -TaskName "LogDotPrint-Watchdog" -ErrorAction SilentlyContinue
if ($watchdogTask) {
    Write-Host "  Scheduled Task: $($watchdogTask.State)" -ForegroundColor White
    $watchdogLog = Join-Path $logsDir "watchdog.log"
    if (Test-Path $watchdogLog) {
        $lastLine = Get-Content $watchdogLog -Tail 1
        Write-Host "  Last entry: $lastLine" -ForegroundColor White
    }
} else {
    Write-Host "  Watchdog not installed" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
