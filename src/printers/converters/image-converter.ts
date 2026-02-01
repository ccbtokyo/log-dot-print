/**
 * ImageConverter - HTML to image conversion using Playwright
 *
 * Converts HTML content to PNG/BMP images for dot impact printer support.
 * Dot impact printers often have font rendering issues with HTML/text content,
 * but work reliably with rasterized images.
 *
 * @related src/printers/native.ts (NativePrinter)
 * @related src/printers/replay-formatter.ts (ReplayFormatter)
 * @related src/core/types.ts (ImageConversionConfig)
 */

// Playwright types (dynamic import - playwright is optional)
type Browser = {
  newPage(): Promise<Page>;
  close(): Promise<void>;
};

type Page = {
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  setContent(html: string, options?: { waitUntil?: string }): Promise<void>;
  evaluate<T>(fn: () => T): Promise<T>;
  screenshot(options?: { fullPage?: boolean; type?: string }): Promise<Buffer>;
  close(): Promise<void>;
};

type BrowserType = {
  launch(options?: Record<string, unknown>): Promise<Browser>;
};

/**
 * Options for image conversion
 */
export interface ImageConverterOptions {
  /** Output image format */
  format: "png" | "bmp";
  /** Image width in pixels (default: 2835px for 15" continuous paper) */
  width?: number;
  /** Whether to convert to grayscale for dot impact printers */
  grayscale?: boolean;
}

/**
 * Default conversion options
 *
 * Width calculation for 15-inch continuous paper (EPSON VP-F4400N):
 * - Total width: 381mm (15 inches)
 * - Printable width (minus sprocket holes): ~355mm (14 inches)
 * - Pixel width: using ~2835px to ensure high quality when driver scales to paper
 *
 * Note: The actual print DPI is controlled by the printer driver, not this value.
 * The image will be scaled by the driver to fit the paper width.
 */
const DEFAULT_OPTIONS: Required<ImageConverterOptions> = {
  format: "png",
  width: 2835, // ~355mm printable area at high resolution
  grayscale: false,
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
    // Dynamic import to avoid bundling playwright
    const moduleName = "playwright";
    console.log("[ImageConverter] Loading playwright module...");
    playwrightModule = (await import(moduleName)) as PlaywrightModule;
    console.log("[ImageConverter] Playwright module loaded");
    return playwrightModule;
  } catch (error) {
    console.error("[ImageConverter] Failed to load playwright:", error);
    throw new Error("playwright is not installed", { cause: error });
  }
}

/**
 * HTML to image converter using Playwright
 *
 * Uses headless Chromium to render HTML and capture as screenshot.
 * Suitable for dot impact printers that have font rendering issues.
 */
export class ImageConverter {
  private browser: Browser | null = null;
  private options: Required<ImageConverterOptions>;
  private initPromise: Promise<void> | null = null;

  constructor(options: Partial<ImageConverterOptions> = {}) {
    this.options = {
      format: options.format ?? DEFAULT_OPTIONS.format,
      width: options.width ?? DEFAULT_OPTIONS.width,
      grayscale: options.grayscale ?? DEFAULT_OPTIONS.grayscale,
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
    console.log("[ImageConverter] Launching Chromium browser...");

    // Add timeout to browser launch
    const launchTimeout = 30000; // 30 seconds
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
      console.log("[ImageConverter] Browser launched");
    } catch (error) {
      console.error("[ImageConverter] Failed to launch browser:", error);
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
      console.log("[ImageConverter] Browser closed");
    }
  }

  /**
   * Convert HTML content to image
   *
   * @param html - HTML content to convert
   * @param options - Optional override options for this conversion
   * @returns Image buffer (PNG or BMP)
   */
  async convert(html: string, options?: Partial<ImageConverterOptions>): Promise<Buffer> {
    if (!this.browser) {
      await this.initialize();
    }

    if (!this.browser) {
      throw new Error("Browser not initialized");
    }

    const opts: Required<ImageConverterOptions> = {
      format: options?.format ?? this.options.format,
      width: options?.width ?? this.options.width,
      grayscale: options?.grayscale ?? this.options.grayscale,
    };

    let page: Page | null = null;
    try {
      page = await this.browser.newPage();

      // Set viewport width with reasonable height (will use fullPage screenshot)
      await page.setViewportSize({
        width: opts.width,
        height: 800,
      });

      // Load HTML content
      await page.setContent(html, {
        waitUntil: "networkidle",
      });

      // Wait for fonts to load (runs in browser context)
      await page.evaluate(() => (globalThis as any).document.fonts.ready);

      // Take screenshot of full page
      const screenshot = await page.screenshot({
        fullPage: true,
        type: "png", // Always capture as PNG first
      });

      // Convert to Buffer if needed
      let buffer = Buffer.isBuffer(screenshot) ? screenshot : Buffer.from(screenshot);

      // Apply grayscale if requested
      if (opts.grayscale) {
        buffer = await this.convertToGrayscale(buffer);
      }

      // Convert to BMP if requested (not directly supported by Playwright)
      if (opts.format === "bmp") {
        console.warn(
          "[ImageConverter] BMP format requested but returning PNG (BMP requires additional library)",
        );
      }

      return buffer;
    } finally {
      if (page) {
        await page.close();
      }
    }
  }

  /**
   * Convert PNG buffer to grayscale
   * Uses simple luminance formula: Y = 0.299R + 0.587G + 0.114B
   *
   * Note: For production use, consider using a proper image processing library
   * like sharp for better performance and quality.
   */
  private async convertToGrayscale(pngBuffer: Buffer): Promise<Buffer> {
    // For now, return original buffer with a warning
    // Full grayscale conversion would require PNG parsing/encoding library
    console.warn("[ImageConverter] Grayscale conversion not yet implemented, returning original");
    return pngBuffer;
  }

  /**
   * Check if playwright is available
   */
  static async isAvailable(): Promise<boolean> {
    console.log("[ImageConverter] Checking playwright availability...");
    try {
      await loadPlaywrightModule();
      console.log("[ImageConverter] Playwright is available");
      return true;
    } catch {
      console.log("[ImageConverter] Playwright is not available");
      return false;
    }
  }
}

/**
 * Create an ImageConverter instance if playwright is available
 * @returns ImageConverter instance or null if playwright is not available
 */
export async function createImageConverter(
  options?: Partial<ImageConverterOptions>,
): Promise<ImageConverter | null> {
  console.log("[ImageConverter] Creating image converter...");
  const available = await ImageConverter.isAvailable();
  if (!available) {
    console.warn("[ImageConverter] playwright not available, image conversion disabled");
    return null;
  }
  console.log("[ImageConverter] Image converter created");
  return new ImageConverter(options);
}
