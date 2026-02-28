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
Write-Host "[1/6] Checking WinSW binary..." -ForegroundColor Yellow
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

# 3. Resolve paths and collect service account credentials
Write-Host "[2/6] Preparing service configuration..." -ForegroundColor Yellow

# Bun
$bunCmd = Get-Command bun -ErrorAction SilentlyContinue
if (-not $bunCmd) {
    Write-Error "Bun is not installed. Run setup-environment.ps1 first."
    exit 1
}
$bunAbsPath = $bunCmd.Source
$bunDir = Split-Path $bunAbsPath -Parent

# Node.js (required for Playwright subprocess on Windows)
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd) {
    $nodeDir = Split-Path $nodeCmd.Source -Parent
    Write-Host "  Node.js: $($nodeCmd.Source)" -ForegroundColor Green
} else {
    $nodeDir = ""
    Write-Host "  WARNING: Node.js not found. PDF conversion will be disabled." -ForegroundColor Red
    Write-Host "  Install Node.js and re-run: winget install OpenJS.NodeJS.LTS" -ForegroundColor Yellow
}

# Service account: run as the current user (not LocalSystem)
# This ensures Playwright browsers, printers, and user-profile paths are accessible.
$serviceUser = ".\$env:USERNAME"
Write-Host "  Service will run as: $serviceUser" -ForegroundColor White
Write-Host "  Enter the Windows password for $env:USERNAME" -ForegroundColor Yellow
$securePassword = Read-Host -AsSecureString "  Password"
$plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
)

# Generate XML from template with all placeholders resolved
$xmlTemplatePath = Join-Path $PSScriptRoot "..\winsw\log-dot-print-service.xml.template"
$xmlContent = Get-Content $xmlTemplatePath -Raw
if (-not ($xmlContent -match '\{\{PROJECT_ROOT\}\}')) {
    Write-Error "Template '$xmlTemplatePath' does not contain placeholders. It may have been overwritten by a previous install. Please restore the original template from version control."
    exit 1
}
$xmlContent = $xmlContent -replace '\{\{PROJECT_ROOT\}\}', $ProjectRoot.Path
$xmlContent = $xmlContent -replace '\{\{BUN_PATH\}\}', $bunAbsPath
$xmlContent = $xmlContent -replace '\{\{BUN_DIR\}\}', $bunDir
# Playwright browsers installed under current user's profile
$playwrightPath = Join-Path $env:LOCALAPPDATA "ms-playwright"
Write-Host "  Playwright: $playwrightPath" -ForegroundColor White

$xmlContent = $xmlContent -replace '\{\{NODE_DIR\}\}', $nodeDir
$xmlContent = $xmlContent -replace '\{\{PLAYWRIGHT_BROWSERS_PATH\}\}', $playwrightPath
$xmlContent = $xmlContent -replace '\{\{SERVICE_USER\}\}', $serviceUser
$xmlContent = $xmlContent -replace '\{\{SERVICE_PASSWORD\}\}', [System.Security.SecurityElement]::Escape($plainPassword)
$plainPassword = $null
# Write generated config alongside the exe (WinSW requires xml next to exe)
Set-Content -Path $ServiceXml -Value $xmlContent -Encoding UTF8
Write-Host "  OK: Service XML configured" -ForegroundColor Green
Write-Host "  Project root: $($ProjectRoot.Path)" -ForegroundColor White
Write-Host "  Bun path: $bunAbsPath" -ForegroundColor White
Write-Host "  Node dir: $nodeDir" -ForegroundColor White

# 4. Grant "Log on as a service" right to the service user
Write-Host "[3/6] Granting 'Log on as a service' right..." -ForegroundColor Yellow
try {
    $tempCfg = [System.IO.Path]::GetTempFileName()
    & secedit /export /cfg $tempCfg /areas USER_RIGHTS | Out-Null
    $cfgContent = Get-Content $tempCfg -Raw
    $sid = (New-Object System.Security.Principal.NTAccount($env:USERNAME)).Translate(
        [System.Security.Principal.SecurityIdentifier]
    ).Value
    if ($cfgContent -match 'SeServiceLogonRight\s*=\s*(.*)') {
        $existing = $Matches[1]
        if ($existing -notmatch $sid) {
            $cfgContent = $cfgContent -replace "(SeServiceLogonRight\s*=\s*.*)", "`$1,*$sid"
        }
    } else {
        $cfgContent += "`r`n[Privilege Rights]`r`nSeServiceLogonRight = *$sid`r`n"
    }
    Set-Content $tempCfg $cfgContent
    & secedit /configure /db secedit.sdb /cfg $tempCfg /areas USER_RIGHTS | Out-Null
    Remove-Item $tempCfg -ErrorAction SilentlyContinue
    Write-Host "  OK: 'Log on as a service' right granted" -ForegroundColor Green
} catch {
    Write-Host "  WARNING: Could not grant 'Log on as a service' right: $_" -ForegroundColor Yellow
    Write-Host "  You may need to grant it manually via Local Security Policy." -ForegroundColor Yellow
}

# 5. Create logs directory
$logsDir = Join-Path $ProjectRoot "logs"
if (-not (Test-Path $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir | Out-Null
}

# 6. Install service (XML must be complete before this step)
Write-Host "[4/6] Installing service..." -ForegroundColor Yellow
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

# 7. Firewall rule
Write-Host "[5/6] Configuring firewall..." -ForegroundColor Yellow
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

# 8. Remove password from persisted XML (security: avoid plaintext on disk)
Write-Host "[6/6] Cleaning up credentials..." -ForegroundColor Yellow
$xmlContent = Get-Content $ServiceXml -Raw
$xmlContent = $xmlContent -replace '<password>[^<]*</password>', '<password>********</password>'
Set-Content -Path $ServiceXml -Value $xmlContent -Encoding UTF8
Write-Host "  OK: Credentials cleaned from XML" -ForegroundColor Green

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Service installed successfully!" -ForegroundColor Green
Write-Host " Service account: $serviceUser" -ForegroundColor White
Write-Host " Run start-service.ps1 to start" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
