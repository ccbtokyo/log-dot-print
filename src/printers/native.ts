/**
 * NativePrinter - Cross-platform printer using @printers/printers
 *
 * Related: src/printers/base-printer.ts (BasePrinter)
 *          src/printers/discovery.ts (PrinterDiscoveryService)
 *          src/core/types.ts (PrintJob, PrinterType, PrinterStatus)
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyFile, mkdir, mkdtemp, rm, writeFile, access } from "node:fs/promises";

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
 * SumatraPDF version and download URL.
 * Version 3.5+ is required for the `disable-auto-rotation` print setting.
 */
const SUMATRA_VERSION = "3.5.2";
const SUMATRA_DOWNLOAD_URL = `https://www.sumatrapdfreader.org/dl/rel/${SUMATRA_VERSION}/SumatraPDF-${SUMATRA_VERSION}-64.zip`;
const SUMATRA_DEFAULT_DIR = "./bin";
const SUMATRA_EXE_NAME = `SumatraPDF-${SUMATRA_VERSION}-64.exe`;

/**
 * Ensure SumatraPDF 3.5+ is available locally.
 * Downloads and extracts the portable exe if not found.
 * @returns Absolute path to the SumatraPDF executable
 */
async function ensureSumatraPdf(customPath?: string): Promise<string> {
  // Use custom path if provided and exists
  if (customPath) {
    try {
      await access(customPath);
      console.log(`[NativePrinter] Using custom SumatraPDF: ${customPath}`);
      return customPath;
    } catch {
      console.warn(`[NativePrinter] Custom SumatraPDF not found: ${customPath}, will download`);
    }
  }

  // Check default location
  const defaultPath = join(SUMATRA_DEFAULT_DIR, SUMATRA_EXE_NAME);
  try {
    await access(defaultPath);
    console.log(`[NativePrinter] SumatraPDF ${SUMATRA_VERSION} found: ${defaultPath}`);
    return defaultPath;
  } catch {
    // Not found, download
  }

  console.log(`[NativePrinter] Downloading SumatraPDF ${SUMATRA_VERSION}...`);
  await mkdir(SUMATRA_DEFAULT_DIR, { recursive: true });

  const response = await fetch(SUMATRA_DOWNLOAD_URL);
  if (!response.ok) {
    throw new Error(`Failed to download SumatraPDF: ${response.status} ${response.statusText}`);
  }

  const zipBuffer = Buffer.from(await response.arrayBuffer());
  const tempZip = join(SUMATRA_DEFAULT_DIR, `sumatra-${SUMATRA_VERSION}.zip`);
  await writeFile(tempZip, zipBuffer);

  // Extract using Bun.spawn (tar can handle zip on Windows with PowerShell)
  const proc = Bun.spawn(
    [
      "powershell",
      "-Command",
      `Expand-Archive -Path '${tempZip}' -DestinationPath '${SUMATRA_DEFAULT_DIR}' -Force`,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [exitCode, , stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  // Clean up zip
  await rm(tempZip, { force: true });

  if (exitCode !== 0) {
    throw new Error(`Failed to extract SumatraPDF: ${stderr}`);
  }

  // Verify the exe exists
  try {
    await access(defaultPath);
  } catch {
    throw new Error(`SumatraPDF exe not found after extraction: ${defaultPath}`);
  }

  console.log(`[NativePrinter] SumatraPDF ${SUMATRA_VERSION} downloaded to ${defaultPath}`);
  return defaultPath;
}

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
 * Build SumatraPDF `-print-settings` string from options.
 * Called directly instead of pdf-to-printer to avoid unknown intermediary
 * transformations that caused width compression on some machines.
 * @internal Exported for testing.
 */
export function buildSumatraSettings(
  options: NativePrinterInternalOptions,
  rawPaperSize?: string,
): string {
  const settings: string[] = [];

  // Disable auto-rotation to prevent SumatraPDF from rotating landscape PDFs
  // (pSize.dx > pSize.dy) an additional 90° (see sumatrapdfreader/sumatrapdf#2353)
  settings.push("disable-auto-rotation");

  // Orientation: only send "landscape" when explicitly configured.
  // Do NOT send "portrait" — it can cause spooler hangs on continuous-feed printers.
  if (options.landscape) {
    settings.push("landscape");
  }

  // Scale
  settings.push(options.fitToPage ? "fit" : "noscale");

  // Color / monochrome — must match the driver's color setting.
  // Omitting this causes coarse resolution when the driver is set to color mode.
  settings.push(options.color ? "color" : "monochrome");

  // Copies
  const copies = options.copies ?? 1;
  settings.push(`${copies}x`);

  // Duplex
  if (options.duplex) {
    settings.push("duplex");
  }

  // Bin (paper tray)
  if (options.bin) {
    settings.push(`bin=${options.bin}`);
  }

  // Paper size: paperKind takes precedence over paper name.
  // paperKind sets DEVMODE dmPaperSize directly.
  // paper= and paperkind= must NOT both be sent — SumatraPDF resolves
  // paper= name first, producing an incorrect render size (width compression).
  if (options.paperKind) {
    settings.push(`paperkind=${options.paperKind}`);
  } else if (rawPaperSize && !rawPaperSize.startsWith("Custom.")) {
    settings.push(`paper=${rawPaperSize}`);
  }

  return settings.join(",");
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
  /** Paper tray/bin number (SumatraPDF bin= parameter, Windows only) */
  bin?: string;
  /** Windows DEVMODE dmPaperSize number (SumatraPDF paperkind= parameter, Windows only) */
  paperKind?: number;
  /** Custom path to SumatraPDF executable (Windows only, requires 3.5+ for disable-auto-rotation) */
  sumatraPdfPath?: string;
  /** Simulate mode: skip actual printing but still persist files (env: PRINTERS_JS_SIMULATE) */
  simulate?: boolean;
  /** Directory to persist print files for later download (default: ./data/prints) */
  persistDir?: string;
  /** Callback to get the current printer name from storage */
  getPrinterNameFromStorage?: () => Promise<string | null>;
  /** Callback to get the current paper size from storage */
  getPaperSizeFromStorage?: () => Promise<string | null>;
  /** Callback to get the current paper kind (DEVMODE dmPaperSize) from storage */
  getPaperKindFromStorage?: () => Promise<number | null>;
}

const MAX_PRINT_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * Internal options with required persistDir (defaults applied)
 */
type NativePrinterInternalOptions = Omit<
  NativePrinterOptions,
  "persistDir" | "getPrinterNameFromStorage" | "getPaperSizeFromStorage" | "getPaperKindFromStorage"
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
  private resolvedSumatraPdfPath: string | undefined;
  private getPrinterNameFromStorage?: () => Promise<string | null>;
  private getPaperSizeFromStorage?: () => Promise<string | null>;
  private getPaperKindFromStorage?: () => Promise<number | null>;

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
    const bin =
      typeof options.bin === "string" && options.bin.trim() ? options.bin.trim() : undefined;
    const paperKind =
      typeof options.paperKind === "number" &&
      Number.isFinite(options.paperKind) &&
      Number.isInteger(options.paperKind) &&
      options.paperKind > 0
        ? options.paperKind
        : undefined;
    const sumatraPdfPath =
      typeof options.sumatraPdfPath === "string" && options.sumatraPdfPath.trim()
        ? options.sumatraPdfPath.trim()
        : undefined;
    const simulate = typeof options.simulate === "boolean" ? options.simulate : false;
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
      bin,
      paperKind,
      sumatraPdfPath,
      simulate,
      persistDir,
    };
    this.getPrinterNameFromStorage = options.getPrinterNameFromStorage;
    this.getPaperSizeFromStorage = options.getPaperSizeFromStorage;
    this.getPaperKindFromStorage = options.getPaperKindFromStorage;
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

    // On Windows, ensure SumatraPDF 3.5+ is available for disable-auto-rotation support
    if (this.isWindowsPlatform()) {
      try {
        this.resolvedSumatraPdfPath = await ensureSumatraPdf(this.options.sumatraPdfPath);
      } catch (error) {
        console.warn("[NativePrinter] Failed to ensure SumatraPDF 3.5+:", error);
        console.warn("[NativePrinter] Falling back to pdf-to-printer bundled SumatraPDF (3.4.6)");
      }

      // Fix asymmetric DPI and dump DEVMODE for debugging.
      // Session 0 (Windows services) may have different DEVMODE defaults
      // than the interactive session (e.g. 360x180 instead of 180x180).
      if (this.printer) {
        await this.ensureSymmetricDpi(this.printer.name);
        this.dumpDevmode(this.printer.name).catch((err) =>
          console.warn("[NativePrinter] DEVMODE dump failed:", err),
        );
      }
    }
  }

  /**
   * Ensure the printer has symmetric DPI (e.g. 180x180).
   * Session 0 may have asymmetric defaults (360x180) causing 50% width
   * compression in SumatraPDF. Set-PrintConfiguration persists the fix.
   */
  private async ensureSymmetricDpi(printerName: string): Promise<void> {
    const psCommand = `
      $config = Get-PrintConfiguration -PrinterName '${printerName}' -ErrorAction Stop
      [xml]$ticket = $config.PrintTicketXml
      $nsm = New-Object Xml.XmlNamespaceManager($ticket.NameTable)
      $nsm.AddNamespace('psf','http://schemas.microsoft.com/windows/2003/08/printing/printschemaframework')
      $nsm.AddNamespace('psk','http://schemas.microsoft.com/windows/2003/08/printing/printschemakeywords')
      $xNode = $ticket.SelectSingleNode("//psf:Feature[@name='psk:PageResolution']//psf:ScoredProperty[@name='psk:ResolutionX']/psf:Value", $nsm)
      $yNode = $ticket.SelectSingleNode("//psf:Feature[@name='psk:PageResolution']//psf:ScoredProperty[@name='psk:ResolutionY']/psf:Value", $nsm)
      if ($xNode -and $yNode) {
        $x = [int]$xNode.InnerText; $y = [int]$yNode.InnerText
        Write-Host "DPI: $($x)x$($y)"
        if ($x -ne $y) {
          $target = [Math]::Min($x,$y)
          $xNode.InnerText = "$target"; $yNode.InnerText = "$target"
          Set-PrintConfiguration -PrinterName '${printerName}' -PrintTicketXml $ticket.OuterXml -ErrorAction Stop
          Write-Host "Fixed: $($x)x$($y) -> $($target)x$($target)"
        }
      }
    `;
    const proc = Bun.spawn(
      ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psCommand],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    for (const line of stdout.trim().split("\n").filter(Boolean)) {
      console.log(`[NativePrinter] ${line.trim()}`);
    }
    if (exitCode !== 0 && stderr.trim()) {
      console.warn(`[NativePrinter] DPI fix failed: ${stderr.trim()}`);
    }
  }

  /**
   * Dump printer DEVMODE via PowerShell for debugging Session 0 differences.
   */
  private async dumpDevmode(printerName: string): Promise<void> {
    const scriptPath = join(process.cwd(), "scripts", "debug-devmode.ps1");
    const proc = Bun.spawn(
      [
        "powershell",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        "-PrinterName",
        printerName,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    if (stdout.trim()) {
      for (const line of stdout.trim().split("\n")) {
        console.log(`[DEVMODE] ${line.trimEnd()}`);
      }
    }
    if (stderr.trim()) {
      for (const line of stderr.trim().split("\n")) {
        console.warn(`[DEVMODE] ${line.trimEnd()}`);
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

  /**
   * Print a PDF via SumatraPDF directly (bypassing pdf-to-printer).
   * Protected so tests can override it.
   */
  protected async printPdfViaSumatraPDF(
    filePath: string,
    printerName: string,
    options: NativePrinterInternalOptions,
    rawPaperSize?: string,
  ): Promise<void> {
    const sumatraPath = options.sumatraPdfPath;
    if (!sumatraPath) {
      throw new Error("SumatraPDF path is required for Windows PDF printing");
    }

    const settings = buildSumatraSettings(options, rawPaperSize);

    const printStart = Date.now();
    console.log(
      `[NativePrinter] Submitting PDF to spooler via SumatraPDF: ${filePath} (printer=${printerName})`,
    );
    console.log(`[NativePrinter] SumatraPDF settings: ${settings}`);

    // Use scripts/sumatra-print.ps1 wrapper to:
    // 1. Fix asymmetric DPI (Session 0 may have 360x180 default, causing 50% width compression)
    // 2. Call SumatraPDF via PowerShell & operator (matches interactive CLI behavior)
    const scriptPath = join(process.cwd(), "scripts", "sumatra-print.ps1");
    const proc = Bun.spawn(
      [
        "powershell",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        "-SumatraPath",
        sumatraPath,
        "-PrinterName",
        printerName,
        "-Settings",
        settings,
        "-FilePath",
        filePath,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    // Log script output (includes DPI check results)
    if (stdout.trim()) {
      for (const line of stdout.trim().split("\n")) {
        console.log(`[NativePrinter] ${line.trim()}`);
      }
    }
    if (stderr.trim()) {
      for (const line of stderr.trim().split("\n")) {
        console.warn(`[NativePrinter] ${line.trim()}`);
      }
    }

    const elapsed = Date.now() - printStart;
    if (exitCode !== 0) {
      throw new Error(`sumatra-print.ps1 exited with code ${exitCode}: ${stderr}`);
    }
    console.log(`[NativePrinter] Spooler accepted in ${elapsed}ms`);
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

      // Resolve paperKind: storage > constructor > undefined
      const storagePaperKind = this.getPaperKindFromStorage
        ? await this.getPaperKindFromStorage()
        : null;
      const resolvedPaperKind = storagePaperKind ?? this.options.paperKind;
      const effectiveOptions: NativePrinterInternalOptions = resolvedPaperKind
        ? { ...this.options, paperKind: resolvedPaperKind }
        : this.options;

      // Check simulate mode: env var overrides config
      const isSimulate =
        process.env.PRINTERS_JS_SIMULATE === "true" || this.options.simulate === true;

      // Persist print file FIRST (always enabled with default directory).
      // On Windows, printing from TEMP can fail due to antivirus file locks
      // or delayed flush. Persisting first ensures a stable file for SumatraPDF.
      await mkdir(this.options.persistDir, { recursive: true });
      const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
      const persistFile = join(this.options.persistDir, `${timestamp}_${safeJobId}${ext}`);
      await copyFile(tempFile, persistFile);
      job.filePath = persistFile;
      console.log(`[NativePrinter] Print file persisted: ${persistFile}`);

      // Determine which file to print from:
      // Windows PDF uses the persisted file (avoids TEMP issues);
      // all other paths use the temp file (cleaned up in finally block).
      const printFile =
        this.isWindowsPlatform() && job.contentType === "pdf" ? persistFile : tempFile;

      // Print the file (skip in simulate mode)
      if (isSimulate) {
        console.log(`[NativePrinter] Simulate mode: skipping actual print for ${job.id}`);
      } else if (this.isWindowsPlatform() && job.contentType === "pdf") {
        // Windows + PDF: delegate to SumatraPDF directly.
        // Avoids the RAW datatype issue where PDF binary is sent directly
        // to the printer, causing metadata like %PDF-1.4 to be printed as text.
        // Pass raw paper name — CUPS normalization does not apply here.
        const optionsWithSumatra = this.resolvedSumatraPdfPath
          ? { ...effectiveOptions, sumatraPdfPath: this.resolvedSumatraPdfPath }
          : effectiveOptions;
        await this.printPdfViaSumatraPDF(
          printFile,
          targetPrinter.name,
          optionsWithSumatra,
          resolved,
        );
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
        await targetPrinter.printFile(printFile, {
          simple: printOptions,
          cups: cupsOptions,
          waitForCompletion: true,
        });
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
