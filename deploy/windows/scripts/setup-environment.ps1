# setup-environment.ps1
# Initial environment setup for Log-Dot-Print on Windows.
# Does not require administrator privileges.

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
$ProjectRoot = Resolve-Path "$PSScriptRoot\..\..\.."

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Log-Dot-Print Environment Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. PowerShell version check
Write-Host "[1/8] PowerShell version check..." -ForegroundColor Yellow
$psVersion = $PSVersionTable.PSVersion
if ($psVersion.Major -lt 5 -or ($psVersion.Major -eq 5 -and $psVersion.Minor -lt 1)) {
    Write-Error "PowerShell 5.1 or later is required. Current: $psVersion"
    exit 1
}
Write-Host "  OK: PowerShell $psVersion" -ForegroundColor Green

# 2. Bun installation check
Write-Host "[2/8] Bun installation check..." -ForegroundColor Yellow
$bunPath = Get-Command bun -ErrorAction SilentlyContinue
if ($bunPath) {
    $bunVersion = & bun --version
    Write-Host "  OK: Bun $bunVersion ($($bunPath.Source))" -ForegroundColor Green
} else {
    Write-Host "  Bun not found. Installing..." -ForegroundColor Yellow
    irm bun.sh/install.ps1 | iex
    $bunPath = Get-Command bun -ErrorAction SilentlyContinue
    if (-not $bunPath) {
        Write-Error "Bun installation failed. Please install manually: https://bun.sh"
        exit 1
    }
    $bunVersion = & bun --version
    Write-Host "  OK: Bun $bunVersion installed" -ForegroundColor Green
}

# 3. Node.js check (required for Playwright subprocess)
Write-Host "[3/8] Node.js check (for Playwright)..." -ForegroundColor Yellow
$nodePath = Get-Command node -ErrorAction SilentlyContinue
if ($nodePath) {
    $nodeVersion = & node --version
    Write-Host "  OK: Node.js $nodeVersion" -ForegroundColor Green
} else {
    Write-Host "  WARNING: Node.js not found." -ForegroundColor Red
    Write-Host "  Node.js is required for Playwright. Install via:" -ForegroundColor Red
    Write-Host "    winget install OpenJS.NodeJS.LTS" -ForegroundColor White
    Write-Host "  Then re-run this script." -ForegroundColor Red
}

# 4. Install dependencies
Write-Host "[4/8] Installing dependencies..." -ForegroundColor Yellow
Push-Location $ProjectRoot
try {
    & bun install
    Write-Host "  OK: Dependencies installed" -ForegroundColor Green
} finally {
    Pop-Location
}

# 5. Install Playwright Chromium
Write-Host "[5/8] Installing Playwright Chromium..." -ForegroundColor Yellow
Push-Location $ProjectRoot
try {
    & bunx playwright install chromium
    Write-Host "  OK: Playwright Chromium installed" -ForegroundColor Green
} finally {
    Pop-Location
}

# 6. Create runtime directories
Write-Host "[6/8] Creating runtime directories..." -ForegroundColor Yellow
$dataDir = Join-Path $ProjectRoot "data"
$logsDir = Join-Path $ProjectRoot "logs"
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }
if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir | Out-Null }
Write-Host "  OK: data/ and logs/ directories ready" -ForegroundColor Green

# 7. Printer check
Write-Host "[7/8] Checking available printers..." -ForegroundColor Yellow
try {
    $printers = Get-CimInstance Win32_Printer | Select-Object Name, DriverName, PortName
    if ($printers) {
        foreach ($p in $printers) {
            Write-Host "  - $($p.Name) (Driver: $($p.DriverName))" -ForegroundColor White
        }
    } else {
        Write-Host "  WARNING: No printers found" -ForegroundColor Red
    }
} catch {
    Write-Host "  WARNING: Could not query printers: $_" -ForegroundColor Red
}

# 8. Config file check
Write-Host "[8/8] Checking configuration..." -ForegroundColor Yellow
$configPath = Join-Path $ProjectRoot "config.json"
$configExamplePath = Join-Path $ProjectRoot "config.example.json"
if (Test-Path $configPath) {
    Write-Host "  OK: config.json exists" -ForegroundColor Green
} elseif (Test-Path $configExamplePath) {
    Copy-Item $configExamplePath $configPath
    Write-Host "  OK: config.json created from config.example.json" -ForegroundColor Green
    Write-Host "  Please edit config.json to match your environment." -ForegroundColor Yellow
} else {
    Write-Host "  WARNING: Neither config.json nor config.example.json found" -ForegroundColor Red
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Setup complete!" -ForegroundColor Green
Write-Host " Next: Run build-production.ps1" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
