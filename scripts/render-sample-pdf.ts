/**
 * Render a sample replay-format PDF for visual verification.
 *
 * Usage: bun scripts/render-sample-pdf.ts
 * Output: sample-replay.pdf in project root
 */
import { chromium } from "playwright";
import { ReplayFormatter } from "../src/printers/replay-formatter.js";
import { TypedEventEmitter } from "../src/core/events.js";
import type { LogEntry, SystemConfig } from "../src/core/types.js";

const payload = await Bun.file("examples/gameplay.json").json();

const formatter = new ReplayFormatter();
const eventBus = new TypedEventEmitter();
const config: SystemConfig = {
  server: { port: 3000, host: "localhost" },
  printer: { type: "mock", options: {} },
  queue: { maxSize: 100, retryAttempts: 3, retryDelayMs: 1000 },
  format: {
    outputFormat: "replay",
    fontFamily: "'ダーツフォント', sans-serif",
    fontPath: "./fonts/dartsfont.woff2",
    creditFontFamily: "'IBM Plex Sans JP', sans-serif",
    creditFontPath: "./fonts/IBMPlexSansJP-Regular.woff2",
    pdfPaperSize: "Custom.15x11in",
    sideMargin: 30,
    fontSize: 16,
    skipRespawn: true,
  },
};

await formatter.initialize(eventBus, config);

const entry: LogEntry = {
  id: "sample-001",
  timestamp: new Date().toISOString(),
  level: "info",
  source: "sample",
  message: JSON.stringify(payload),
  printed: false,
};

const html = formatter.format(entry);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setContent(html, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
const pdf = await page.pdf({
  width: "15in",
  height: "11in",
  preferCSSPageSize: true,
  printBackground: true,
});
await Bun.write("sample-replay.pdf", pdf);
await browser.close();

console.log("Generated: sample-replay.pdf");
