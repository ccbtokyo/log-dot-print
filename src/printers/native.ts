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
import {
  resolvePaperSize,
  normalizePaperName,
  parsePaperDimensions,
} from "./paper-size-resolver.js";
import { printerRegistry } from "./registry.js";
import type { PrintJob, PrinterType, PrinterStatus, PrintContentType } from "../core/types.js";

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
 * Get file extension based on content type
 */
function getFileExtension(contentType?: PrintContentType): string {
  switch (contentType) {
    case "json":
      return ".json";
    case "html":
      return ".html";
    case "image":
      return ".png";
    case "pdf":
      return ".pdf";
    case "text":
    default:
      return ".txt";
  }
}

/**
 * Print a PDF file using pdf-to-printer (SumatraPDF) on Windows.
 * Only the `print()` function is used — `getPrinters()`/`getDefaultPrinter()`
 * are NOT called to avoid PowerShell parser bugs in Japanese environments.
 */
async function printPdfWithSumatraPDF(
  filePath: string,
  printerName: string,
  options: NativePrinterInternalOptions,
  rawPaperSize?: string,
): Promise<void> {
  let ptpPrint: (pdf: string, opts?: import("pdf-to-printer").PrintOptions) => Promise<void>;
  try {
    const mod = await import("pdf-to-printer");
    ptpPrint = mod.print;
  } catch {
    throw new Error(
      "pdf-to-printer is required for Windows PDF printing. Install with: bun add pdf-to-printer",
    );
  }

  const printOptions: import("pdf-to-printer").PrintOptions = {
    printer: printerName,
    silent: true,
    copies: options.copies,
    orientation: options.landscape ? "landscape" : "portrait",
    monochrome: !options.color,
    scale: options.fitToPage ? "fit" : "noscale",
  };
  if (options.duplex) {
    printOptions.side = "duplex";
  }
  if (rawPaperSize && !rawPaperSize.startsWith("Custom.")) {
    // Pass raw paper name directly — Windows driver form names
    // (e.g. "15x11", "Fanfold 15 x 11 1/2 inch") are not CUPS-normalizable,
    // so we bypass normalizePaperName() and hand the value through as-is.
    // Custom.* format (CUPS dimension syntax) is skipped — SumatraPDF cannot
    // parse it, so we let the printer driver DEVMODE decide instead.
    printOptions.paperSize = rawPaperSize;
  }

  await ptpPrint(filePath, printOptions);
}

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
  /** Paper size (standard names like "A4", "Letter", or custom like "Custom.11x15.5in") */
  paperSize?: string;
  /** Print quality */
  quality?: "draft" | "normal" | "high";
  /** Color printing */
  color?: boolean;
  /** Landscape orientation */
  landscape?: boolean;
  /** Fit content to page (default: false = original size / 100%) */
  fitToPage?: boolean;
  /** Directory to persist print files for later download (default: ./data/prints) */
  persistDir?: string;
  /** Callback to get the current printer name from storage */
  getPrinterNameFromStorage?: () => Promise<string | null>;
  /** Callback to get the current paper size from storage */
  getPaperSizeFromStorage?: () => Promise<string | null>;
}

const MAX_PRINT_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * Internal options with required persistDir (defaults applied)
 */
type NativePrinterInternalOptions = Omit<
  NativePrinterOptions,
  "persistDir" | "getPrinterNameFromStorage" | "getPaperSizeFromStorage"
