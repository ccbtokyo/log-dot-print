/**
 * Subprocess utilities for Playwright Windows workaround
 *
 * Shared helpers for ImageConverter and PdfConverter to detect Windows
 * and resolve paths to Node.js subprocess helper scripts.
 *
 * On Windows, Bun + Playwright has a known compatibility issue:
 * https://github.com/oven-sh/bun/issues/23826
 *
 * @related src/printers/converters/image-converter.ts (ImageConverter)
 * @related src/printers/converters/pdf-converter.ts (PdfConverter)
 * @related scripts/playwright-render.cjs (image subprocess helper)
 * @related scripts/playwright-render-pdf.cjs (PDF subprocess helper)
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HELPER_SCRIPTS = {
  image: "playwright-render.cjs",
  pdf: "playwright-render-pdf.cjs",
} as const;

/**
 * Check if running on Windows
 */
export function isWindows(): boolean {
  return process.platform === "win32";
}

/**
 * Get the path to a playwright helper script
 *
 * @param type - "image" for screenshot helper, "pdf" for PDF helper
 */
export function getHelperScriptPath(type: keyof typeof HELPER_SCRIPTS): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  // Navigate to scripts directory from src/printers/converters
  return resolve(currentDir, "../../../scripts", HELPER_SCRIPTS[type]);
}

/**
 * Check if the `node` command is available on this system.
 * Required for subprocess mode on Windows.
 */
export async function isNodeAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["node", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}
