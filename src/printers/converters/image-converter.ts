/**
 * ImageConverter - HTML to image conversion using Playwright
 *
 * Converts HTML content to PNG/BMP images for dot impact printer support.
 * Dot impact printers often have font rendering issues with HTML/text content,
 * but work reliably with rasterized images.
 *
 * On Windows, uses Node.js subprocess to work around Bun + Playwright issue:
 * https://github.com/oven-sh/bun/issues/23826
 *
 * @related src/printers/converters/subprocess-utils.ts (isWindows, getHelperScriptPath)
 * @related src/printers/native.ts (NativePrinter)
 * @related src/printers/replay-formatter.ts (ReplayFormatter)
 * @related src/core/types.ts (ImageConversionConfig)
 * @related scripts/playwright-render.cjs (Windows subprocess helper)
 */

import { isWindows, getHelperScriptPath, isNodeAvailable } from "./subprocess-utils.js";

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
 * Render HTML to image using Node.js subprocess (for Windows)
 */
async function renderViaSubprocess(html: string, width: number): Promise<Buffer> {
  const scriptPath = getHelperScriptPath("image");
  console.log(`[ImageConverter] Using Node.js subprocess for Windows: ${scriptPath}`);

  const input = JSON.stringify({ html, width });

  const proc = Bun.spawn(["node", scriptPath], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  // Write HTML to stdin using FileSink API
  proc.stdin.write(input);
  proc.stdin.flush();
  proc.stdin.end();

  // Wait for process to complete
  const exitCode = await proc.exited;

  // Read stdout
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  if (stderr) {
    console.error("[ImageConverter] Subprocess stderr:", stderr);
  }

  if (exitCode !== 0) {
    throw new Error(`Node.js subprocess failed with exit code ${exitCode}: ${stderr || stdout}`);
  }

  // Parse JSON response
  let response;
  try {
    response = JSON.parse(stdout);
  } catch {
    throw new Error(`Invalid JSON response from subprocess: ${stdout}`);
  }

  if (!response.success) {
    throw new Error(`Subprocess rendering failed: ${response.error}`);
  }

  // Decode base64 image
  return Buffer.from(response.image, "base64");
}

/**
 * HTML to image converter using Playwright
 *
 * Uses headless Chromium to render HTML and capture as screenshot.
 * Suitable for dot impact printers that have font rendering issues.
 *
 * On Windows, uses Node.js subprocess to work around Bun + Playwright issue.
 */
export class ImageConverter {
  private browser: Browser | null = null;
  private options: Required<ImageConverterOptions>;
  private initPromise: Promise<void> | null = null;
  private useSubprocess: boolean;

  constructor(options: Partial<ImageConverterOptions> = {}) {
    this.options = {
      format: options.format ?? DEFAULT_OPTIONS.format,
      width: options.width ?? DEFAULT_OPTIONS.width,
      grayscale: options.grayscale ?? DEFAULT_OPTIONS.grayscale,
    };
    this.useSubprocess = isWindows();

    if (this.useSubprocess) {
      console.log("[ImageConverter] Windows detected, will use Node.js subprocess for Playwright");
    }
  }

  /**
   * Initialize the converter (launches browser)
   * On Windows with subprocess mode, this is a no-op since browser is launched per-render
   */
  async initialize(): Promise<void> {
    if (this.useSubprocess) {
      // No persistent browser needed for subprocess mode
      console.log("[ImageConverter] Subprocess mode - skipping browser initialization");
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
            `Browser launch timed out after ${launchTimeout}ms. Chromium may not be installed correctly. Run: npx playwright install chromium`,
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
    if (this.useSubprocess) {
      // No persistent browser to close in subprocess mode
      return;
    }

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
    const opts: Required<ImageConverterOptions> = {
      format: options?.format ?? this.options.format,
      width: options?.width ?? this.options.width,
      grayscale: options?.grayscale ?? this.options.grayscale,
    };

    let buffer: Buffer;

    if (this.useSubprocess) {
      // Windows: use Node.js subprocess
      buffer = await renderViaSubprocess(html, opts.width);
    } else {
      // Mac/Linux: use direct Playwright
      buffer = await this.convertDirect(html, opts);
    }

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
  }

  /**
   * Convert using direct Playwright (Mac/Linux)
   */
  private async convertDirect(
    html: string,
    opts: Required<ImageConverterOptions>,
  ): Promise<Buffer> {
    if (!this.browser) {
      await this.initialize();
    }

    if (!this.browser) {
      throw new Error("Browser not initialized");
    }

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
      return Buffer.isBuffer(screenshot) ? screenshot : Buffer.from(screenshot);
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

    if (isWindows()) {
      // On Windows, check if Node.js and the helper script exist
      try {
        if (!(await isNodeAvailable())) {
          console.log("[ImageConverter] Node.js not found (required for Windows subprocess mode)");
          return false;
        }

        const scriptPath = getHelperScriptPath("image");
        const scriptFile = Bun.file(scriptPath);
        const exists = await scriptFile.exists();

        if (!exists) {
          console.log(`[ImageConverter] Helper script not found: ${scriptPath}`);
          return false;
        }

        // Check if playwright module is available (will be used by Node.js)
        try {
          await loadPlaywrightModule();
        } catch {
          console.log("[ImageConverter] Playwright module not installed");
          return false;
        }

        console.log("[ImageConverter] Playwright is available (Windows subprocess mode)");
        return true;
      } catch (error) {
        console.log("[ImageConverter] Error checking Windows availability:", error);
        return false;
      }
    }

    // Mac/Linux: check direct playwright availability
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
