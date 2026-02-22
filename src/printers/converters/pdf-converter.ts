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
 * @related src/printers/paper-size-resolver.ts (paperNameToCssPageSize)
 */

// Playwright types (dynamic import - playwright is optional)
type Browser = {
  newPage(): Promise<Page>;
  close(): Promise<void>;
};

type Page = {
  setContent(html: string, options?: { waitUntil?: string }): Promise<void>;
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
 * Options for PDF conversion
 */
export interface PdfConverterOptions {
  /** Paper size for PDF output (default: "A4") */
  paperSize?: string;
}

const DEFAULT_OPTIONS: Required<PdfConverterOptions> = {
  paperSize: "A4",
};

/**
 * HTML to PDF converter using Playwright
 *
 * Uses headless Chromium to render HTML and generate PDF via page.pdf().
 * Supports full CSS including @font-face for custom font embedding.
 */
export class PdfConverter {
  private browser: Browser | null = null;
  private options: Required<PdfConverterOptions>;
  private initPromise: Promise<void> | null = null;

  constructor(options: Partial<PdfConverterOptions> = {}) {
    this.options = {
      paperSize: options.paperSize ?? DEFAULT_OPTIONS.paperSize,
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

    if (!this.browser) {
      await this.initialize();
    }

    if (!this.browser) {
      throw new Error("Browser not initialized");
    }

    let page: Page | null = null;
    try {
      page = await this.browser.newPage();

      // Load HTML content
      await page.setContent(html, {
        waitUntil: "networkidle",
      });

      // Wait for fonts to load (runs in browser context)
      await page.evaluate(() => (globalThis as any).document.fonts.ready);

      // Generate PDF: prefer @page CSS from formatter, fall back to paperSize option
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
