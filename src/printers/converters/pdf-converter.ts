/**
 * PdfConverter - HTML to PDF conversion using Playwright
 *
 * Converts HTML content to PDF for high-quality printing with full CSS and
 * @font-face support. Shares the same Playwright (Chromium) infrastructure
 * as ImageConverter.
 *
 * On Windows, uses Node.js subprocess to work around Bun + Playwright issue:
 * https://github.com/oven-sh/bun/issues/23826
 *
 * @related src/printers/converters/image-converter.ts (ImageConverter - shared Playwright infra)
 * @related src/printers/converters/subprocess-utils.ts (isWindows, getHelperScriptPath)
 * @related src/printers/native.ts (NativePrinter)
 * @related src/printers/replay-formatter.ts (ReplayFormatter)
 * @related src/core/types.ts (ImageConversionConfig)
 * @related src/printers/paper-size-resolver.ts (paperNameToCssPageSize, parsePaperDimensions)
 * @related scripts/playwright-render-pdf.cjs (Windows subprocess helper)
 */

import { parsePaperDimensions } from "../paper-size-resolver.js";
import { isWindows, getHelperScriptPath, isNodeAvailable } from "./subprocess-utils.js";

// Playwright types (dynamic import - playwright is optional)
type Browser = {
  newPage(): Promise<Page>;
  close(): Promise<void>;
};

type Page = {
  setContent(html: string, options?: { waitUntil?: string }): Promise<void>;
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  evaluate<T>(fn: () => T): Promise<T>;
  pdf(options?: Record<string, unknown>): Promise<Buffer>;
  close(): Promise<void>;
};

type BrowserType = {
  launch(options?: Record<string, unknown>): Promise<Browser>;
};

type PlaywrightModule = {
  chromium: BrowserType;
};

let playwrightModule: PlaywrightModule | null = null;

/**
 * Load playwright module dynamically
 */
async function loadPlaywrightModule(): Promise<PlaywrightModule> {
  if (playwrightModule) {
    return playwrightModule;
  }

  try {
    const moduleName = "playwright";
    console.log("[PdfConverter] Loading playwright module...");
    playwrightModule = (await import(moduleName)) as PlaywrightModule;
    console.log("[PdfConverter] Playwright module loaded");
    return playwrightModule;
  } catch (error) {
    console.error("[PdfConverter] Failed to load playwright:", error);
    throw new Error("playwright is not installed", { cause: error });
  }
}

/**
 * Content-fit options for dynamic PDF height based on content measurement.
 * Used for continuous paper (fan-fold) printing where paper waste should be minimized.
 */
export interface ContentFitOptions {
  /** Paper width in inches */
  widthIn: number;
  /** Maximum page height in inches (default: 11) */
  maxHeightIn?: number;
}

/**
 * Options for PDF conversion
 */
export interface PdfConverterOptions {
  /** Paper size for PDF output (default: "A4") */
  paperSize?: string;
  /** Crop PDF height to fit content (default: false). Only works with Custom paper sizes. */
  cropToContent?: boolean;
  /** Content-fit mode: measure content height and generate a dynamically-sized PDF */
  contentFit?: ContentFitOptions;
  /** Generate landscape PDF (default: false = portrait) */
  landscape?: boolean;
}

const DEFAULT_OPTIONS: Required<Omit<PdfConverterOptions, "contentFit">> = {
  paperSize: "A4",
  cropToContent: false,
  landscape: false,
};

/** CSS pixels per inch (Chromium default) */
const CSS_PX_PER_INCH = 96;

/** mm per inch */
const MM_PER_INCH = 25.4;

/**
 * Render HTML to PDF using Node.js subprocess (for Windows)
 */
