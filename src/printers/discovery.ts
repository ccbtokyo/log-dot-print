/**
 * PrinterDiscoveryService - OS printer discovery using @printers/printers
 *
 * Related: src/core/types.ts (DiscoveredPrinter)
 */
import { getAllPrinters, getDefaultPrinter, printerExists, type Printer } from "@printers/printers";

import type { DiscoveredPrinter } from "../core/types.js";

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
    const [printers, defaultPrinter] = await Promise.all([getAllPrinters(), getDefaultPrinter()]);
    const defaultName = defaultPrinter?.name;

    return printers.map((p) => toDiscoveredPrinter(p, defaultName));
  }

  /**
   * Get the default printer
   */
  async getDefaultPrinter(): Promise<DiscoveredPrinter | null> {
    const printer = await getDefaultPrinter();
    if (!printer) return null;
    return toDiscoveredPrinter(printer, printer.name);
  }

  /**
   * Check if a printer with the given name exists
   */
  async printerExists(name: string): Promise<boolean> {
    const trimmed = typeof name === "string" ? name.trim() : "";
    if (trimmed.length === 0 || trimmed.length > 256 || trimmed.includes("\u0000")) {
      return false;
    }
    return printerExists(trimmed);
  }
}

/**
 * Singleton instance for printer discovery
 */
export const printerDiscovery = new PrinterDiscoveryService();
