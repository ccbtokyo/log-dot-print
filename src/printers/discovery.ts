/**
 * PrinterDiscoveryService - OS printer discovery using @printers/printers
 *
 * Related: src/core/types.ts (DiscoveredPrinter)
 */
import type { DiscoveredPrinter } from "../core/types.js";

// Dynamic import types for @printers/printers
type PrintersModule = typeof import("@printers/printers");
type Printer = import("@printers/printers").Printer;

let printersModule: PrintersModule | null = null;

/**
 * Load @printers/printers module dynamically
 * @returns The module or null if not available
 */
async function loadPrintersModule(): Promise<PrintersModule | null> {
  if (printersModule) return printersModule;
  try {
    printersModule = await import("@printers/printers");
    return printersModule;
  } catch {
    return null;
  }
}

/**
 * Map @printers/printers Printer state to our status type
 */
function mapPrinterState(state?: string): DiscoveredPrinter["status"] {
  if (!state) return undefined;
  const lower = state.toLowerCase();
  if (lower.includes("not ready") || lower.includes("not-ready")) return undefined;
  if (lower.includes("idle") || lower.includes("ready")) return "idle";
  if (lower.includes("print")) return "printing";
  if (lower.includes("pause") || lower.includes("stop")) return "paused";
  if (lower.includes("offline")) return "error";
  if (lower.includes("error") || lower.includes("fault")) return "error";
  return undefined;
}

/**
 * Convert @printers/printers Printer to DiscoveredPrinter
 */
function toDiscoveredPrinter(printer: Printer, defaultPrinterName?: string): DiscoveredPrinter {
  const status = mapPrinterState(printer.state);
  return {
    name: printer.name,
    isDefault: printer.name === defaultPrinterName,
    status,
    // Treat "idle"/"ready" as ready (mapPrinterState maps both to "idle")
    ready: status === "idle",
    description: printer.description,
  };
}

/**
 * Service for discovering OS-level printers
 */
export class PrinterDiscoveryService {
  /**
   * List all available printers
   */
  async listPrinters(): Promise<DiscoveredPrinter[]> {
    const mod = await loadPrintersModule();
    if (!mod) return [];

    const [printers, defaultPrinter] = await Promise.all([
      mod.getAllPrinters(),
      mod.getDefaultPrinter(),
    ]);
    const defaultName = defaultPrinter?.name;

    return printers.map((p) => toDiscoveredPrinter(p, defaultName));
  }

  /**
   * Get the default printer
   */
  async getDefaultPrinter(): Promise<DiscoveredPrinter | null> {
    const mod = await loadPrintersModule();
    if (!mod) return null;

    const printer = await mod.getDefaultPrinter();
    if (!printer) return null;
    return toDiscoveredPrinter(printer, printer.name);
  }

  /**
   * Check if a printer with the given name exists
   */
  async printerExists(name: string): Promise<boolean> {
    const mod = await loadPrintersModule();
    if (!mod) return false;

    const trimmed = typeof name === "string" ? name.trim() : "";
    if (trimmed.length === 0 || trimmed.length > 256 || trimmed.includes("\u0000")) {
      return false;
    }
    return mod.printerExists(trimmed);
  }
}

/**
 * Singleton instance for printer discovery
 */
export const printerDiscovery = new PrinterDiscoveryService();
