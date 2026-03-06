# scripts/sumatra-print.ps1
# Wrapper for SumatraPDF that ensures correct printer DPI before printing.
#
# Windows services run in Session 0, where the printer DEVMODE defaults may
# differ from the interactive session. SumatraPDF's -print-settings cannot
# override DPI, so asymmetric DPI (e.g. 360x180) causes 50% width compression
# because SumatraPDF uses Y DPI for both axes.
#
# This script:
# 1. Reads the printer's current PrintTicket (DEVMODE)
# 2. If DPI is asymmetric, forces it to the lower (correct) value
# 3. Calls SumatraPDF via the & operator (matching interactive CLI behavior)

param(
    [Parameter(Mandatory)][string]$SumatraPath,
    [Parameter(Mandatory)][string]$PrinterName,
    [Parameter(Mandatory)][string]$Settings,
    [Parameter(Mandatory)][string]$FilePath
)

$ErrorActionPreference = 'Continue'

# --- Ensure symmetric DPI ---
try {
    $printConfig = Get-PrintConfiguration -PrinterName $PrinterName -ErrorAction Stop
    [xml]$ticket = $printConfig.PrintTicketXml

    $nsm = New-Object Xml.XmlNamespaceManager($ticket.NameTable)
    $nsm.AddNamespace("psf", "http://schemas.microsoft.com/windows/2003/08/printing/printschemaframework")
    $nsm.AddNamespace("psk", "http://schemas.microsoft.com/windows/2003/08/printing/printschemakeywords")

    $resFeature = $ticket.SelectSingleNode("//psf:Feature[@name='psk:PageResolution']", $nsm)
    if ($resFeature) {
        $xNode = $resFeature.SelectSingleNode(".//psf:ScoredProperty[@name='psk:ResolutionX']/psf:Value", $nsm)
        $yNode = $resFeature.SelectSingleNode(".//psf:ScoredProperty[@name='psk:ResolutionY']/psf:Value", $nsm)

        $xDpi = if ($xNode) { [int]$xNode.InnerText } else { 0 }
        $yDpi = if ($yNode) { [int]$yNode.InnerText } else { 0 }

        Write-Host "[sumatra-print] Current DPI: ${xDpi}x${yDpi}"

        if ($xDpi -ne $yDpi -and $xDpi -gt 0 -and $yDpi -gt 0) {
            # Asymmetric DPI detected — force symmetric using the lower value.
            # EPSON ESC/P drivers default to 360x180; SumatraPDF uses Y DPI (180)
            # for both axes, but the printer interprets X at 360 -> 50% compression.
            $targetDpi = [Math]::Min($xDpi, $yDpi)
            Write-Host "[sumatra-print] Fixing asymmetric DPI: ${xDpi}x${yDpi} -> ${targetDpi}x${targetDpi}"

            if ($xNode) { $xNode.InnerText = "$targetDpi" }
            if ($yNode) { $yNode.InnerText = "$targetDpi" }

            Set-PrintConfiguration -PrinterName $PrinterName -PrintTicketXml $ticket.OuterXml -ErrorAction Stop
            Write-Host "[sumatra-print] DPI corrected to ${targetDpi}x${targetDpi}"
        }
    } else {
        Write-Host "[sumatra-print] No PageResolution feature found in PrintTicket"
    }
} catch {
    Write-Warning "[sumatra-print] Could not verify/set DPI: $_"
}

# --- Call SumatraPDF ---
Write-Host "[sumatra-print] Calling: & `"$SumatraPath`" -print-to `"$PrinterName`" -silent -print-settings `"$Settings`" `"$FilePath`""
& $SumatraPath -print-to $PrinterName -silent -print-settings $Settings $FilePath
exit $LASTEXITCODE
