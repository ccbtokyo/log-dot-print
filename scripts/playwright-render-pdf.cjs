#!/usr/bin/env node
/**
 * Playwright PDF render helper for Windows
 *
 * Workaround for Bun + Playwright on Windows issue:
 * https://github.com/oven-sh/bun/issues/23826
 *
 * This script runs under Node.js and handles Playwright PDF rendering,
 * allowing Bun to call it via subprocess on Windows.
 *
 * Protocol:
 * - Input: JSON on stdin (see below for modes)
 * - Output: JSON on stdout { success: true, pdf: base64 } or { success: false, error: string }
 *
 * Modes:
 * 1. Normal:     { html, paperSize }
 * 2. Crop:       { html, paperSize, cropToContent: true, paperWidth, paperHeight, paperUnit }
 * 3. ContentFit: { html, contentFit: { widthIn, maxHeightIn } }
 */

const { chromium } = require("playwright");

/** CSS pixels per inch (Chromium default) */
const CSS_PX_PER_INCH = 96;

/** mm per inch */
const MM_PER_INCH = 25.4;

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
    process.stdout.write(JSON.stringify({ success: false, error: `Invalid JSON input: ${err.message}` }) + "\n");
    process.exitCode = 1;
    return;
  }

  const { html } = params;

  if (!html) {
    process.stdout.write(JSON.stringify({ success: false, error: "Missing required 'html' parameter" }) + "\n");
    process.exitCode = 1;
    return;
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

    let pdfBuffer;

    if (params.contentFit) {
      // Content-fit mode
      pdfBuffer = await renderContentFit(page, html, params.contentFit, params.landscape);
    } else if (params.cropToContent) {
      // Crop mode
      pdfBuffer = await renderCrop(page, html, params);
    } else {
      // Normal mode
      pdfBuffer = await renderNormal(page, html, params);
    }

    await page.close();

    const base64 = pdfBuffer.toString("base64");
    const output = JSON.stringify({ success: true, pdf: base64 });
    await new Promise((resolve, reject) => {
      process.stdout.write(output + "\n", (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    process.stdout.write(JSON.stringify({ success: false, error: err.message }) + "\n");
    process.exitCode = 1;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Normal PDF rendering: use paperSize format with preferCSSPageSize
 */
async function renderNormal(page, html, params) {
  const paperSize = params.paperSize || "A4";

  await page.setContent(html, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  return page.pdf({
    format: paperSize,
    landscape: params.landscape || false,
    preferCSSPageSize: true,
    printBackground: true,
  });
}

/**
 * Crop mode: measure content height and use dynamic page height
 */
async function renderCrop(page, html, params) {
  const { paperWidth, paperHeight, paperUnit } = params;

  if (!paperWidth || !paperUnit) {
    throw new Error("cropToContent requires paperWidth and paperUnit");
  }

  const widthPx = paperUnit === "in"
    ? Math.round(paperWidth * CSS_PX_PER_INCH)
    : Math.round((paperWidth / MM_PER_INCH) * CSS_PX_PER_INCH);

  await page.setViewportSize({ width: widthPx, height: 800 });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  const contentHeightPx = await page.evaluate(() => document.body.scrollHeight);

  const contentHeight = paperUnit === "in"
    ? contentHeightPx / CSS_PX_PER_INCH
    : (contentHeightPx / CSS_PX_PER_INCH) * MM_PER_INCH;

  // Add estimated @page margin buffer (top + bottom ≈ 20mm ≈ 0.79in)
  const marginBuffer = paperUnit === "in" ? 0.79 : 20;
  const finalHeight = contentHeight + marginBuffer;

  return page.pdf({
    width: `${paperWidth}${paperUnit}`,
    height: `${finalHeight}${paperUnit}`,
    landscape: params.landscape || false,
    preferCSSPageSize: false,
    printBackground: true,
  });
}

/**
 * Content-fit mode: measure content height and generate dynamically-sized PDF
 */
async function renderContentFit(page, html, contentFit, landscape) {
  const { widthIn, maxHeightIn = 11 } = contentFit;
  const widthPx = Math.round(widthIn * CSS_PX_PER_INCH);

  // Use a minimal viewport height so scrollHeight reports actual content height
  await page.setViewportSize({ width: widthPx, height: 1 });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  const scrollHeightPx = await page.evaluate(
    () => document.documentElement.scrollHeight,
  );

  const contentHeightIn = scrollHeightPx / CSS_PX_PER_INCH;
  const finalHeightIn = Math.max(Math.min(contentHeightIn, maxHeightIn), 0.1);

  return page.pdf({
    width: `${widthIn}in`,
    height: `${finalHeightIn}in`,
    landscape: landscape || false,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    preferCSSPageSize: false,
    printBackground: true,
  });
}

main();
