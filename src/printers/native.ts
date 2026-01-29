/**
 * NativePrinter - Cross-platform printer using @printers/printers
 *
 * Related: src/printers/base-printer.ts (BasePrinter)
 *          src/printers/discovery.ts (PrinterDiscoveryService)
 *          src/core/types.ts (PrintJob, PrinterType, PrinterStatus)
 */
import {
  getPrinterByName,
  getDefaultPrinter,
  type Printer,
  type SimplePrintOptions,
} from "@printers/printers";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

import { BasePrinter } from "./base-printer.js";
import { printerRegistry } from "./registry.js";
import type { PrintJob, PrinterType, PrinterStatus } from "../core/types.js";

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
  /** Directory to persist print files for later download */
  persistDir?: string;
}

const MAX_PRINT_BYTES = 10 * 1024 * 1024; // 10MB

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

  private options: NativePrinterOptions;
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
      typeof options.persistDir === "string" ? options.persistDir.trim() : undefined;
    this.options = {
      printerName: printerName || undefined,
      copies,
      duplex,
      paperSize,
      quality,
      color,
      landscape,
      persistDir: persistDir || undefined,
    };
  }

  protected async connect(): Promise<void> {
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

      // Persist print file if persistDir is configured
      if (this.options.persistDir) {
        await mkdir(this.options.persistDir, { recursive: true });
        const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
        const persistFile = join(this.options.persistDir, `${timestamp}_${safeJobId}.txt`);
        await copyFile(tempFile, persistFile);
        job.filePath = persistFile;
        console.log(`[NativePrinter] Print file persisted: ${persistFile}`);
      }

      // Save debug copy in simulation mode if DEBUG_PRINT_DIR is set
      const debugDir = process.env.DEBUG_PRINT_DIR;
      const isSimulation = process.env.PRINTERS_JS_SIMULATE === "true";
      if (isSimulation && debugDir) {
        await mkdir(debugDir, { recursive: true });
        const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
        const debugFile = join(debugDir, `${timestamp}_${safeJobId}.txt`);
        await copyFile(tempFile, debugFile);
        console.log(`[NativePrinter] Debug output saved: ${debugFile}`);
      }
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

// Register with printer registry
printerRegistry.register("native", createNativePrinter);
