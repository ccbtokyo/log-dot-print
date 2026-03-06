# SumatraPDF print-settings debug script
# Usage: .\scripts\debug-sumatra-print.ps1 [-PdfPath <path>] [-PrinterName <name>] [-PaperKind <num>]
#
# Tests different SumatraPDF print-settings combinations to isolate
# orientation / auto-rotation issues with dot impact printers.

param(
    [string]$PdfPath = "data\prints",
    [string]$PrinterName = "EPSON VP-F4400N",
    [int]$PaperKind = 120,
    [string]$SumatraPath = "bin\SumatraPDF-3.5.2-64.exe"
)

# --- 1. Show printer driver orientation ---
Write-Host "`n=== Printer Driver Info ===" -ForegroundColor Cyan
$printer = Get-CimInstance -ClassName Win32_Printer -Filter "Name='$PrinterName'"
if ($printer) {
    Write-Host "Name:            $($printer.Name)"
    Write-Host "DriverName:      $($printer.DriverName)"
    Write-Host "PortName:        $($printer.PortName)"
    Write-Host "PrintProcessor:  $($printer.PrintProcessor)"
    Write-Host "Status:          $($printer.PrinterStatus)"
} else {
    Write-Host "Printer '$PrinterName' not found!" -ForegroundColor Red
    exit 1
}

# DEVMODE orientation (1=Portrait, 2=Landscape)
try {
    $devmode = (Get-PrintConfiguration -PrinterName $PrinterName -ErrorAction Stop)
    Write-Host "`n=== DEVMODE (Get-PrintConfiguration) ===" -ForegroundColor Cyan
    Write-Host "DuplexingMode:   $($devmode.DuplexingMode)"
    Write-Host "PaperSize:       $($devmode.PaperSizeID) (kind)"
    Write-Host "PrintTicketXML excerpt:"
    # Extract orientation from PrintTicket XML
    $xml = [xml]$devmode.PrintTicketXml
    $ns = New-Object Xml.XmlNamespaceManager($xml.NameTable)
    $ns.AddNamespace("psf", "http://schemas.microsoft.com/windows/2003/08/printing/printschemaframework")
    $ns.AddNamespace("psk", "http://schemas.microsoft.com/windows/2003/08/printing/printschemakeywords")
    $orientNode = $xml.SelectSingleNode("//psf:Feature[@name='psk:PageOrientation']//psf:Option/@name", $ns)
    if ($orientNode) {
        Write-Host "  Orientation:   $($orientNode.Value)" -ForegroundColor Yellow
    } else {
        Write-Host "  Orientation:   (not found in PrintTicket)"
    }
} catch {
    Write-Host "Get-PrintConfiguration failed: $_" -ForegroundColor Yellow
}

# --- 2. Resolve PDF file ---
if (Test-Path $PdfPath -PathType Container) {
    # Directory: pick the latest PDF
    $latestPdf = Get-ChildItem -Path $PdfPath -Filter "*.pdf" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $latestPdf) {
        Write-Host "`nNo PDF files found in $PdfPath" -ForegroundColor Red
        exit 1
    }
    $PdfPath = $latestPdf.FullName
}

if (-not (Test-Path $PdfPath)) {
    Write-Host "PDF not found: $PdfPath" -ForegroundColor Red
    exit 1
}

Write-Host "`n=== PDF ===" -ForegroundColor Cyan
Write-Host "File: $PdfPath"
Write-Host "Size: $((Get-Item $PdfPath).Length) bytes"

# --- 3. Verify SumatraPDF ---
if (-not (Test-Path $SumatraPath)) {
    Write-Host "SumatraPDF not found: $SumatraPath" -ForegroundColor Red
    exit 1
}

# Show version
$versionInfo = (Get-Item $SumatraPath).VersionInfo
Write-Host "`n=== SumatraPDF ===" -ForegroundColor Cyan
Write-Host "Path:    $SumatraPath"
Write-Host "Version: $($versionInfo.FileVersion)"

# --- 4. Test combinations ---
$tests = @(
    @{ Name = "A: baseline (no rotation/orientation)";     Settings = "noscale,1x,paperkind=$PaperKind" },
    @{ Name = "B: disable-auto-rotation";                  Settings = "disable-auto-rotation,noscale,1x,paperkind=$PaperKind" },
    @{ Name = "C: orientation=landscape";                  Settings = "landscape,noscale,1x,paperkind=$PaperKind" },
    @{ Name = "D: landscape + disable-auto-rotation";      Settings = "landscape,disable-auto-rotation,noscale,1x,paperkind=$PaperKind" }
)

Write-Host "`n=== Print Tests ===" -ForegroundColor Cyan
Write-Host "Printer:   $PrinterName"
Write-Host "PaperKind: $PaperKind"
Write-Host ""

foreach ($test in $tests) {
    $cmd = "& `"$SumatraPath`" -print-to `"$PrinterName`" -silent -print-settings `"$($test.Settings)`" `"$PdfPath`""

    Write-Host "--- $($test.Name) ---" -ForegroundColor Yellow
    Write-Host "CMD: $cmd" -ForegroundColor DarkGray
    $confirm = Read-Host "Run this test? (y/n/q)"

    if ($confirm -eq 'q') {
        Write-Host "Aborted." -ForegroundColor Red
        break
    }
    if ($confirm -ne 'y') {
        Write-Host "Skipped.`n"
        continue
    }

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $proc = Start-Process -FilePath $SumatraPath `
        -ArgumentList "-print-to", "`"$PrinterName`"", "-silent", "-print-settings", "`"$($test.Settings)`"", "`"$PdfPath`"" `
        -NoNewWindow -Wait -PassThru
    $sw.Stop()

    if ($proc.ExitCode -eq 0) {
        Write-Host "OK - spooler accepted in $($sw.ElapsedMilliseconds)ms" -ForegroundColor Green
    } else {
        Write-Host "FAILED - exit code $($proc.ExitCode) ($($sw.ElapsedMilliseconds)ms)" -ForegroundColor Red
    }
    Write-Host ""
}

Write-Host "`nDone. Check printed output for each test." -ForegroundColor Cyan