> & {
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
  private getPrinterNameFromStorage?: () => Promise<string | null>;
  private getPaperSizeFromStorage?: () => Promise<string | null>;

  private isWindowsPlatform(): boolean {
    return process.platform === "win32";
  }

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
    const fitToPage = typeof options.fitToPage === "boolean" ? options.fitToPage : false;
    const quality =
      options.quality === "draft" || options.quality === "normal" || options.quality === "high"
        ? options.quality
        : "normal";
    const paperSize =
      typeof options.paperSize === "string" && options.paperSize.trim()
        ? options.paperSize.trim()
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
      fitToPage,
      persistDir,
    };
    this.getPrinterNameFromStorage = options.getPrinterNameFromStorage;
    this.getPaperSizeFromStorage = options.getPaperSizeFromStorage;
  }

  protected async connect(): Promise<void> {
    console.log("[NativePrinter] Loading printers module...");
    const { getPrinterByName, getDefaultPrinter } = await loadPrintersModule();
    console.log("[NativePrinter] Printers module loaded");

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
      console.log("[NativePrinter] Getting default printer...");
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

    // Determine content to write: binary for images/pdf, string for text/html/json
    const isBinaryContent =
      (job.contentType === "image" || job.contentType === "pdf") && job.binaryContent;
    const contentBuffer = isBinaryContent
      ? job.binaryContent!
      : Buffer.from(job.formattedContent ?? "", "utf8");

    if (!isBinaryContent && typeof job.formattedContent !== "string") {
      throw new Error("Invalid job.formattedContent");
    }

    const bytes = contentBuffer.length;
    if (bytes > MAX_PRINT_BYTES) {
      throw new Error(`Print content too large: ${bytes} bytes`);
    }

    // Get target printer (use saved setting if available and different from current)
    let targetPrinter = this.printer;
    if (this.getPrinterNameFromStorage) {
      const savedPrinterName = await this.getPrinterNameFromStorage();
      if (savedPrinterName && savedPrinterName !== this.printer.name) {
        const { getPrinterByName } = await loadPrintersModule();
        const savedPrinter = await getPrinterByName(savedPrinterName);
        if (savedPrinter) {
          targetPrinter = savedPrinter;
          console.log(`[NativePrinter] Using saved printer: ${savedPrinterName}`);
        } else {
          console.warn(
            `[NativePrinter] Saved printer "${savedPrinterName}" not found, using default`,
          );
        }
      }
    }

    const safeJobId = (job.id || "job")
      .replaceAll(/[^a-zA-Z0-9_-]/g, "_")
      .replaceAll(/^_+|_+$/g, "")
      .slice(0, 64);

    const ext = getFileExtension(job.contentType);
    const tempDir = await mkdtemp(join(tmpdir(), "log-dot-print-"));
    const tempFile = join(tempDir, `print-${safeJobId || "job"}${ext}`);

    try {
      // Write content: binary for images, utf8 for text/html/json
      if (isBinaryContent) {
        await writeFile(tempFile, contentBuffer, { flag: "wx" });
      } else {
        await writeFile(tempFile, job.formattedContent, { encoding: "utf8", flag: "wx" });
      }

      // Build print options
      const printOptions: SimplePrintOptions = {
        copies: this.options.copies,
        duplex: this.options.duplex,
        quality: this.options.quality,
        color: this.options.color,
        landscape: this.options.landscape,
        jobName: `log-${safeJobId}`,
      };

      // Resolve paper size: storage > config > unset
      // For printer driver, storage overrides config (higher priority)
      const storedPaperSize = this.getPaperSizeFromStorage
        ? await this.getPaperSizeFromStorage()
        : null;
      const resolved = resolvePaperSize({
        configPdfPaperSize: storedPaperSize ?? undefined,
        storedPrinterPaperSize: this.options.paperSize,
      });

      // Print the file
      if (this.isWindowsPlatform() && job.contentType === "pdf") {
        // Windows + PDF: delegate to SumatraPDF via pdf-to-printer.
        // Avoids the RAW datatype issue where PDF binary is sent directly
        // to the printer, causing metadata like %PDF-1.4 to be printed as text.
        // Pass raw paper name — CUPS normalization does not apply here.
        await printPdfWithSumatraPDF(tempFile, targetPrinter.name, this.options, resolved);
      } else {
        // Normalize paper size for CUPS / @printers/printers path
        if (resolved) {
          const normalized = normalizePaperName(resolved);
          if (normalized) {
            printOptions.paperSize = normalized;
          }
        }

        // Build CUPS options for orientation and scaling control
        type CUPSOptions = import("@printers/printers").CUPSOptions;
        const cupsOptions: Partial<CUPSOptions> = {};

        // Only send orientation-requested for standard paper names.
        // Custom dimensions (e.g. "Custom.15x11in") already encode orientation
        // via width/height, and CUPS would mis-rotate if we also set portrait.
        const resolvedIsCustomDims = printOptions.paperSize
          ? parsePaperDimensions(printOptions.paperSize) !== null
          : false;
        if (!this.options.landscape && !resolvedIsCustomDims) {
          cupsOptions["orientation-requested"] = 3; // portrait
        }
        if (!this.options.fitToPage) {
          cupsOptions["fit-to-page"] = false;
          cupsOptions["natural-scaling"] = 100;
        }

        // All other cases: use @printers/printers native printing.
        // Explicitly wait for completion before removing the temp file.
        await targetPrinter.printFile(tempFile, {
          simple: printOptions,
          cups: cupsOptions,
          waitForCompletion: true,
        });
      }

      // Persist print file (always enabled with default directory)
      await mkdir(this.options.persistDir, { recursive: true });
      const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
      const persistFile = join(this.options.persistDir, `${timestamp}_${safeJobId}${ext}`);
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
