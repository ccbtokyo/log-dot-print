# scripts/debug-devmode.ps1
# Dump printer DEVMODE / PrintTicket fields for debugging.
# Run from both interactive session and service to compare.
#
# Usage:
#   .\scripts\debug-devmode.ps1 -PrinterName "EPSON VP-F4400N"
#   # or from app: powershell -File scripts/debug-devmode.ps1 -PrinterName "..."

param(
    [string]$PrinterName = "EPSON VP-F4400N"
)

$ErrorActionPreference = 'Continue'

Write-Host "=== DEVMODE Debug ===" -ForegroundColor Cyan
Write-Host "Printer:   $PrinterName"
Write-Host "User:      $env:USERNAME"
Write-Host "Session:   $([System.Diagnostics.Process]::GetCurrentProcess().SessionId)"
Write-Host "Time:      $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host ""

# --- 1. PrintTicket XML (Get-PrintConfiguration) ---
Write-Host "--- PrintTicket (Get-PrintConfiguration) ---" -ForegroundColor Yellow
try {
    $config = Get-PrintConfiguration -PrinterName $PrinterName -ErrorAction Stop
    [xml]$ticket = $config.PrintTicketXml

    $nsm = New-Object Xml.XmlNamespaceManager($ticket.NameTable)
    $nsm.AddNamespace("psf", "http://schemas.microsoft.com/windows/2003/08/printing/printschemaframework")
    $nsm.AddNamespace("psk", "http://schemas.microsoft.com/windows/2003/08/printing/printschemakeywords")

    # Resolution
    $resFeature = $ticket.SelectSingleNode("//psf:Feature[@name='psk:PageResolution']", $nsm)
    if ($resFeature) {
        $xNode = $resFeature.SelectSingleNode(".//psf:ScoredProperty[@name='psk:ResolutionX']/psf:Value", $nsm)
        $yNode = $resFeature.SelectSingleNode(".//psf:ScoredProperty[@name='psk:ResolutionY']/psf:Value", $nsm)
        $xDpi = if ($xNode) { $xNode.InnerText } else { "(not found)" }
        $yDpi = if ($yNode) { $yNode.InnerText } else { "(not found)" }
        Write-Host "  Resolution X:    $xDpi"
        Write-Host "  Resolution Y:    $yDpi"
        if ($xDpi -ne $yDpi) {
            Write-Host "  *** ASYMMETRIC DPI DETECTED ***" -ForegroundColor Red
        }
    } else {
        Write-Host "  Resolution:      (PageResolution feature not found)"
    }

    # Orientation
    $orientFeature = $ticket.SelectSingleNode("//psf:Feature[@name='psk:PageOrientation']", $nsm)
    if ($orientFeature) {
        $orientOption = $orientFeature.SelectSingleNode("psf:Option/@name", $nsm)
        Write-Host "  Orientation:     $(if ($orientOption) { $orientOption.Value } else { '(not found)' })"
    }

    # Color
    $colorFeature = $ticket.SelectSingleNode("//psf:Feature[@name='psk:PageColorManagement' or @name='psk:PageOutputColor']", $nsm)
    if ($colorFeature) {
        $colorOption = $colorFeature.SelectSingleNode("psf:Option/@name", $nsm)
        Write-Host "  Color:           $(if ($colorOption) { $colorOption.Value } else { '(not found)' })"
    }

    # Paper size
    $paperFeature = $ticket.SelectSingleNode("//psf:Feature[@name='psk:PageMediaSize']", $nsm)
    if ($paperFeature) {
        $paperOption = $paperFeature.SelectSingleNode("psf:Option/@name", $nsm)
        $widthNode = $paperFeature.SelectSingleNode(".//psf:ScoredProperty[@name='psk:MediaSizeWidth']/psf:Value", $nsm)
        $heightNode = $paperFeature.SelectSingleNode(".//psf:ScoredProperty[@name='psk:MediaSizeHeight']/psf:Value", $nsm)
        Write-Host "  Paper:           $(if ($paperOption) { $paperOption.Value } else { '(not found)' })"
        if ($widthNode -and $heightNode) {
            # PrintTicket uses 1/96000 inch units
            $wInch = [math]::Round([int]$widthNode.InnerText / 96000.0, 2)
            $hInch = [math]::Round([int]$heightNode.InnerText / 96000.0, 2)
            Write-Host "  Paper size:      $($widthNode.InnerText) x $($heightNode.InnerText) (${wInch} x ${hInch} inch)"
        }
    }

    # Duplex
    $duplexNode = $ticket.SelectSingleNode("//psf:Feature[@name='psk:JobDuplexAllDocumentsContiguously']/psf:Option/@name", $nsm)
    if ($duplexNode) {
        Write-Host "  Duplex:          $($duplexNode.Value)"
    }

    # Raw XML (trimmed)
    Write-Host ""
    Write-Host "--- Raw PrintTicket XML ---" -ForegroundColor Yellow
    Write-Host $config.PrintTicketXml
} catch {
    Write-Host "  ERROR: $_" -ForegroundColor Red
}

# --- 2. System.Drawing DEVMODE (for paper sizes) ---
Write-Host ""
Write-Host "--- Paper Sizes (System.Drawing) ---" -ForegroundColor Yellow
try {
    Add-Type -AssemblyName System.Drawing
    $doc = New-Object System.Drawing.Printing.PrintDocument
    $doc.PrinterSettings.PrinterName = $PrinterName
    if ($doc.PrinterSettings.IsValid) {
        Write-Host "  Default page: $($doc.DefaultPageSettings.PaperSize.PaperName) (kind=$($doc.DefaultPageSettings.PaperSize.RawKind), $($doc.DefaultPageSettings.PaperSize.Width/100.0)x$($doc.DefaultPageSettings.PaperSize.Height/100.0) inch)"
        Write-Host "  Landscape:    $($doc.DefaultPageSettings.Landscape)"
        Write-Host "  Color:        $($doc.DefaultPageSettings.Color)"
        Write-Host "  Resolution:   $($doc.DefaultPageSettings.PrinterResolution.X)x$($doc.DefaultPageSettings.PrinterResolution.Y)"
        Write-Host ""
        Write-Host "  Available paper sizes:"
        $doc.PrinterSettings.PaperSizes | ForEach-Object {
            Write-Host "    $($_.RawKind): $($_.PaperName) ($($_.Width) x $($_.Height))"
        }
    } else {
        Write-Host "  Printer '$PrinterName' is not valid" -ForegroundColor Red
    }
} catch {
    Write-Host "  ERROR: $_" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Cyan
