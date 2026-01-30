/**
 * NativePrinter - Cross-platform printer using @printers/printers
 *
 * Related: src/printers/base-printer.ts (BasePrinter)
 *          src/printers/discovery.ts (PrinterDiscoveryService)
 *          src/core/types.ts (PrintJob, PrinterType, PrinterStatus)
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

import { BasePrinter } from "./base-printer.js";
import { printerRegistry } from "./registry.js";
import type { PrintJob, PrinterType, PrinterStatus } from "../core/types.js";

// Dynamic import types for @printers/printers
type PrintersModule = typeof import("@printers/printers");
type Printer = import("@printers/printers").Printer;
type SimplePrintOptions = import("@printers/printers").SimplePrintOptions;

let printersModule: PrintersModule | null = null;

/**
 * Load @printers/printers module dynamically
 */
async function loadPrintersModule(): Promise<PrintersModule> {
  if (!printersModule) {
    printersModule = await import("@printers/printers");
  }
  return printersModule;
}

/**
 * Default directory for persisting print files
 */
const DEFAULT_PERSIST_DIR = "./data/prints";

/**
 * Options for NativePrinter
 */
export interface NativePrinterOptions {
  /** Printer name (if not specified, uses default printer) */
  printerName?: string;
  /** Number of copies */
  copies?: number;
  /** Duplex printing */
  duplex?: boolean;
  /** Paper size */
  paperSize?: "A4" | "Letter" | "Legal" | "A3" | "A5" | "Tabloid";
  /** Print quality */
  quality?: "draft" | "normal" | "high";
  /** Color printing */
  color?: boolean;
  /** Landscape orientation */
  landscape?: boolean;
  /** Directory to persist print files for later download (default: ./data/prints) */
  persistDir?: string;
}

const MAX_PRINT_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * Internal options with required persistDir (defaults applied)
 */
type NativePrinterInternalOptions = Omit<NativePrinterOptions, "persistDir"> & {
  persistDir: string;
};

/**
 * NativePrinter - Cross-platform printer implementation
 *
 * Uses @printers/printers library (Rust backend) for native printing.
 * Supports Windows, macOS, and Linux.
 */
export class NativePrinter extends BasePrinter {
  readonly name = "native-printer";
  readonly version = "1.0.0";
  protected readonly printerType: PrinterType = "native";

  private options: NativePrinterInternalOptions;
  private printer: Printer | null = null;
  private printerAvailable = false;

  constructor(options: NativePrinterOptions = {}) {
    super();
    const printerName =
      typeof options.printerName === "string" ? options.printerName.trim() : undefined;
    const copies =
      typeof options.copies === "number" && Number.isFinite(options.copies) && options.copies > 0
        ? Math.trunc(options.copies)
        : 1;
    const duplex = typeof options.duplex === "boolean" ? options.duplex : false;
    const color = typeof options.color === "boolean" ? options.color : false;
    const landscape = typeof options.landscape === "boolean" ? options.landscape : false;
    const quality =
      options.quality === "draft" || options.quality === "normal" || options.quality === "high"
        ? options.quality
        : "normal";
    const paperSize =
      options.paperSize === "A4" ||
      options.paperSize === "Letter" ||
      options.paperSize === "Legal" ||
      options.paperSize === "A3" ||
      options.paperSize === "A5" ||
      options.paperSize === "Tabloid"
        ? options.paperSize
        : undefined;
    const persistDir =
      typeof options.persistDir === "string" && options.persistDir.trim()
        ? options.persistDir.trim()
        : DEFAULT_PERSIST_DIR;
    this.options = {
      printerName: printerName || undefined,
      copies,
      duplex,
      paperSize,
      quality,
      color,
      landscape,
      persistDir,
    };
  }

