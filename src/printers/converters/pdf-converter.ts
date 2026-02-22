/**
 * PdfConverter - HTML to PDF conversion using Playwright
 *
 * Converts HTML content to PDF for high-quality printing with full CSS and
 * @font-face support. Shares the same Playwright (Chromium) infrastructure
 * as ImageConverter.
 *
 * @related src/printers/converters/image-converter.ts (ImageConverter - shared Playwright infra)
 * @related src/printers/native.ts (NativePrinter)
 * @related src/printers/replay-formatter.ts (ReplayFormatter)
 * @related src/core/types.ts (ImageConversionConfig)
 * @related src/printers/paper-size-resolver.ts (paperNameToCssPageSize, parsePaperDimensions)
 */

import { parsePaperDimensions } from "../paper-size-resolver.js";

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
}

const DEFAULT_OPTIONS: Required<Omit<PdfConverterOptions, "contentFit">> = {
  paperSize: "A4",
  cropToContent: false,
};

/** CSS pixels per inch (Chromium default) */
const CSS_PX_PER_INCH = 96;

/** mm per inch */
const MM_PER_INCH = 25.4;

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

  constructor(options: Partial<PdfConverterOptions> = {}) {
    this.options = {
      paperSize: options.paperSize ?? DEFAULT_OPTIONS.paperSize,
      cropToContent: options.cropToContent ?? DEFAULT_OPTIONS.cropToContent,
    };
  }

  /**
   * Initialize the converter (launches browser)
   */
  async initialize(): Promise<void> {
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
            `Browser launch timed out after ${launchTimeout}ms. Chromium may not be installed correctly. Run: bunx playwright install chromium`,
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

    if (!this.browser) {
      await this.initialize();
    }

    if (!this.browser) {
      throw new Error("Browser not initialized");
    }

    // Content-fit mode: measure content and generate dynamically-sized PDF
    if (options?.contentFit) {
      return this.convertContentFit(html, options.contentFit);
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
      await page.setContent(html, {
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
          preferCSSPageSize: false,
          printBackground: true,
        });

        return Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer);
      }

      // Normal mode: prefer @page CSS from formatter, fall back to paperSize option
      const pdfBuffer = await page.pdf({
        format: paperSize,
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
   * Generate a dynamically-sized PDF whose height matches content.
   * Uses zero @page margin (the HTML `body { padding }` provides visual margin)
   * and measures scrollHeight to determine the exact page height needed.
   */
  private async convertContentFit(html: string, contentFit: ContentFitOptions): Promise<Buffer> {
    const widthPx = Math.round(contentFit.widthIn * CSS_PX_PER_INCH);
    const maxHeightIn = contentFit.maxHeightIn ?? 11;

    const page = await this.browser!.newPage();
    try {
      // Use a minimal viewport height so scrollHeight reports actual content height
      // (scrollHeight >= viewport height, so a large viewport masks small content)
      await page.setViewportSize({ width: widthPx, height: 1 });

      await page.setContent(html, { waitUntil: "networkidle" });
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
