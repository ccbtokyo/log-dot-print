# install-service.ps1
# Install Log-Dot-Print as a Windows service using WinSW.
# Requires administrator privileges.

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
$ProjectRoot = Resolve-Path "$PSScriptRoot\..\..\.."
$WinswDir = Join-Path $PSScriptRoot "..\winsw"
$ServiceName = "LogDotPrint"
$ServiceExe = Join-Path $WinswDir "log-dot-print-service.exe"
$ServiceXml = Join-Path $WinswDir "log-dot-print-service.xml"

# --- Administrator privilege check ---
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Administrator privileges required. Restarting as administrator..." -ForegroundColor Yellow
    Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    exit
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Log-Dot-Print Service Installation" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Check if service already exists
$existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existingService) {
    Write-Host "WARNING: Service '$ServiceName' already exists (Status: $($existingService.Status))." -ForegroundColor Yellow
    $confirm = Read-Host "Reinstall? (y/N)"
    if ($confirm -ne 'y') {
        Write-Host "Cancelled." -ForegroundColor Yellow
        exit 0
    }
    if ($existingService.Status -eq 'Running') {
        Write-Host "Stopping existing service..." -ForegroundColor Yellow
        Stop-Service -Name $ServiceName
    }
    if (Test-Path $ServiceExe) {
        Push-Location $WinswDir
        try {
            & $ServiceExe uninstall
            if ($LASTEXITCODE -ne 0) { throw "WinSW uninstall exited with code $LASTEXITCODE" }
        } catch {
            Write-Host "  WinSW uninstall failed, falling back to sc.exe delete..." -ForegroundColor Yellow
            & sc.exe delete $ServiceName
        } finally {
            Pop-Location
        }
    } else {
        Write-Host "  WinSW binary not found, using sc.exe delete..." -ForegroundColor Yellow
        & sc.exe delete $ServiceName
    }
    Start-Sleep -Seconds 2
}

# 2. Download WinSW if not present
Write-Host "[1/5] Checking WinSW binary..." -ForegroundColor Yellow
if (-not (Test-Path $ServiceExe)) {
    Write-Host "  Downloading WinSW..." -ForegroundColor Yellow
    $winswUrl = "https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW.NET461.exe"
    Invoke-WebRequest -Uri $winswUrl -OutFile $ServiceExe -UseBasicParsing
    if (-not (Test-Path $ServiceExe)) {
        Write-Error "Failed to download WinSW. Please download manually from:"
        Write-Error "  $winswUrl"
        Write-Error "  Save as: $ServiceExe"
        exit 1
    }
    Write-Host "  OK: WinSW downloaded" -ForegroundColor Green
} else {
    Write-Host "  OK: WinSW binary exists" -ForegroundColor Green
}

# 3. Resolve bun path and prepare XML config
Write-Host "[2/5] Preparing service configuration..." -ForegroundColor Yellow
$bunCmd = Get-Command bun -ErrorAction SilentlyContinue
if (-not $bunCmd) {
    Write-Error "Bun is not installed. Run setup-environment.ps1 first."
    exit 1
}
$bunAbsPath = $bunCmd.Source

$xmlTemplatePath = Join-Path $PSScriptRoot "..\winsw\log-dot-print-service.xml.template"
# Always regenerate from the template to pick up path changes
$xmlContent = Get-Content $xmlTemplatePath -Raw
if (-not ($xmlContent -match '\{\{PROJECT_ROOT\}\}')) {
    Write-Error "Template '$xmlTemplatePath' does not contain placeholders. It may have been overwritten by a previous install. Please restore the original template from version control."
    exit 1
}
$xmlContent = $xmlContent -replace '\{\{PROJECT_ROOT\}\}', $ProjectRoot.Path
$xmlContent = $xmlContent -replace '\{\{BUN_PATH\}\}', $bunAbsPath
# Write generated config alongside the exe (WinSW requires xml next to exe)
Set-Content -Path $ServiceXml -Value $xmlContent -Encoding UTF8
Write-Host "  OK: Service XML configured" -ForegroundColor Green
Write-Host "  Project root: $($ProjectRoot.Path)" -ForegroundColor White
Write-Host "  Bun path: $bunAbsPath" -ForegroundColor White

# 4. Create logs directory
$logsDir = Join-Path $ProjectRoot "logs"
if (-not (Test-Path $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir | Out-Null
}

# 5. Install service
Write-Host "[3/5] Installing service..." -ForegroundColor Yellow
Push-Location $WinswDir
try {
    & $ServiceExe install
    if ($LASTEXITCODE -ne 0) {
        Write-Error "WinSW install failed with exit code $LASTEXITCODE"
        exit 1
    }
    Write-Host "  OK: Service installed" -ForegroundColor Green
} finally {
    Pop-Location
}

# 6. Configure service account
Write-Host "[4/5] Configuring service account..." -ForegroundColor Yellow
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
Write-Host "  Current user: $currentUser" -ForegroundColor White
$serviceUser = Read-Host "  Service account (Enter for current user: $currentUser)"
if ([string]::IsNullOrWhiteSpace($serviceUser)) {
    $serviceUser = $currentUser
}
if ($serviceUser -ne "LocalSystem") {
    $securePassword = Read-Host "  Password for $serviceUser" -AsSecureString
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    $plainPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    & sc.exe config $ServiceName obj= "$serviceUser" password= "$plainPassword"
    $plainPassword = $null
}
Write-Host "  OK: Service account configured" -ForegroundColor Green

# 7. Firewall rule
Write-Host "[5/5] Configuring firewall..." -ForegroundColor Yellow
$port = 3000
$configPath = Join-Path $ProjectRoot "config.json"
if (Test-Path $configPath) {
    try {
        $config = Get-Content $configPath -Raw | ConvertFrom-Json
        if ($config.server.port) { $port = $config.server.port }
    } catch {}
}

$existingRule = Get-NetFirewallRule -DisplayName "Log-Dot-Print" -ErrorAction SilentlyContinue
if ($existingRule) {
    Remove-NetFirewallRule -DisplayName "Log-Dot-Print"
}
New-NetFirewallRule -DisplayName "Log-Dot-Print" `
    -Description "Allow inbound TCP to Log-Dot-Print (port $port)" `
    -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow | Out-Null
Write-Host "  OK: Firewall rule added (TCP port $port)" -ForegroundColor Green

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Service installed successfully!" -ForegroundColor Green
Write-Host " Run start-service.ps1 to start" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
