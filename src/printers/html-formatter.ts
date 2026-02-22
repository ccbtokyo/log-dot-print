import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  LogEntry,
  LogFormatterPlugin,
  SystemConfig,
  TypedEventEmitter,
  HtmlFormatConfig,
  PrintContentType,
} from "../core/index.js";
import { formatTimestamp } from "../core/index.js";
import { paperNameToCssPageSize } from "./paper-size-resolver.js";

/**
 * Default HTML format configuration
 */
const DEFAULT_CONFIG: Required<
  Omit<HtmlFormatConfig, "outputFormat" | "template" | "css" | "fontPath" | "pdfPaperSize">
> & {
  outputFormat: "html";
  template?: string;
  css?: string;
  fontPath?: string;
  pdfPaperSize?: string;
} = {
  outputFormat: "html",
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  fontSize: 14,
  pageWidth: 210,
  includeTimestamp: true,
  includeSource: true,
  includeLevel: false,
  maxLineWidth: 80,
};

/**
 * HTML formatter for log entries
 * Generates HTML documents suitable for PDF conversion and printing
 *
 * @see /Users/eotel/ghq/github.com/ccbtokyo/log-dot-print/plans/html-pretty-print.md
 * @related DefaultFormatter, CupsPrinter
 */
export class HtmlFormatter implements LogFormatterPlugin {
  readonly name = "html-formatter";
  readonly version = "1.0.0";

  private config: typeof DEFAULT_CONFIG = { ...DEFAULT_CONFIG };

  async initialize(_eventBus: TypedEventEmitter, config: SystemConfig): Promise<void> {
    if (config.format?.outputFormat === "html") {
      const htmlConfig = config.format as HtmlFormatConfig;
      this.config = {
        outputFormat: "html",
        fontFamily: htmlConfig.fontFamily ?? DEFAULT_CONFIG.fontFamily,
        fontSize: htmlConfig.fontSize ?? DEFAULT_CONFIG.fontSize,
        pageWidth: htmlConfig.pageWidth ?? DEFAULT_CONFIG.pageWidth,
        includeTimestamp: htmlConfig.includeTimestamp ?? DEFAULT_CONFIG.includeTimestamp,
        includeSource: htmlConfig.includeSource ?? DEFAULT_CONFIG.includeSource,
        includeLevel: htmlConfig.includeLevel ?? DEFAULT_CONFIG.includeLevel,
        maxLineWidth: htmlConfig.maxLineWidth ?? DEFAULT_CONFIG.maxLineWidth,
        template: htmlConfig.template,
        css: htmlConfig.css,
        fontPath: htmlConfig.fontPath,
        pdfPaperSize: htmlConfig.pdfPaperSize,
      };
    }
  }

  async shutdown(): Promise<void> {
    // Nothing to clean up
  }

  /**
   * Get the content type produced by this formatter
   */
  getContentType(): PrintContentType {
    return "html";
  }

