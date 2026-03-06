# scripts/sumatra-print.ps1
# Wrapper that calls SumatraPDF via the & operator.
# DPI is fixed at startup by NativePrinter.ensureSymmetricDpi().

param(
    [Parameter(Mandatory)][string]$SumatraPath,
    [Parameter(Mandatory)][string]$PrinterName,
    [Parameter(Mandatory)][string]$Settings,
    [Parameter(Mandatory)][string]$FilePath
)

$ErrorActionPreference = 'Continue'

Write-Host "[sumatra-print] Calling: & `"$SumatraPath`" -print-to `"$PrinterName`" -silent -print-settings `"$Settings`" `"$FilePath`""
& $SumatraPath -print-to $PrinterName -silent -print-settings $Settings $FilePath
exit $LASTEXITCODE
