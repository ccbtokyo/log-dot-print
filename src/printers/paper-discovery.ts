/**
 * Paper size discovery service
 * Retrieves available paper sizes from OS (via lpoptions) or provides fallback list.
 *
 * @related src/printers/native.ts - NativePrinter (consumer)
 * @related src/server/ui/queue-controller.ts - QueueController (API endpoint)
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PaperSizeInfo } from "../core/types.js";

const execFileAsync = promisify(execFile);

export interface PaperSizeListResult {
  paperSizes: string[];
  paperSizeDetails: PaperSizeInfo[];
  source: "dynamic" | "fallback";
  printerName: string | null;
}

export const FALLBACK_PAPER_SIZES = [
  "A4",
  "A3",
  "A5",
  "B4",
  "B5",
  "Letter",
  "Legal",
  "Tabloid",
  "Executive",
  "Folio",
  "Invoice",
  "Custom.11x15.5in",
  "Custom.11x15in",
  "Custom.15x11in",
];

/**
 * Build a WMI filter expression safe for embedding in a PowerShell single-quoted string.
 * Applies two layers of escaping: WMI (double single quotes in value)
 * then PowerShell (double all remaining single quotes).
 * The result must be wrapped in PowerShell single quotes at the call site.
 * Exported for unit testing.
 */
