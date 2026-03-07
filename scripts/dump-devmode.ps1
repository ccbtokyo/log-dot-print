# scripts/dump-devmode.ps1
# Dump DEVMODE fields for a printer to diagnose Session 0 vs interactive differences.
#
# Usage (run in BOTH interactive session AND as SYSTEM via psexec/service):
#   powershell -File scripts/dump-devmode.ps1 -PrinterName "EPSON VP-F4400N"

param(
    [Parameter(Mandatory)][string]$PrinterName
)

$ErrorActionPreference = 'Continue'

Write-Host "=== DEVMODE Dump for: $PrinterName ==="
Write-Host "User: $env:USERNAME"
Write-Host "Session: $([System.Diagnostics.Process]::GetCurrentProcess().SessionId)"
Write-Host ""

$regPath = "HKLM:\SYSTEM\CurrentControlSet\Control\Print\Printers\$PrinterName"

try {
    $prop = Get-ItemProperty -Path $regPath -Name "Default DevMode" -ErrorAction Stop
    $dm = $prop."Default DevMode"

    Write-Host "DEVMODE size: $($dm.Length) bytes"
    Write-Host ""

    # Standard DEVMODE fields (wingdi.h offsets for DEVMODEW)
    # Offset  Size  Field
    # 0       64    dmDeviceName (WCHAR[32])
    # 68      2     dmSpecVersion
    # 70      2     dmDriverVersion
    # 72      2     dmSize
    # 74      2     dmDriverExtra
    # 76      4     dmFields (bitmask)
    # 80      2     dmOrientation
    # 82      2     dmPaperSize
    # 84      2     dmPaperLength
    # 86      2     dmPaperWidth
    # 88      2     dmScale
    # 90      2     dmCopies
    # 92      2     dmDefaultSource
    # 94      2     dmPrintQuality (= X DPI)
    # 96      2     dmColor        (1=mono, 2=color)
    # 98      2     dmDuplex
    # 100     2     dmYResolution  (= Y DPI)
    # 102     2     dmTTOption
    # 104     2     dmCollate
    # 108     64    dmFormName (WCHAR[32])
    # ...
    # 178     4     dmDitherType

    $fields = @(
        @{ Name = "dmSpecVersion";    Offset = 68;  Size = 2; Signed = $false }
        @{ Name = "dmDriverVersion";  Offset = 70;  Size = 2; Signed = $false }
        @{ Name = "dmSize";           Offset = 72;  Size = 2; Signed = $false }
        @{ Name = "dmDriverExtra";    Offset = 74;  Size = 2; Signed = $false }
        @{ Name = "dmFields";         Offset = 76;  Size = 4; Signed = $false }
        @{ Name = "dmOrientation";    Offset = 80;  Size = 2; Signed = $true }
        @{ Name = "dmPaperSize";      Offset = 82;  Size = 2; Signed = $true }
        @{ Name = "dmPaperLength";    Offset = 84;  Size = 2; Signed = $true }
        @{ Name = "dmPaperWidth";     Offset = 86;  Size = 2; Signed = $true }
        @{ Name = "dmScale";          Offset = 88;  Size = 2; Signed = $true }
        @{ Name = "dmCopies";         Offset = 90;  Size = 2; Signed = $true }
        @{ Name = "dmDefaultSource";  Offset = 92;  Size = 2; Signed = $true }
        @{ Name = "dmPrintQuality";   Offset = 94;  Size = 2; Signed = $true }
        @{ Name = "dmColor";          Offset = 96;  Size = 2; Signed = $true }
        @{ Name = "dmDuplex";         Offset = 98;  Size = 2; Signed = $true }
        @{ Name = "dmYResolution";    Offset = 100; Size = 2; Signed = $true }
        @{ Name = "dmTTOption";       Offset = 102; Size = 2; Signed = $true }
        @{ Name = "dmCollate";        Offset = 104; Size = 2; Signed = $true }
        @{ Name = "dmDitherType";     Offset = 178; Size = 4; Signed = $false }
    )

    # dmFormName: WCHAR[32] at offset 108
    $formNameBytes = $dm[108..171]
    $formName = [System.Text.Encoding]::Unicode.GetString($formNameBytes).TrimEnd("`0")
    Write-Host ("  {0,-20} = {1}" -f "dmFormName", $formName)

    foreach ($f in $fields) {
        $val = if ($f.Size -eq 2 -and $f.Signed) {
            [BitConverter]::ToInt16($dm, $f.Offset)
        } elseif ($f.Size -eq 2) {
            [BitConverter]::ToUInt16($dm, $f.Offset)
        } elseif ($f.Size -eq 4 -and $f.Signed) {
            [BitConverter]::ToInt32($dm, $f.Offset)
        } else {
            [BitConverter]::ToUInt32($dm, $f.Offset)
        }

        $extra = ""
        if ($f.Name -eq "dmColor") {
            $extra = if ($val -eq 1) { " (MONO)" } elseif ($val -eq 2) { " (COLOR)" } else { " (?)" }
        }
        if ($f.Name -eq "dmOrientation") {
            $extra = if ($val -eq 1) { " (PORTRAIT)" } elseif ($val -eq 2) { " (LANDSCAPE)" } else { " (?)" }
        }
        if ($f.Name -eq "dmPrintQuality" -or $f.Name -eq "dmYResolution") {
            $extra = " DPI"
        }

        Write-Host ("  {0,-20} = {1}{2}" -f $f.Name, $val, $extra)
    }

    Write-Host ""

    # Dump driver-private data (after dmSize + standard area)
    $dmSize = [BitConverter]::ToUInt16($dm, 72)
    $dmDriverExtra = [BitConverter]::ToUInt16($dm, 74)
    if ($dmDriverExtra -gt 0) {
        $privateStart = $dmSize
        $privateEnd = [Math]::Min($privateStart + $dmDriverExtra, $dm.Length)
        Write-Host "Driver-private data ($dmDriverExtra bytes, offset $privateStart):"
        $hex = ($dm[$privateStart..($privateEnd-1)] | ForEach-Object { $_.ToString("X2") }) -join " "
        # Print in rows of 32 bytes
        for ($i = 0; $i -lt $hex.Length; $i += 96) {
            $end = [Math]::Min($i + 96, $hex.Length)
            Write-Host ("  " + $hex.Substring($i, $end - $i))
        }
    }

    Write-Host ""
    Write-Host "=== Done ==="
} catch {
    Write-Host "ERROR: $_"
    exit 1
}
