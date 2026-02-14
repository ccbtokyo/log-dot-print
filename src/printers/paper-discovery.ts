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

  // Skip dynamic discovery on Windows
  if (process.platform === "win32") {
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
