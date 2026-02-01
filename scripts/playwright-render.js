#!/usr/bin/env node
/**
 * Playwright render helper for Windows
 *
 * Workaround for Bun + Playwright on Windows issue:
 * https://github.com/oven-sh/bun/issues/23826
 *
 * This script runs under Node.js and handles Playwright rendering,
 * allowing Bun to call it via subprocess on Windows.
 *
 * Protocol:
 * - Input: JSON on stdin { html: string, width?: number }
 * - Output: JSON on stdout { success: true, image: base64 } or { success: false, error: string }
 */

const { chromium } = require("playwright");

async function main() {
  let input = "";

  // Read all input from stdin
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  let params;
  try {
    params = JSON.parse(input);
  } catch (err) {
    console.log(JSON.stringify({ success: false, error: `Invalid JSON input: ${err.message}` }));
    process.exit(1);
  }

  const { html, width = 2835 } = params;

  if (!html) {
    console.log(JSON.stringify({ success: false, error: "Missing required 'html' parameter" }));
    process.exit(1);
  }

  let browser = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });

    const page = await browser.newPage();

    await page.setViewportSize({
      width: width,
      height: 800,
    });

    await page.setContent(html, {
      waitUntil: "networkidle",
    });

    // Wait for fonts to load
    await page.evaluate(() => document.fonts.ready);

    // Take screenshot
    const screenshot = await page.screenshot({
      fullPage: true,
      type: "png",
    });

    await page.close();

    // Output base64-encoded image
    const base64 = screenshot.toString("base64");
    console.log(JSON.stringify({ success: true, image: base64 }));
    process.exit(0);
  } catch (err) {
    console.log(JSON.stringify({ success: false, error: err.message }));
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

main();
