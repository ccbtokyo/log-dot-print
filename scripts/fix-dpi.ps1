# scripts/fix-dpi.ps1
# Fix asymmetric DPI on EPSON ESC/P printers via Win32 SetPrinter API.
# Bypasses the PrintTicket Provider which normalizes DEVMODE values.
#
# Usage:
#   powershell -File scripts/fix-dpi.ps1 -PrinterName "EPSON VP-F4400N"

param(
    [Parameter(Mandatory)][string]$PrinterName
)

$ErrorActionPreference = 'Continue'

Write-Host "[fix-dpi] Starting for printer: $PrinterName"

try {
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class DevModeFixer {
    [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern int DocumentProperties(
        IntPtr hWnd, IntPtr hPrinter, string pDeviceName,
        IntPtr pDevModeOutput, IntPtr pDevModeInput, int fMode);

    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool GetPrinter(IntPtr hPrinter, int level, IntPtr pPrinter, int cbBuf, out int pcbNeeded);

    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool SetPrinter(IntPtr hPrinter, int level, IntPtr pPrinter, int command);

    const int DM_OUT_BUFFER = 2;
    const int DM_IN_BUFFER = 8;

    // DEVMODE structure offsets (wingdi.h)
    const int OFFSET_DM_PRINT_QUALITY = 90;  // dmPrintQuality (Int16) = X DPI
    const int OFFSET_DM_Y_RESOLUTION = 96;   // dmYResolution  (Int16) = Y DPI

    public static string Fix(string printerName) {
        IntPtr hPrinter;
        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
            return "ERROR: OpenPrinter failed: " + Marshal.GetLastWin32Error();
        try {
            // Get DEVMODE size
            int size = DocumentProperties(IntPtr.Zero, hPrinter, printerName,
                IntPtr.Zero, IntPtr.Zero, 0);
            if (size < 0)
                return "ERROR: DocumentProperties(size) failed";

            IntPtr pDevMode = Marshal.AllocHGlobal(size);
            try {
                // Get current DEVMODE
                int ret = DocumentProperties(IntPtr.Zero, hPrinter, printerName,
                    pDevMode, IntPtr.Zero, DM_OUT_BUFFER);
                if (ret < 0)
                    return "ERROR: DocumentProperties(get) failed";

                short xDpi = Marshal.ReadInt16(pDevMode, OFFSET_DM_PRINT_QUALITY);
                short yDpi = Marshal.ReadInt16(pDevMode, OFFSET_DM_Y_RESOLUTION);
                string msg = "DEVMODE DPI: " + xDpi + "x" + yDpi;

                if (xDpi == yDpi || xDpi <= 0 || yDpi <= 0)
                    return msg;

                short target = (short)Math.Min(xDpi, yDpi);
                Marshal.WriteInt16(pDevMode, OFFSET_DM_PRINT_QUALITY, target);
                Marshal.WriteInt16(pDevMode, OFFSET_DM_Y_RESOLUTION, target);

                // Validate modified DEVMODE through driver
                ret = DocumentProperties(IntPtr.Zero, hPrinter, printerName,
                    pDevMode, pDevMode, DM_IN_BUFFER | DM_OUT_BUFFER);
                if (ret < 0)
                    return msg + " | ERROR: DocumentProperties(validate) failed";

                // Check if driver accepted the change
                short newX = Marshal.ReadInt16(pDevMode, OFFSET_DM_PRINT_QUALITY);
                short newY = Marshal.ReadInt16(pDevMode, OFFSET_DM_Y_RESOLUTION);
                if (newX != target || newY != target)
                    return msg + " | WARNING: driver rejected, got " + newX + "x" + newY;

                // Apply as global default (PRINTER_INFO_8)
                IntPtr pInfo = Marshal.AllocHGlobal(IntPtr.Size);
                try {
                    Marshal.WriteIntPtr(pInfo, pDevMode);
                    if (!SetPrinter(hPrinter, 8, pInfo, 0))
                        return msg + " | ERROR: SetPrinter(8) failed: " + Marshal.GetLastWin32Error();
                } finally {
                    Marshal.FreeHGlobal(pInfo);
                }

                return msg + " | Fixed: " + xDpi + "x" + yDpi + " -> " + target + "x" + target;
            } finally {
                Marshal.FreeHGlobal(pDevMode);
            }
        } finally {
            ClosePrinter(hPrinter);
        }
    }
}
"@ -Language CSharp

$result = [DevModeFixer]::Fix($PrinterName)
Write-Host $result
} catch {
    Write-Host "[fix-dpi] ERROR: $_"
}