  protected async connect(): Promise<void> {
    const { getPrinterByName, getDefaultPrinter } = await loadPrintersModule();

    if (this.options.printerName) {
      // Avoid TOCTOU (exists -> fetch) by resolving the printer handle once.
      this.printer = await getPrinterByName(this.options.printerName);
      if (!this.printer) {
        throw new Error(`Printer not found: ${this.options.printerName}`);
      }
      this.printerAvailable = true;
      console.log(`[NativePrinter] Connected to ${this.printer.name}`);
    } else {
      // Use default printer
      this.printer = await getDefaultPrinter();
      if (this.printer) {
        this.printerAvailable = true;
        console.log(`[NativePrinter] Connected to ${this.printer.name}`);
      } else {
        this.printerAvailable = false;
        console.warn("[NativePrinter] No default printer available - running in degraded mode");
      }
    }
  }

  protected async disconnect(): Promise<void> {
    this.printer = null;
    this.printerAvailable = false;
    console.log("[NativePrinter] Disconnected");
  }

  async getStatus(): Promise<PrinterStatus> {
    let ready = this.printerAvailable;
    let info: string | undefined;

    if (this.printer) {
      const state = this.printer.state;
      const lower = state?.toLowerCase();
      if (!lower) {
        ready = this.printerAvailable;
      } else if (lower.includes("not ready") || lower.includes("not-ready")) {
        ready = false;
      } else {
        ready = lower.includes("idle") || lower.includes("ready");
      }
      info = state ?? undefined;
    }

    return {
      connected: this.connected,
      name: this.printer?.name ?? this.options.printerName ?? "default",
      type: this.printerType,
      ready,
      info,
    };
  }

  async print(job: PrintJob): Promise<void> {
    if (!this.printer || !this.printerAvailable) {
      throw new Error("Printer not connected");
    }

    if (typeof job.formattedContent !== "string") {
      throw new Error("Invalid job.formattedContent");
    }
    const bytes = Buffer.byteLength(job.formattedContent, "utf8");
    if (bytes > MAX_PRINT_BYTES) {
      throw new Error(`Print content too large: ${bytes} bytes`);
    }

    const safeJobId = (job.id || "job")
      .replaceAll(/[^a-zA-Z0-9_-]/g, "_")
      .replaceAll(/^_+|_+$/g, "")
      .slice(0, 64);

    const tempDir = await mkdtemp(join(tmpdir(), "log-dot-print-"));
    const tempFile = join(tempDir, `print-${safeJobId || "job"}.txt`);

    try {
      await writeFile(tempFile, job.formattedContent, { encoding: "utf8", flag: "wx" });

      // Build print options
      const printOptions: SimplePrintOptions = {
        copies: this.options.copies,
        duplex: this.options.duplex,
        quality: this.options.quality,
        color: this.options.color,
        landscape: this.options.landscape,
        jobName: `log-${safeJobId}`,
      };

      if (this.options.paperSize) {
        printOptions.paperSize = this.options.paperSize;
      }

      // Print the file
      // Explicitly wait for completion before removing the temp file.
      await this.printer.printFile(tempFile, { simple: printOptions, waitForCompletion: true });

      // Persist print file (always enabled with default directory)
      await mkdir(this.options.persistDir, { recursive: true });
      const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
      const persistFile = join(this.options.persistDir, `${timestamp}_${safeJobId}.txt`);
      await copyFile(tempFile, persistFile);
      job.filePath = persistFile;
      console.log(`[NativePrinter] Print file persisted: ${persistFile}`);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

/**
 * Factory function for creating NativePrinter instances
 */
function createNativePrinter(options: Record<string, unknown>): NativePrinter {
  return new NativePrinter(options as NativePrinterOptions);
}

/**
 * Register the native printer plugin
 */
export function register(): void {
  printerRegistry.register("native", createNativePrinter);
}

/**
 * Try to register the native printer plugin
 * Only registers if @printers/printers module is available
 * @returns true if registered successfully, false if module not available
 */
export async function tryRegister(): Promise<boolean> {
  try {
    // Check if @printers/printers is available
    await import("@printers/printers");
    register();
    console.log("[NativePrinter] Registered successfully");
    return true;
  } catch {
    console.log("[NativePrinter] @printers/printers not available, skipping registration");
    return false;
  }
}