export function buildSafePsWmiFilter(property: string, value: string): string {
  const wmiEscaped = value.replace(/'/g, "''");
  const wmiFilter = `${property}='${wmiEscaped}'`;
  return wmiFilter.replace(/'/g, "''");
}

/**
 * Parse PowerShell Get-CimInstance output to extract paper names.
 * Each line is a paper name. Exported for unit testing.
 */
export function parsePowerShellOutput(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Parse PowerShell System.Drawing.Printing.PaperSizes JSON output.
 * Each entry has PaperName (string) and RawKind (number).
 * Returns PaperSizeInfo[] with name and rawKind.
 * Exported for unit testing.
 */
export function parseWindowsPaperSizesOutput(output: string): PaperSizeInfo[] {
  if (!output.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(output.trim());
  } catch {
    return [];
  }
  const items = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  return items.map((entry) => {
    const obj = entry as Record<string, unknown>;
    const name = typeof obj.PaperName === "string" ? obj.PaperName : "";
    const rawKind =
      typeof obj.RawKind === "number" && Number.isFinite(obj.RawKind) ? obj.RawKind : null;
    return { name, rawKind };
  });
}

/**
 * Parse lpoptions output to extract PageSize options.
 * Exported for unit testing.
 */
export function parseLpoptionsOutput(output: string): string[] {
  for (const line of output.split("\n")) {
    if (line.startsWith("PageSize/")) {
      const colonIndex = line.indexOf(":");
      if (colonIndex === -1) return [];
      const valuesStr = line.slice(colonIndex + 1).trim();
      return valuesStr
        .split(/\s+/)
        .filter(Boolean)
        .map((token) => (token.startsWith("*") ? token.slice(1) : token));
    }
  }
  return [];
}

/**
 * Get available paper sizes for the given printer (or system default).
 *
 * On macOS/Linux, attempts to run `lpoptions -l` to dynamically discover sizes.
 * Falls back to a static list on failure (Windows, missing CUPS, etc.).
 */
/**
 * Build paperSizeDetails with rawKind: null for non-Windows or fallback results.
 */
function toNullRawKindDetails(sizes: string[]): PaperSizeInfo[] {
  return sizes.map((name) => ({ name, rawKind: null }));
}

export async function getAvailablePaperSizes(
  printerName?: string | null,
): Promise<PaperSizeListResult> {
  const resolvedName = printerName ?? null;

  // Windows: use DeviceCapabilities P/Invoke, then System.Drawing, then WMI
  if (process.platform === "win32") {
    // First try DeviceCapabilities P/Invoke (most reliable across all machines)
    try {
      const details = await getWindowsPaperSizesViaDeviceCapabilities(printerName ?? undefined);
      if (details.length > 0) {
        const sizes = details.map((d) => d.name);
        return {
          paperSizes: sizes,
          paperSizeDetails: details,
          source: "dynamic",
          printerName: resolvedName,
        };
      }
    } catch {
      // DeviceCapabilities failed — try System.Drawing fallback
    }

    // Second try System.Drawing.Printing for RawKind support
    try {
      const details = await getWindowsPaperSizesViaSystemDrawing(printerName ?? undefined);
      if (details.length > 0) {
        const sizes = details.map((d) => d.name);
        return {
          paperSizes: sizes,
          paperSizeDetails: details,
          source: "dynamic",
          printerName: resolvedName,
        };
      }
    } catch {
      // System.Drawing failed — try WMI fallback for names only
    }

    // WMI fallback: names only, no RawKind
    try {
      const filter = printerName ? buildSafePsWmiFilter("Name", printerName) : "Default=True";
      const script = `Get-CimInstance Win32_Printer -Filter '${filter}' | Select-Object -ExpandProperty PrinterPaperNames`;
      const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-Command", script], {
        timeout: 10000,
      });
      const sizes = parsePowerShellOutput(stdout);
      if (sizes.length > 0) {
        return {
          paperSizes: sizes,
          paperSizeDetails: toNullRawKindDetails(sizes),
          source: "dynamic",
          printerName: resolvedName,
        };
      }
    } catch {
      // PowerShell not available or failed — use fallback
    }
    return {
      paperSizes: FALLBACK_PAPER_SIZES,
      paperSizeDetails: toNullRawKindDetails(FALLBACK_PAPER_SIZES),
      source: "fallback",
      printerName: resolvedName,
    };
  }

  try {
    const args = printerName ? ["-p", printerName, "-l"] : ["-l"];
    const { stdout } = await execFileAsync("lpoptions", args, { timeout: 5000 });
    const sizes = parseLpoptionsOutput(stdout);
    if (sizes.length > 0) {
      return {
        paperSizes: sizes,
        paperSizeDetails: toNullRawKindDetails(sizes),
        source: "dynamic",
        printerName: resolvedName,
      };
    }
  } catch {
    // lpoptions not available or failed — use fallback
  }

  return {
    paperSizes: FALLBACK_PAPER_SIZES,
    paperSizeDetails: toNullRawKindDetails(FALLBACK_PAPER_SIZES),
    source: "fallback",
    printerName: resolvedName,
  };
}

/**
 * Query Windows printer paper sizes via Win32 DeviceCapabilities P/Invoke.
 * Uses winspool.drv DeviceCapabilities with DC_PAPERS (2) and DC_PAPERNAMES (16).
 * More reliable than System.Drawing on some machines where the latter returns
 * an incomplete paper list (e.g. ccbt PC with EPSON VP-F4400 driver).
 * Printer name is passed via LOG_DOT_PRINT_PRINTER environment variable.
 */
async function getWindowsPaperSizesViaDeviceCapabilities(
  printerName?: string,
): Promise<PaperSizeInfo[]> {
  const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class WinspoolInterop {
    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern int DeviceCapabilitiesW(
        string pDevice,
        string pPort,
        ushort fwCapability,
        IntPtr pOutput,
        IntPtr pDevMode
    );

    public const ushort DC_PAPERS = 2;
    public const ushort DC_PAPERNAMES = 16;
}
"@

$inputName = [Environment]::GetEnvironmentVariable("LOG_DOT_PRINT_PRINTER")
if ([string]::IsNullOrWhiteSpace($inputName)) {
    $p = Get-CimInstance Win32_Printer -Filter "Default=True" | Select-Object -First 1
    if (-not $p) { throw "No default printer found" }
} else {
    $wmiName = $inputName -replace "'", "''"
    $p = Get-CimInstance Win32_Printer -Filter "Name='$wmiName'" | Select-Object -First 1
    if (-not $p) { throw ("Printer not found: " + $inputName) }
}
$devName = $p.Name
$portName = $p.PortName

$count = [WinspoolInterop]::DeviceCapabilitiesW($devName, $portName, [WinspoolInterop]::DC_PAPERS, [IntPtr]::Zero, [IntPtr]::Zero)
if ($count -le 0) { throw "DeviceCapabilities DC_PAPERS returned $count" }

$papersPtr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($count * 2)
try {
    $ret = [WinspoolInterop]::DeviceCapabilitiesW($devName, $portName, [WinspoolInterop]::DC_PAPERS, $papersPtr, [IntPtr]::Zero)
    if ($ret -lt 0) { throw "DeviceCapabilities DC_PAPERS (fill) returned $ret" }
    $ids = New-Object int[] $count
    for ($i = 0; $i -lt $count; $i++) {
        $ids[$i] = [System.Runtime.InteropServices.Marshal]::ReadInt16($papersPtr, $i * 2)
    }
} finally {
    [System.Runtime.InteropServices.Marshal]::FreeHGlobal($papersPtr)
}

$nameSlotBytes = 64 * 2
$namesPtr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($count * $nameSlotBytes)
try {
    $ret = [WinspoolInterop]::DeviceCapabilitiesW($devName, $portName, [WinspoolInterop]::DC_PAPERNAMES, $namesPtr, [IntPtr]::Zero)
    if ($ret -lt 0) { throw "DeviceCapabilities DC_PAPERNAMES (fill) returned $ret" }
    $papers = @()
    for ($i = 0; $i -lt $count; $i++) {
        $offset = $i * $nameSlotBytes
        $ptr = [IntPtr]::Add($namesPtr, $offset)
        $name = [System.Runtime.InteropServices.Marshal]::PtrToStringUni($ptr)
        $papers += [PSCustomObject]@{ PaperName = $name; RawKind = $ids[$i] }
    }
} finally {
    [System.Runtime.InteropServices.Marshal]::FreeHGlobal($namesPtr)
}

$papers | ConvertTo-Json -Depth 4 -Compress
`.trim();

  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-EncodedCommand", encoded], {
    timeout: 15000,
    env: {
      ...process.env,
      LOG_DOT_PRINT_PRINTER: printerName ?? "",
    },
  });
  return parseWindowsPaperSizesOutput(stdout);
}

/**
 * Query Windows printer paper sizes via System.Drawing.Printing.PrinterSettings.PaperSizes.
 * Returns PaperSizeInfo[] with PaperName and RawKind (DEVMODE dmPaperSize).
 * Printer name is passed via LOG_DOT_PRINT_PRINTER environment variable.
 */
async function getWindowsPaperSizesViaSystemDrawing(
  printerName?: string,
): Promise<PaperSizeInfo[]> {
  const script = `
Add-Type -AssemblyName System.Drawing
$settings = New-Object System.Drawing.Printing.PrinterSettings
$inputName = [Environment]::GetEnvironmentVariable("LOG_DOT_PRINT_PRINTER")
if (-not [string]::IsNullOrWhiteSpace($inputName)) {
  $settings.PrinterName = $inputName
}
if (-not $settings.IsValid) { throw ("Printer not valid: " + $settings.PrinterName) }
$papers = @()
foreach ($ps in $settings.PaperSizes) {
  $papers += [PSCustomObject]@{ PaperName = [string]$ps.PaperName; RawKind = [int]$ps.RawKind }
}
$papers | ConvertTo-Json -Depth 4 -Compress
`.trim();

  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-EncodedCommand", encoded], {
    timeout: 15000,
    env: {
      ...process.env,
      LOG_DOT_PRINT_PRINTER: printerName ?? "",
    },
  });
  return parseWindowsPaperSizesOutput(stdout);
}