async function renderPdfViaSubprocess(
  html: string,
  options: {
    paperSize?: string;
    cropToContent?: boolean;
    paperWidth?: number;
    paperHeight?: number;
    paperUnit?: string;
    contentFit?: ContentFitOptions;
    landscape?: boolean;
  },
): Promise<Buffer> {
  const scriptPath = getHelperScriptPath("pdf");
  console.log(`[PdfConverter] Using Node.js subprocess for Windows: ${scriptPath}`);

  const input = JSON.stringify({ html, ...options });

  const proc = Bun.spawn(["node", scriptPath], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  proc.stdin.write(input);
  proc.stdin.flush();
  proc.stdin.end();

  // Read stdout/stderr concurrently with process exit to avoid pipe deadlock.
  // If stdout/stderr buffers fill up while we only await proc.exited,
  // the subprocess blocks on write and never exits → deadlock.
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  if (stderr) {
    console.error("[PdfConverter] Subprocess stderr:", stderr);
  }

  if (exitCode !== 0) {
    throw new Error(`Node.js subprocess failed with exit code ${exitCode}: ${stderr || stdout}`);
  }

  let response;
  try {
    response = JSON.parse(stdout);
  } catch {
    throw new Error(`Invalid JSON response from subprocess: ${stdout}`);
  }

  if (!response.success) {
    throw new Error(`Subprocess rendering failed: ${response.error}`);
  }

  return Buffer.from(response.pdf, "base64");
}

/**
 * Convert a CSS length value to pixels at 96 DPI.
 */
export function cssUnitToPixels(value: number, unit: "in" | "mm"): number {
  return unit === "in" ? value * CSS_PX_PER_INCH : (value / MM_PER_INCH) * CSS_PX_PER_INCH;
}

/**
 * HTML to PDF converter using Playwright
 *
 * Uses headless Chromium to render HTML and generate PDF via page.pdf().
 * Supports full CSS including @font-face for custom font embedding.
 */
export class PdfConverter {
  private browser: Browser | null = null;
  private options: Required<Omit<PdfConverterOptions, "contentFit">>;
  private initPromise: Promise<void> | null = null;
  private useSubprocess: boolean;

  constructor(options: Partial<PdfConverterOptions> = {}) {
    this.options = {
      paperSize: options.paperSize ?? DEFAULT_OPTIONS.paperSize,
      cropToContent: options.cropToContent ?? DEFAULT_OPTIONS.cropToContent,
      landscape: options.landscape ?? DEFAULT_OPTIONS.landscape,
    };
    this.useSubprocess = isWindows();

    if (this.useSubprocess) {
      console.log("[PdfConverter] Windows detected, will use Node.js subprocess for Playwright");
    }
  }

  /**
   * Initialize the converter (launches browser)
   * On Windows with subprocess mode, this is a no-op since browser is launched per-render
   */
  async initialize(): Promise<void> {
    if (this.useSubprocess) {
      console.log("[PdfConverter] Subprocess mode - skipping browser initialization");
      return;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.doInitialize();
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    if (this.browser) {
      return;
    }

    const playwright = await loadPlaywrightModule();
    console.log("[PdfConverter] Launching Chromium browser...");

    const launchTimeout = 30000;
    const launchPromise = playwright.chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(
          new Error(
            `Browser launch timed out after ${launchTimeout}ms. Chromium may not be installed correctly. Run: npx playwright install chromium`,
          ),
        );
      }, launchTimeout);
    });

    try {
      this.browser = await Promise.race([launchPromise, timeoutPromise]);
      console.log("[PdfConverter] Browser launched");
    } catch (error) {
      console.error("[PdfConverter] Failed to launch browser:", error);
      throw error;
    }
  }

  /**
   * Shutdown the converter (closes browser)
   */
  async shutdown(): Promise<void> {
    if (this.useSubprocess) {
      // No persistent browser to close in subprocess mode
      return;
    }

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.initPromise = null;
      console.log("[PdfConverter] Browser closed");
    }
  }

  /**
   * Convert HTML content to PDF
   *
   * @param html - HTML content to convert
   * @param options - Optional override options for this conversion
   * @returns PDF buffer
   */
  async convert(html: string, options?: Partial<PdfConverterOptions>): Promise<Buffer> {
    const paperSize = options?.paperSize ?? this.options.paperSize;
    const cropToContent = options?.cropToContent ?? this.options.cropToContent;
    const landscape = options?.landscape ?? this.options.landscape;

    if (this.useSubprocess) {
      return this.convertViaSubprocess(
        html,
        paperSize,
        cropToContent,
        landscape,
        options?.contentFit,
      );
    }

    if (!this.browser) {
      await this.initialize();
    }

    if (!this.browser) {
      throw new Error("Browser not initialized");
    }

    // Content-fit mode: measure content and generate dynamically-sized PDF
    if (options?.contentFit) {
      return this.convertContentFit(html, options.contentFit, landscape);
    }

    let page: Page | null = null;
    try {
      page = await this.browser.newPage();

      // For cropToContent, set viewport width to match paper width for accurate measurement
      const dims = parsePaperDimensions(paperSize);
      if (cropToContent && dims) {
        const widthPx = Math.round(cssUnitToPixels(dims.width, dims.unit));
        await page.setViewportSize({ width: widthPx, height: 800 });
      }

      // Load HTML content
      // In cropToContent mode, neutralize @page CSS to prevent Chromium from
      // scaling content when the CSS page size differs from the dynamic PDF size.
      await page.setContent(cropToContent ? this.neutralizePageCss(html) : html, {
        waitUntil: "networkidle",
      });

      // Wait for fonts to load (runs in browser context)
      await page.evaluate(() => (globalThis as any).document.fonts.ready);

      // Crop mode: measure content height and use dynamic page height
      if (cropToContent && dims) {
        const contentHeightPx = await page.evaluate(
          () => (globalThis as any).document.body.scrollHeight as number,
        );

        // Convert content height to the paper unit
        const contentHeight =
          dims.unit === "in"
            ? contentHeightPx / CSS_PX_PER_INCH
            : (contentHeightPx / CSS_PX_PER_INCH) * MM_PER_INCH;

        // Add estimated @page margin buffer (top + bottom ≈ 20mm ≈ 0.79in)
        const marginBuffer = dims.unit === "in" ? 0.79 : 20;
        const finalHeight = contentHeight + marginBuffer;

        console.log(
          `[PdfConverter] cropToContent: content=${contentHeight.toFixed(2)}${dims.unit}, ` +
            `final=${finalHeight.toFixed(2)}${dims.unit}`,
        );

        const pdfBuffer = await page.pdf({
          width: `${dims.width}${dims.unit}`,
          height: `${finalHeight}${dims.unit}`,
          landscape,
          preferCSSPageSize: false,
          printBackground: true,
        });

        return Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer);
      }

      // Normal mode: prefer @page CSS from formatter, fall back to paperSize option
      const pdfBuffer = await page.pdf({
        format: paperSize,
        landscape,
        preferCSSPageSize: true,
        printBackground: true,
      });

      return Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer);
    } finally {
      if (page) {
        await page.close();
      }
    }
  }

  /**
   * Convert via Node.js subprocess (Windows)
   * Delegates all 3 modes (normal, crop, contentFit) to the helper script
   */
  private async convertViaSubprocess(
    html: string,
    paperSize: string,
    cropToContent: boolean,
    landscape: boolean,
    contentFit?: ContentFitOptions,
  ): Promise<Buffer> {
    if (contentFit) {
      return renderPdfViaSubprocess(html, { contentFit, landscape });
    }

    const dims = parsePaperDimensions(paperSize);

    if (cropToContent && dims) {
      return renderPdfViaSubprocess(html, {
        cropToContent: true,
        paperWidth: dims.width,
        paperHeight: dims.height,
        paperUnit: dims.unit,
        landscape,
      });
    }

    return renderPdfViaSubprocess(html, { paperSize, landscape });
  }

  /**
   * Inject a CSS override that neutralizes any @page { size } declaration in the
   * source HTML. This prevents Chromium from scaling the content when the CSS
   * page size differs from the programmatic PDF page size used in contentFit /
   * cropToContent modes.
   */
  private neutralizePageCss(html: string): string {
    return html.replace(
      "</head>",
      "<style>@page { size: auto !important; margin: 0 !important; }</style></head>",
    );
  }

  /**
   * Generate a dynamically-sized PDF whose height matches content.
   * Uses zero @page margin (the HTML `body { padding }` provides visual margin)
   * and measures scrollHeight to determine the exact page height needed.
   */
  private async convertContentFit(
    html: string,
    contentFit: ContentFitOptions,
    landscape: boolean,
  ): Promise<Buffer> {
    const widthPx = Math.round(contentFit.widthIn * CSS_PX_PER_INCH);
    const maxHeightIn = contentFit.maxHeightIn ?? 11;

    const page = await this.browser!.newPage();
    try {
      // Use a minimal viewport height so scrollHeight reports actual content height
      // (scrollHeight >= viewport height, so a large viewport masks small content)
      await page.setViewportSize({ width: widthPx, height: 1 });

      await page.setContent(this.neutralizePageCss(html), { waitUntil: "networkidle" });
      await page.evaluate(() => (globalThis as any).document.fonts.ready);

      const scrollHeightPx = await page.evaluate(
        () => (globalThis as any).document.documentElement.scrollHeight as number,
      );

      const contentHeightIn = scrollHeightPx / CSS_PX_PER_INCH;
      const finalHeightIn = Math.max(Math.min(contentHeightIn, maxHeightIn), 0.1);

      console.log(
        `[PdfConverter] contentFit: scroll=${scrollHeightPx}px, ` +
          `content=${contentHeightIn.toFixed(2)}in, final=${finalHeightIn.toFixed(2)}in`,
      );

      const pdfBuffer = await page.pdf({
        width: `${contentFit.widthIn}in`,
        height: `${finalHeightIn}in`,
        landscape,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        preferCSSPageSize: false,
        printBackground: true,
      });

      return Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer);
    } finally {
      await page.close();
    }
  }

  /**
   * Check if playwright is available
   */
  static async isAvailable(): Promise<boolean> {
    console.log("[PdfConverter] Checking playwright availability...");

    if (isWindows()) {
      // On Windows, check if Node.js and the helper script exist
      try {
        if (!(await isNodeAvailable())) {
          console.log("[PdfConverter] Node.js not found (required for Windows subprocess mode)");
          return false;
        }

        const scriptPath = getHelperScriptPath("pdf");
        const scriptFile = Bun.file(scriptPath);
        const exists = await scriptFile.exists();

        if (!exists) {
          console.log(`[PdfConverter] Helper script not found: ${scriptPath}`);
          return false;
        }

        // Check if playwright module is available (will be used by Node.js)
        try {
          await loadPlaywrightModule();
        } catch {
          console.log("[PdfConverter] Playwright module not installed");
          return false;
        }

        console.log("[PdfConverter] Playwright is available (Windows subprocess mode)");
        return true;
      } catch (error) {
        console.log("[PdfConverter] Error checking Windows availability:", error);
        return false;
      }
    }

    // Mac/Linux: check direct playwright availability
    try {
      await loadPlaywrightModule();
      console.log("[PdfConverter] Playwright is available");
      return true;
    } catch {
      console.log("[PdfConverter] Playwright is not available");
      return false;
    }
  }
}

/**
 * Create a PdfConverter instance if playwright is available
 * @returns PdfConverter instance or null if playwright is not available
 */
export async function createPdfConverter(
  options?: Partial<PdfConverterOptions>,
): Promise<PdfConverter | null> {
  console.log("[PdfConverter] Creating PDF converter...");
  const available = await PdfConverter.isAvailable();
  if (!available) {
    console.warn("[PdfConverter] playwright not available, PDF conversion disabled");
    return null;
  }
  console.log("[PdfConverter] PDF converter created");
  return new PdfConverter(options);
}
