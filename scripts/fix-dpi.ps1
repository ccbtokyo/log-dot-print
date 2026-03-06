# scripts/fix-dpi.ps1
# Fix asymmetric DPI on EPSON ESC/P printers via registry DEVMODE patching.
# No C# compilation required (Add-Type hangs in Session 0).
#
# Usage:
#   powershell -File scripts/fix-dpi.ps1 -PrinterName "EPSON VP-F4400N"

param(
    [Parameter(Mandatory)][string]$PrinterName
)

$ErrorActionPreference = 'Continue'

Write-Host "[fix-dpi] Starting for printer: $PrinterName"

# DEVMODE structure offsets (wingdi.h)
$OFFSET_X = 90   # dmPrintQuality (Int16) = X DPI
$OFFSET_Y = 96   # dmYResolution  (Int16) = Y DPI

$regPath = "HKLM:\SYSTEM\CurrentControlSet\Control\Print\Printers\$PrinterName"

try {
    $prop = Get-ItemProperty -Path $regPath -Name "Default DevMode" -ErrorAction Stop
    $devmode = $prop."Default DevMode"

    $xDpi = [BitConverter]::ToInt16($devmode, $OFFSET_X)
    $yDpi = [BitConverter]::ToInt16($devmode, $OFFSET_Y)
    Write-Host "[fix-dpi] DEVMODE DPI: ${xDpi}x${yDpi}"

    if ($xDpi -eq $yDpi -or $xDpi -le 0 -or $yDpi -le 0) {
        Write-Host "[fix-dpi] No fix needed"
        exit 0
    }

    $target = [Math]::Min($xDpi, $yDpi)
    Write-Host "[fix-dpi] Patching: ${xDpi}x${yDpi} -> ${target}x${target}"

    $tb = [BitConverter]::GetBytes([Int16]$target)
    $tb.CopyTo($devmode, $OFFSET_X)
    $tb.CopyTo($devmode, $OFFSET_Y)

    Set-ItemProperty -Path $regPath -Name "Default DevMode" -Value ([byte[]]$devmode) -ErrorAction Stop
    Write-Host "[fix-dpi] Registry updated"

    # Restart spooler to pick up the new DEVMODE
    Restart-Service Spooler -ErrorAction Stop
    Write-Host "[fix-dpi] Spooler restarted"

    # Verify
    $prop2 = Get-ItemProperty -Path $regPath -Name "Default DevMode" -ErrorAction Stop
    $devmode2 = $prop2."Default DevMode"
    $newX = [BitConverter]::ToInt16($devmode2, $OFFSET_X)
    $newY = [BitConverter]::ToInt16($devmode2, $OFFSET_Y)
    Write-Host "[fix-dpi] Verified: ${newX}x${newY}"
} catch {
    Write-Host "[fix-dpi] ERROR: $_"
    exit 1
}
