#!/usr/bin/env bun
/**
 * SumatraPDF 印刷テストスクリプト — 用紙・トレイ・paperKind の切り分け用
 *
 * Usage:
 *   bun scripts/test-sumatra-print.ts <pdf-file> [options]
 *
 * Options:
 *   --printer <name>    プリンター名（省略時: デフォルト）
 *   --paper <name>      paperSize（SumatraPDF の paper= に渡る）
 *   --bin <number>      トレイ/ビン番号（SumatraPDF の bin= に渡る）
 *   --paperkind <num>   Windows DEVMODE dmPaperSize（SumatraPDF の paperkind= に渡る）
 *   --dry-run           コマンドを表示するだけで印刷しない
 *
 * Examples:
 *   # 1. 何も渡さない（ドライバー既定のみ）
 *   bun scripts/test-sumatra-print.ts data/prints/test.pdf --printer "EPSON VP-F4400N"
 *
 *   # 2. paperSize だけ
 *   bun scripts/test-sumatra-print.ts data/prints/test.pdf --printer "EPSON VP-F4400N" --paper "15x11"
 *
 *   # 3. bin（トレイ）だけ
 *   bun scripts/test-sumatra-print.ts data/prints/test.pdf --printer "EPSON VP-F4400N" --bin 1
 *
 *   # 4. paperKind だけ
 *   bun scripts/test-sumatra-print.ts data/prints/test.pdf --printer "EPSON VP-F4400N" --paperkind 1
 *
 *   # 5. 組み合わせ
 *   bun scripts/test-sumatra-print.ts data/prints/test.pdf --printer "EPSON VP-F4400N" --bin 1 --paper "15x11"
 */
import { existsSync } from "node:fs";

const args = process.argv.slice(2);

function usage(): never {
  console.log(
    "Usage: bun scripts/test-sumatra-print.ts <pdf-file> [--printer NAME] [--paper NAME] [--bin NUM] [--paperkind NUM] [--dry-run]",
  );
  process.exit(1);
}

// Parse args
let pdfFile: string | undefined;
let printerName: string | undefined;
let paperSize: string | undefined;
let bin: string | undefined;
let paperKind: number | undefined;
let dryRun = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--printer" && i + 1 < args.length) {
    printerName = args[++i];
  } else if (arg === "--paper" && i + 1 < args.length) {
    paperSize = args[++i];
  } else if (arg === "--bin" && i + 1 < args.length) {
    bin = args[++i];
  } else if (arg === "--paperkind" && i + 1 < args.length) {
    paperKind = Number(args[++i]);
  } else if (arg === "--dry-run") {
    dryRun = true;
  } else if (!arg.startsWith("--")) {
    pdfFile = arg;
  }
}

if (!pdfFile) usage();

if (!existsSync(pdfFile)) {
  console.error(`File not found: ${pdfFile}`);
  process.exit(1);
}

// Build print options
const { print } = await import("pdf-to-printer");

const options: import("pdf-to-printer").PrintOptions = {
  silent: false,
  scale: "noscale",
  orientation: "portrait",
  monochrome: true,
};

if (printerName) options.printer = printerName;
if (paperSize) options.paperSize = paperSize;
if (bin) options.bin = bin;
if (paperKind !== undefined) options.paperKind = paperKind;

console.log("=== SumatraPDF Print Test ===");
console.log(`PDF:       ${pdfFile}`);
console.log(`Printer:   ${printerName ?? "(default)"}`);
console.log(`Paper:     ${paperSize ?? "(not set)"}`);
console.log(`Bin:       ${bin ?? "(not set)"}`);
console.log(`PaperKind: ${paperKind ?? "(not set)"}`);
console.log("");
console.log("→ SumatraPDF -print-settings に渡る値:");
const settings: string[] = [];
if (paperSize) settings.push(`paper=${paperSize}`);
if (bin) settings.push(`bin=${bin}`);
if (paperKind !== undefined) settings.push(`paperkind=${paperKind}`);
settings.push("noscale", "portrait", "monochrome");
console.log(`  ${settings.join(",")}`);
console.log("");

if (dryRun) {
  console.log("[dry-run] 印刷はスキップ");
  process.exit(0);
}

try {
  console.log("Printing...");
  await print(pdfFile, options);
  console.log("Done.");
} catch (error) {
  console.error("Print failed:", error);
  process.exit(1);
}
