/**
 * Render a font-size comparison PDF for print quality verification.
 *
 * Usage: bun scripts/render-fontsize-test-pdf.ts
 * Output: fontsize-test.pdf in project root
 */
import { chromium } from "playwright";
import path from "node:path";

const fontSizes = [10, 11, 12, 13, 14, 15, 16, 18, 20];

const sampleNpc =
  "ええ、そうね。わかってはいるんだけど、いざじぶんがそのふこうへいをかんじると、やっぱりつらいものがあるわよね。とくに、わたしみたいに、ひとりでなんとかしなきゃいけないってかんがえてるひとには、けっこうこたえるのよ。";
const samplePlayer = "不公平感はつらいですよね。";

const fontPath = path.resolve("fonts/dartsfont.woff2");
const fontBase64 = Buffer.from(await Bun.file(fontPath).arrayBuffer()).toString("base64");
const creditFontPath = path.resolve("fonts/IBMPlexSansJP-Regular.woff2");
const creditFontBase64 = Buffer.from(await Bun.file(creditFontPath).arrayBuffer()).toString(
  "base64",
);

const sections = fontSizes
  .map(
    (size) => `
    <div class="section">
      <div class="size-label">${size}pt</div>
      <div class="sample" style="font-size: ${size}pt;">
        <div class="npc">Hana: ${sampleNpc}</div>
        <div class="player">${samplePlayer}</div>
      </div>
    </div>`,
  )
  .join("\n");

const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>Font Size Comparison</title>
  <style>
    @font-face {
      font-family: 'ダーツフォント';
      src: url('data:font/woff2;base64,${fontBase64}') format('woff2');
      font-weight: normal;
      font-style: normal;
    }
    @font-face {
      font-family: 'IBM Plex Sans JP';
      src: url('data:font/woff2;base64,${creditFontBase64}') format('woff2');
      font-weight: normal;
      font-style: normal;
    }
    @page {
      size: 15in portrait;
      margin: 15mm 0;
    }
    * { box-sizing: border-box; }
    body {
      font-family: 'ダーツフォント', sans-serif;
      margin: 0;
      padding: 0 30mm;
      background: #fff;
    }
    h1 {
      font-family: 'IBM Plex Sans JP', sans-serif;
      font-size: 20pt;
      margin-bottom: 40px;
      border-bottom: 2px solid #333;
      padding-bottom: 12px;
    }
    .section {
      margin-bottom: 48px;
      page-break-inside: avoid;
    }
    .size-label {
      font-family: 'IBM Plex Sans JP', sans-serif;
      font-size: 12pt;
      font-weight: bold;
      color: #666;
      margin-bottom: 8px;
      border-left: 4px solid #333;
      padding-left: 8px;
    }
    .sample {
      line-height: 1.6;
      padding: 12px 0;
    }
    .npc {
      text-align: left;
      max-width: 75%;
      margin-bottom: 8px;
    }
    .player {
      text-align: right;
    }
  </style>
</head>
<body>
  <h1>Font Size Comparison (${fontSizes[0]}pt – ${fontSizes[fontSizes.length - 1]}pt)</h1>
${sections}
</body>
</html>`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setContent(html, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
const pdf = await page.pdf({
  width: "15in",
  preferCSSPageSize: true,
  printBackground: true,
});
await Bun.write("fontsize-test.pdf", pdf);
await browser.close();

console.log("Generated: fontsize-test.pdf");
