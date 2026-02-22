/**
 * PdfToPrinterPrinter - Windows printer using pdf-to-printer (SumatraPDF)
 *
 * Related: src/printers/base-printer.ts (BasePrinter)
 *          src/printers/native.ts (NativePrinter - similar pattern)
 *          src/core/types.ts (PrintJob, PrinterType, PrinterStatus)
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

import { BasePrinter } from "./base-printer.js";
import { printerRegistry } from "./registry.js";
import type { PrintJob, PrinterType, PrinterStatus, PrintContentType } from "../core/types.js";

type PdfToPrinterModule = typeof import("pdf-to-printer");

let pdfToPrinterModule: PdfToPrinterModule | null = null;

async function loadPdfToPrinterModule(): Promise<PdfToPrinterModule> {
  if (!pdfToPrinterModule) {
    pdfToPrinterModule = await import("pdf-to-printer");
  }
  return pdfToPrinterModule;
}

const DEFAULT_PERSIST_DIR = "./data/prints";

function getFileExtension(contentType?: PrintContentType): string {
  switch (contentType) {
    case "pdf":
      return ".pdf";
    case "image":
      return ".png";
    default:
      return ".pdf";
  }
}

export interface PdfToPrinterOptions {
  printerName?: string;
  copies?: number;
  orientation?: "portrait" | "landscape";
  scale?: "noscale" | "shrink" | "fit";
  monochrome?: boolean;
  silent?: boolean;
  paperSize?: string;
  side?: string;
  bin?: string;
  sumatraPdfPath?: string;
  persistDir?: string;
  getPrinterNameFromStorage?: () => Promise<string | null>;
}

const MAX_PRINT_BYTES = 10 * 1024 * 1024; // 10MB

type PdfToPrinterInternalOptions = Omit<
  PdfToPrinterOptions,
  "persistDir" | "getPrinterNameFromStorage"
> & {
  persistDir: string;
};

export class PdfToPrinterPrinter extends BasePrinter {
  readonly name = "pdf-to-printer";
  readonly version = "1.0.0";
  protected readonly printerType: PrinterType = "pdf-to-printer";

  private options: PdfToPrinterInternalOptions;
  private resolvedPrinterName: string | null = null;
  private printerAvailable = false;
  private getPrinterNameFromStorage?: () => Promise<string | null>;

  constructor(options: PdfToPrinterOptions = {}) {
    super();
    const printerName =
      typeof options.printerName === "string" ? options.printerName.trim() : undefined;
    const copies =
      typeof options.copies === "number" && Number.isFinite(options.copies) && options.copies > 0
        ? Math.trunc(options.copies)
        : 1;
    const orientation =
      options.orientation === "portrait" || options.orientation === "landscape"
        ? options.orientation
        : "portrait";
    const scale =
      options.scale === "noscale" || options.scale === "shrink" || options.scale === "fit"
        ? options.scale
        : "noscale";
    const monochrome = typeof options.monochrome === "boolean" ? options.monochrome : true;
    const silent = typeof options.silent === "boolean" ? options.silent : true;
    const paperSize =
      typeof options.paperSize === "string" && options.paperSize.trim()
        ? options.paperSize.trim()
        : undefined;
    const side =
      typeof options.side === "string" && options.side.trim() ? options.side.trim() : undefined;
    const bin =
      typeof options.bin === "string" && options.bin.trim() ? options.bin.trim() : undefined;
    const sumatraPdfPath =
      typeof options.sumatraPdfPath === "string" && options.sumatraPdfPath.trim()
        ? options.sumatraPdfPath.trim()
        : undefined;
    const persistDir =
      typeof options.persistDir === "string" && options.persistDir.trim()
        ? options.persistDir.trim()
        : DEFAULT_PERSIST_DIR;

    this.options = {
      printerName: printerName || undefined,
      copies,
      orientation,
      scale,
      monochrome,
      silent,
      paperSize,
      side,
      bin,
      sumatraPdfPath,
      persistDir,
    };
    this.getPrinterNameFromStorage = options.getPrinterNameFromStorage;
  }

  protected async connect(): Promise<void> {
    console.log("[PdfToPrinter] Loading pdf-to-printer module...");
    const { getPrinters, getDefaultPrinter } = await loadPdfToPrinterModule();
    console.log("[PdfToPrinter] Module loaded");

    if (this.options.printerName) {
      const printers = await getPrinters();
      const found = printers.find((p) => p.name === this.options.printerName);
      if (!found) {
        throw new Error(`Printer not found: "${this.options.printerName}"`);
      }
      this.resolvedPrinterName = found.name;
      this.printerAvailable = true;
      console.log(`[PdfToPrinter] Connected to ${found.name}`);
    } else {
      console.log("[PdfToPrinter] Getting default printer...");
      const defaultPrinter = await getDefaultPrinter();
      if (defaultPrinter) {
        this.resolvedPrinterName = defaultPrinter.name;
        this.printerAvailable = true;
        console.log(`[PdfToPrinter] Connected to ${defaultPrinter.name}`);
      } else {
        this.resolvedPrinterName = null;
        this.printerAvailable = false;
        console.warn("[PdfToPrinter] No default printer available - running in degraded mode");
      }
    }
  }

  protected async disconnect(): Promise<void> {
    this.resolvedPrinterName = null;
    this.printerAvailable = false;
    console.log("[PdfToPrinter] Disconnected");
  }

  async getStatus(): Promise<PrinterStatus> {
    return {
      connected: this.connected,
      name: this.resolvedPrinterName ?? this.options.printerName ?? "default",
      type: this.printerType,
      ready: this.printerAvailable,
    };
  }

  async print(job: PrintJob): Promise<void> {
    if (!this.printerAvailable) {
      throw new Error("Printer not connected");
    }

    const contentType = job.contentType ?? "text";

    if (contentType !== "pdf" && contentType !== "image") {
      throw new Error(
        `pdf-to-printer only supports PDF and image content. Got "${contentType}". ` +
          "Enable PDF conversion (conversion.enabled=true, conversion.format='pdf') to convert HTML/text to PDF first.",
      );
    }

    if (!job.binaryContent) {
      throw new Error("binaryContent is required for pdf-to-printer");
    }

    const bytes = job.binaryContent.length;
    if (bytes > MAX_PRINT_BYTES) {
      throw new Error(`Print content too large: ${bytes} bytes`);
    }

    // Resolve printer name: storage callback > options > connected default
    let targetPrinterName = this.resolvedPrinterName;
    if (this.getPrinterNameFromStorage) {
      const savedName = await this.getPrinterNameFromStorage();
      if (savedName) {
        targetPrinterName = savedName;
        console.log(`[PdfToPrinter] Using saved printer: ${savedName}`);
      }
    }

    const safeJobId = (job.id || "job")
      .replaceAll(/[^a-zA-Z0-9_-]/g, "_")
      .replaceAll(/^_+|_+$/g, "")
      .slice(0, 64);

    const ext = getFileExtension(contentType);
    const tempDir = await mkdtemp(join(tmpdir(), "log-dot-print-ptp-"));
    const tempFile = join(tempDir, `print-${safeJobId || "job"}${ext}`);

    try {
      await writeFile(tempFile, job.binaryContent, { flag: "wx" });

      const { print: ptpPrint } = await loadPdfToPrinterModule();

      const printOptions: import("pdf-to-printer").PrintOptions = {};
      if (targetPrinterName) printOptions.printer = targetPrinterName;
      if (this.options.copies !== 1) printOptions.copies = this.options.copies;
      if (this.options.orientation) printOptions.orientation = this.options.orientation;
      if (this.options.scale) printOptions.scale = this.options.scale;
      if (this.options.monochrome !== undefined) printOptions.monochrome = this.options.monochrome;
      if (this.options.silent !== undefined) printOptions.silent = this.options.silent;
      if (this.options.paperSize) printOptions.paperSize = this.options.paperSize;
      if (this.options.side) printOptions.side = this.options.side;
      if (this.options.bin) printOptions.bin = this.options.bin;
      if (this.options.sumatraPdfPath) printOptions.sumatraPdfPath = this.options.sumatraPdfPath;

      await ptpPrint(tempFile, printOptions);

      // Persist print file
      await mkdir(this.options.persistDir, { recursive: true });
      const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
      const persistFile = join(this.options.persistDir, `${timestamp}_${safeJobId}${ext}`);
      await copyFile(tempFile, persistFile);
      job.filePath = persistFile;
      console.log(`[PdfToPrinter] Print file persisted: ${persistFile}`);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

function createPdfToPrinterPrinter(options: Record<string, unknown>): PdfToPrinterPrinter {
  return new PdfToPrinterPrinter(options as PdfToPrinterOptions);
}

export function register(): void {
  printerRegistry.register("pdf-to-printer", createPdfToPrinterPrinter);
}

export async function tryRegister(): Promise<boolean> {
  try {
    await import("pdf-to-printer");
    register();
    console.log("[PdfToPrinter] Registered successfully");
    return true;
  } catch {
    console.log("[PdfToPrinter] pdf-to-printer not available, skipping registration");
    return false;
  }
}
