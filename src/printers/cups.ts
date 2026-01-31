import { spawn } from "child_process";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { PrintJob, PrinterStatus, PrinterType, PrintContentType } from "../core/index.js";
import { BasePrinter } from "./base-printer.js";
import { printerRegistry } from "./registry.js";

/** Supported HTML to PDF converters */
type HtmlConverter = "wkhtmltopdf" | "weasyprint";

interface CupsPrinterOptions {
  /** Printer name (as shown in lpstat -p). If not set, uses default printer */
  printerName?: string;
  /** Additional lp options */
  lpOptions?: string[];
  /** Paper size */
  paperSize?: "a4" | "letter" | "legal" | "a5";
  /** Number of copies */
  copies?: number;
  /** Preferred HTML to PDF converter (auto-detected if not specified) */
  htmlConverter?: HtmlConverter;
}

/**
 * CUPS printer plugin
 * Uses the lp command to print to CUPS-managed printers
 */
export class CupsPrinter extends BasePrinter {
  readonly name = "cups-printer";
  readonly version = "1.0.0";
  protected readonly printerType: PrinterType = "cups";

  private options: CupsPrinterOptions;
  private printerAvailable = false;
  private detectedHtmlConverter: HtmlConverter | null = null;

  constructor(options: CupsPrinterOptions = {}) {
    super();
    this.options = {
      printerName: options.printerName,
      lpOptions: options.lpOptions ?? [],
      paperSize: options.paperSize ?? "a4",
      copies: options.copies ?? 1,
      htmlConverter: options.htmlConverter,
    };
  }

  protected async connect(): Promise<void> {
    // Check if lp command is available
    const lpAvailable = await this.checkCommand("lp");
    if (!lpAvailable) {
      throw new Error("lp command not found. CUPS may not be installed.");
    }

    // Check if printer is available
    if (this.options.printerName) {
      const printers = await this.listPrinters();
      if (!printers.includes(this.options.printerName)) {
        throw new Error(
          `Printer '${this.options.printerName}' not found. Available: ${printers.join(", ")}`,
        );
      }
    }

    this.printerAvailable = true;
    console.log(`[CupsPrinter] Connected to ${this.options.printerName || "default printer"}`);
  }

  protected async disconnect(): Promise<void> {
    this.printerAvailable = false;
    console.log("[CupsPrinter] Disconnected");
  }

  async getStatus(): Promise<PrinterStatus> {
    let ready = this.printerAvailable;
    let info: string | undefined;

    if (this.printerAvailable) {
      try {
        const status = await this.getPrinterStatus();
        ready = status.includes("idle") || status.includes("ready");
        info = status;
      } catch {
        ready = false;
        info = "Unable to get printer status";
      }
    }

    return {
      connected: this.connected,
      name: this.options.printerName || "default",
      type: this.printerType,
      ready,
      info,
    };
  }

  async print(job: PrintJob): Promise<void> {
    if (!this.printerAvailable) {
      throw new Error("Printer not connected");
    }

    const contentType: PrintContentType = job.contentType ?? "text";

    if (contentType === "html") {
      await this.printHtml(job);
    } else {
      await this.printText(job);
    }
  }

  /**
   * Print text content directly via lp command
   */
  private async printText(job: PrintJob): Promise<void> {
    const tempFile = this.getTempFilePath(job.id, "text");

    try {
      await writeFile(tempFile, job.formattedContent, "utf-8");
      await this.executeLpCommand(tempFile);
    } finally {
      await this.cleanupTempFile(tempFile);
    }
  }

  /**
   * Print HTML content by converting to PDF first
   */
  private async printHtml(job: PrintJob): Promise<void> {
    const converter = await this.detectHtmlConverter();
    if (!converter) {
      console.warn("[CupsPrinter] No HTML converter available, falling back to text printing");
      // Fall back to text printing (HTML will be printed as raw text)
      await this.printText(job);
      return;
    }

    const htmlFile = this.getTempFilePath(job.id, "html");
    const pdfFile = join(tmpdir(), `print-${job.id}.pdf`);

    try {
      // Write HTML to temp file
      await writeFile(htmlFile, job.formattedContent, "utf-8");

      // Convert HTML to PDF
      const { command, args } = this.buildPdfConversionCommand(converter, htmlFile, pdfFile);
      await this.execCommand(command, args);

      // Print the PDF
      await this.executeLpCommand(pdfFile);
    } finally {
      // Clean up temp files
      await this.cleanupTempFile(htmlFile);
      await this.cleanupTempFile(pdfFile);
    }
  }

