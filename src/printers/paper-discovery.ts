/**
 * Paper size discovery service
 * Retrieves available paper sizes from OS (via lpoptions) or provides fallback list.
 *
 * @related src/printers/native.ts - NativePrinter (consumer)
 * @related src/server/ui/queue-controller.ts - QueueController (API endpoint)
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface PaperSizeListResult {
  paperSizes: string[];
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
export async function getAvailablePaperSizes(
  printerName?: string | null,
): Promise<PaperSizeListResult> {
  const resolvedName = printerName ?? null;

  // Windows: use PowerShell to query printer paper sizes
  if (process.platform === "win32") {
    try {
      const filter = printerName ? buildSafePsWmiFilter("Name", printerName) : "Default=True";
      const script = `Get-CimInstance Win32_Printer -Filter '${filter}' | Select-Object -ExpandProperty PrinterPaperNames`;
      const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-Command", script], {
        timeout: 10000,
      });
      const sizes = parsePowerShellOutput(stdout);
      if (sizes.length > 0) {
        return { paperSizes: sizes, source: "dynamic", printerName: resolvedName };
      }
    } catch {
      // PowerShell not available or failed — use fallback
    }
    return { paperSizes: FALLBACK_PAPER_SIZES, source: "fallback", printerName: resolvedName };
  }

  try {
    const args = printerName ? ["-p", printerName, "-l"] : ["-l"];
    const { stdout } = await execFileAsync("lpoptions", args, { timeout: 5000 });
    const sizes = parseLpoptionsOutput(stdout);
    if (sizes.length > 0) {
      return { paperSizes: sizes, source: "dynamic", printerName: resolvedName };
    }
  } catch {
    // lpoptions not available or failed — use fallback
  }

  return { paperSizes: FALLBACK_PAPER_SIZES, source: "fallback", printerName: resolvedName };
}