  /**
   * Format a log entry as HTML
   */
  format(entry: LogEntry): string {
    const {
      fontFamily,
      fontSize,
      pageWidth,
      includeTimestamp,
      includeSource,
      includeLevel,
      fontPath,
      pdfPaperSize,
    } = this.config;

    const fontFileUrl = fontPath ? this.toFontFileUrl(fontPath) : undefined;
    const fontFaceRule = fontFileUrl
      ? `
    @font-face {
      font-family: '${fontFamily}';
      src: url('${fontFileUrl}') format('${this.getFontFormat(fontPath!)}');
      font-weight: normal;
      font-style: normal;
    }`
      : "";

    const pageSizeValue = pdfPaperSize
      ? paperNameToCssPageSize(pdfPaperSize)
      : `${pageWidth}mm auto`;

    const css = `
    @page {
      size: ${pageSizeValue};
      margin: 10mm;
    }
    * {
      box-sizing: border-box;
    }
    body {
      font-family: ${fontPath ? `'${fontFamily}'` : fontFamily};
      font-size: ${fontSize}px;
      line-height: 1.5;
      margin: 0;
      padding: 20px;
      color: #333;
    }
    .log-entry {
      margin-bottom: 20px;
    }
    .header {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 10px;
      padding-bottom: 10px;
      border-bottom: 1px solid #ccc;
    }
    .timestamp {
      color: #666;
      font-family: monospace;
    }
    .source {
      color: #0066cc;
      font-weight: bold;
    }
    .level {
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.85em;
      font-weight: bold;
      text-transform: uppercase;
    }
    .level-info { background: #e3f2fd; color: #1976d2; }
    .level-warn { background: #fff3e0; color: #f57c00; }
    .level-error { background: #ffebee; color: #d32f2f; }
    .level-debug { background: #f3e5f5; color: #7b1fa2; }
    .message {
      white-space: pre-wrap;
      word-wrap: break-word;
      margin: 15px 0;
    }
    .metadata {
      background: #f5f5f5;
      padding: 10px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 0.9em;
    }
    .metadata-title {
      font-weight: bold;
      margin-bottom: 5px;
      color: #666;
    }
    .metadata-item {
      margin: 3px 0;
    }
    .metadata-key {
      color: #7b1fa2;
    }
    .metadata-value {
      color: #333;
    }`;

    const headerParts: string[] = [];

    if (includeTimestamp) {
      const timeStr = formatTimestamp(entry.timestamp);
      headerParts.push(`<span class="timestamp">${this.escapeHtml(timeStr)}</span>`);
    }

    if (includeSource) {
      headerParts.push(`<span class="source">${this.escapeHtml(entry.source)}</span>`);
    }

    if (includeLevel) {
      const levelClass = this.getLevelClass(entry.level);
      headerParts.push(
        `<span class="level ${levelClass}">${this.escapeHtml(entry.level.toUpperCase())}</span>`,
      );
    }

    const headerHtml =
      headerParts.length > 0 ? `<div class="header">${headerParts.join("")}</div>` : "";

    const messageHtml = `<div class="message">${this.escapeHtml(entry.message)}</div>`;

    let metadataHtml = "";
    if (entry.metadata && Object.keys(entry.metadata).length > 0) {
      const metadataItems = Object.entries(entry.metadata)
        .map(
          ([key, value]) =>
            `<div class="metadata-item"><span class="metadata-key">${this.escapeHtml(key)}:</span> <span class="metadata-value">${this.escapeHtml(JSON.stringify(value))}</span></div>`,
        )
        .join("");
      metadataHtml = `<div class="metadata"><div class="metadata-title">Metadata</div>${metadataItems}</div>`;
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Log Entry - ${this.escapeHtml(entry.id)}</title>
  <style>${fontFaceRule}${css}</style>
</head>
<body>
  <div class="log-entry">
    ${headerHtml}
    ${messageHtml}
    ${metadataHtml}
  </div>
</body>
</html>`;
  }

  /**
   * Escape HTML entities to prevent XSS
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  /**
   * Get CSS class for log level
   */
  private getLevelClass(level: string): string {
    const normalized = level.toLowerCase();
    if (normalized === "warn" || normalized === "warning") return "level-warn";
    if (normalized === "error" || normalized === "err") return "level-error";
    if (normalized === "debug") return "level-debug";
    return "level-info";
  }

  /**
   * Convert a font file path to a file:// URL for Playwright setContent() compatibility
   */
  private toFontFileUrl(fontPath: string): string {
    const absolutePath = resolve(fontPath);
    return pathToFileURL(absolutePath).href;
  }

  /**
   * Get font format from file extension
   */
  private getFontFormat(fontPath: string): string {
    const ext = fontPath.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "woff2":
        return "woff2";
      case "woff":
        return "woff";
      case "otf":
        return "opentype";
      case "ttf":
      default:
        return "truetype";
    }
  }
}
