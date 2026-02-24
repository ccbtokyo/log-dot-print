# build-production.ps1
# Build Log-Dot-Print for production deployment.
# Does not require administrator privileges.

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
$ProjectRoot = Resolve-Path "$PSScriptRoot\..\..\.."

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Log-Dot-Print Production Build" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Install dependencies
Write-Host "[1/3] Installing dependencies..." -ForegroundColor Yellow
Push-Location $ProjectRoot
try {
    & bun install
    Write-Host "  OK: Dependencies installed" -ForegroundColor Green
} finally {
    Pop-Location
}

# 2. Build
Write-Host "[2/3] Building (tsgo + UI)..." -ForegroundColor Yellow
Push-Location $ProjectRoot
try {
    & bun run build
    Write-Host "  OK: Build completed" -ForegroundColor Green
} finally {
    Pop-Location
}

# 3. Verify build output
Write-Host "[3/3] Verifying build output..." -ForegroundColor Yellow
$cliJs = Join-Path $ProjectRoot "dist\cli.js"
$uiDir = Join-Path $ProjectRoot "dist\ui"

$allOk = $true
if (Test-Path $cliJs) {
    $cliSize = (Get-Item $cliJs).Length
    Write-Host "  OK: dist/cli.js ($([math]::Round($cliSize / 1KB, 1)) KB)" -ForegroundColor Green
} else {
    Write-Host "  ERROR: dist/cli.js not found" -ForegroundColor Red
    $allOk = $false
}

if (Test-Path $uiDir) {
    $uiFiles = (Get-ChildItem $uiDir -Recurse -File).Count
    Write-Host "  OK: dist/ui/ ($uiFiles files)" -ForegroundColor Green
} else {
    Write-Host "  ERROR: dist/ui/ not found" -ForegroundColor Red
    $allOk = $false
}

# Show version
$packageJson = Get-Content (Join-Path $ProjectRoot "package.json") -Raw | ConvertFrom-Json
Write-Host ""
Write-Host "  Version: $($packageJson.version)" -ForegroundColor White

if ($allOk) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host " Build successful!" -ForegroundColor Green
    Write-Host " Next: Run install-service.ps1 (as Admin)" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
} else {
    Write-Error "Build verification failed. Check errors above."
}
