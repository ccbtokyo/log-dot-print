/**
 * Render a test PDF with credit border-line thickness variations (1px–10px).
 *
 * Usage: bun scripts/render-border-test-pdf.ts
 * Output: border-test.pdf in project root
 */
import { chromium } from "playwright";

const widths = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const rows = widths
  .map(
    (w) => `
    <div class="row">
      <div class="label">${w}px</div>
      <div class="line" style="border-top: ${w}px solid #ccc;"></div>
      <div class="text">RE:SPAWN READY</div>
      <div class="line" style="border-top: ${w}px solid #ccc;"></div>
    </div>`,
  )
  .join("\n");

const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>Border Thickness Test</title>
  <style>
    @page {
      size: 15in 11in;
      margin: 0;
    }
    * { box-sizing: border-box; }
    body {
      font-family: 'IBM Plex Sans JP', sans-serif;
      margin: 0;
      padding: 60px 80px;
      background: #fff;
    }
    h1 {
      font-size: 24pt;
      margin-bottom: 40px;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 48px;
    }
    .label {
      width: 60px;
      font-size: 14pt;
      font-weight: bold;
      text-align: right;
      flex-shrink: 0;
    }
    .line {
      width: 320px;
      flex-shrink: 0;
    }
    .text {
      font-size: 14pt;
      font-weight: bold;
      letter-spacing: 0.1em;
      white-space: nowrap;
    }
  </style>
</head>
<body>
  <h1>Credit Border-Line Thickness Test (1px – 10px)</h1>
${rows}
</body>
</html>`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setContent(html, { waitUntil: "networkidle" });
const pdf = await page.pdf({
  width: "15in",
  height: "11in",
  preferCSSPageSize: true,
  printBackground: true,
});
await Bun.write("border-test.pdf", pdf);
await browser.close();

console.log("Generated: border-test.pdf");