  /**
   * Get temp file path with appropriate extension
   */
  private getTempFilePath(jobId: string, contentType: PrintContentType): string {
    const ext = contentType === "html" ? "html" : "txt";
    return join(tmpdir(), `print-${jobId}.${ext}`);
  }

  /**
   * Execute lp command to print a file
   */
  private async executeLpCommand(filePath: string): Promise<void> {
    const args: string[] = [];

    if (this.options.printerName) {
      args.push("-d", this.options.printerName);
    }

    args.push("-n", String(this.options.copies));

    if (this.options.paperSize) {
      args.push("-o", `media=${this.options.paperSize}`);
    }

    // Add custom options
    for (const opt of this.options.lpOptions ?? []) {
      args.push("-o", opt);
    }

    args.push(filePath);

    await this.execCommand("lp", args);
  }

  /**
   * Clean up a temp file, ignoring errors
   */
  private async cleanupTempFile(filePath: string): Promise<void> {
    try {
      await unlink(filePath);
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Detect available HTML to PDF converter
   */
  private async detectHtmlConverter(): Promise<HtmlConverter | null> {
    // Return cached result if available
    if (this.detectedHtmlConverter) {
      return this.detectedHtmlConverter;
    }

    // Use configured converter if specified
    if (this.options.htmlConverter) {
      const available = await this.checkCommand(this.options.htmlConverter);
      if (available) {
        this.detectedHtmlConverter = this.options.htmlConverter;
        return this.detectedHtmlConverter;
      }
      console.warn(`[CupsPrinter] Configured converter '${this.options.htmlConverter}' not found`);
    }

    // Auto-detect: prefer wkhtmltopdf for speed, fall back to weasyprint
    const converters: HtmlConverter[] = ["wkhtmltopdf", "weasyprint"];
    for (const converter of converters) {
      const available = await this.checkCommand(converter);
      if (available) {
        this.detectedHtmlConverter = converter;
        console.log(`[CupsPrinter] Using HTML converter: ${converter}`);
        return converter;
      }
    }

    return null;
  }

  /**
   * Build command for HTML to PDF conversion
   */
  private buildPdfConversionCommand(
    converter: HtmlConverter,
    inputPath: string,
    outputPath: string,
  ): { command: string; args: string[] } {
    if (converter === "wkhtmltopdf") {
      return {
        command: "wkhtmltopdf",
        args: [
          "--quiet",
          "--enable-local-file-access",
          "--page-size",
          this.options.paperSize?.toUpperCase() ?? "A4",
          inputPath,
          outputPath,
        ],
      };
    }

    // weasyprint
    return {
      command: "weasyprint",
      args: [inputPath, outputPath],
    };
  }

  /**
   * List available printers
   */
  async listPrinters(): Promise<string[]> {
    try {
      const output = await this.execCommand("lpstat", ["-p"]);
      const lines = output.split("\n");
      const printers: string[] = [];

      for (const line of lines) {
        const match = line.match(/^printer\s+(\S+)/);
        if (match) {
          printers.push(match[1]);
        }
      }

      return printers;
    } catch {
      return [];
    }
  }

  private async getPrinterStatus(): Promise<string> {
    const printer = this.options.printerName || (await this.getDefaultPrinter());
    if (!printer) {
      return "No printer configured";
    }

    const output = await this.execCommand("lpstat", ["-p", printer]);
    return output.trim();
  }

  private async getDefaultPrinter(): Promise<string | null> {
    try {
      const output = await this.execCommand("lpstat", ["-d"]);
      const match = output.match(/destination:\s*(\S+)/);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }

  private async checkCommand(cmd: string): Promise<boolean> {
    try {
      await this.execCommand("which", [cmd]);
      return true;
    } catch {
      return false;
    }
  }

  private execCommand(cmd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args);
      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(stderr || `Command failed with code ${code}`));
        }
      });

      proc.on("error", reject);
    });
  }
}

/**
 * Factory function for creating CupsPrinter instances
 */
export function createCupsPrinter(options: Record<string, unknown>): CupsPrinter {
  return new CupsPrinter({
    printerName: typeof options.printerName === "string" ? options.printerName : undefined,
    lpOptions: Array.isArray(options.lpOptions) ? options.lpOptions : undefined,
    paperSize:
      typeof options.paperSize === "string"
        ? (options.paperSize as CupsPrinterOptions["paperSize"])
        : undefined,
    copies: typeof options.copies === "number" ? options.copies : undefined,
    htmlConverter:
      typeof options.htmlConverter === "string"
        ? (options.htmlConverter as HtmlConverter)
        : undefined,
  });
}

/**
 * Register the CUPS printer plugin
 */
export function register(): void {
  printerRegistry.register("cups", createCupsPrinter);
}

// Auto-register when imported
register();
