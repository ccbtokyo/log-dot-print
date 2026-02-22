import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  LogEntry,
  LogFormatterPlugin,
  SystemConfig,
  TypedEventEmitter,
  ReplayFormatConfig,
  PrintContentType,
  GameplayPayload,
  GameplayRespawnInfo,
} from "../core/index.js";
import { paperNameToCssPageSize } from "./paper-size-resolver.js";

/**
 * Default re:play format configuration
 */
const DEFAULT_CONFIG: Required<
  Omit<ReplayFormatConfig, "outputFormat" | "css" | "fontPath" | "sideMargin" | "pdfPaperSize">
> & {
  outputFormat: "replay";
  css?: string;
  fontPath?: string;
  sideMargin: number;
  pdfPaperSize?: string;
} = {
  outputFormat: "replay",
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  fontSize: 16,
  pageWidth: 80,
  sideMargin: 10,
  npcColor: "#333",
  playerColor: "#333",
};

/**
 * Re:play formatter for gameplay conversation visualization
 * Formats gameplay JSON payloads as HTML chat UI
 *
 * Input format (in entry.message) — 1 送信 = 1 オブジェクト:
 *
 * 会話: { "npc": { ... }, "dialogue": [ ... ] }
 * 会話+respawn: { "npc": { ... }, "dialogue": [ ... ], "respawn": { ... } }
 * respawn のみ: { "respawn": { "nickname": "Toshi", "age": "40s", "gender": "male" } }
 *
 * @see /Users/eotel/ghq/github.com/ccbtokyo/log-dot-print/plans/gameplay-json-plan.md
 * @related HtmlFormatter
 */
export class ReplayFormatter implements LogFormatterPlugin {
  readonly name = "replay-formatter";
  readonly version = "1.0.0";

  private config: typeof DEFAULT_CONFIG = { ...DEFAULT_CONFIG };

  async initialize(_eventBus: TypedEventEmitter, config: SystemConfig): Promise<void> {
    if (config.format?.outputFormat === "replay") {
      const replayConfig = config.format as ReplayFormatConfig;
      this.config = this.sanitizeConfig(replayConfig);
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
   * Format a log entry containing chat messages as HTML
   */
  format(entry: LogEntry): string {
    let payload: GameplayPayload;

    try {
      const parsed: unknown = JSON.parse(entry.message);
      if (!this.isRecord(parsed)) {
        return this.renderError("Invalid format: expected a gameplay JSON object");
      }
      const hasNpc = this.isRecord(parsed.npc);
      const hasDialogue = Array.isArray(parsed.dialogue);
      const hasRespawn = this.isRecord(parsed.respawn);
      if (!hasNpc && !hasDialogue && !hasRespawn) {
        return this.renderError("Invalid format: expected 'npc'+'dialogue' and/or 'respawn' field");
      }
      payload = parsed as unknown as GameplayPayload;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return this.renderError(`JSON parse error: ${errorMessage}`);
    }

    return this.renderGameplayHtml(payload);
  }

  /**
   * Render chat messages as HTML
   */
  private renderGameplayHtml(payload: GameplayPayload): string {
    const { fontFamily, fontSize, sideMargin, npcColor, playerColor, fontPath, pdfPaperSize } =
      this.config;

    const safeFontFamily = this.sanitizeFontFamilyList(fontFamily);
    const safeFontSize = this.sanitizeNumber(fontSize, DEFAULT_CONFIG.fontSize, {
      min: 8,
      max: 512,
      integer: true,
    });
    const safeSideMargin = this.sanitizeNumber(sideMargin, DEFAULT_CONFIG.sideMargin, {
      min: 0,
      max: 512,
      integer: true,
    });
    const safeNpcColor = this.sanitizeHexColor(npcColor, DEFAULT_CONFIG.npcColor);
    const safePlayerColor = this.sanitizeHexColor(playerColor, DEFAULT_CONFIG.playerColor);
    const safeFontPath = this.sanitizeFontPath(fontPath);

    const primaryFontFamily = this.getPrimaryFontFamily(safeFontFamily);
    const fontFaceRule = safeFontPath
      ? `
    @font-face {
      font-family: '${this.escapeCssString(primaryFontFamily)}';
      src: url('${this.escapeCssString(this.toFontFileUrl(safeFontPath))}') format('${this.getFontFormat(safeFontPath)}');
      font-weight: normal;
      font-style: normal;
    }`
      : "";

    const cssPageSize = pdfPaperSize ? paperNameToCssPageSize(pdfPaperSize) : "";
    // Only append portrait keyword for standard page-size names (e.g. "A4").
    // Explicit dimensions (e.g. "11in 15.5in") already encode orientation via width/height.
    const pageSizeRule = cssPageSize
      ? cssPageSize.includes(" ")
        ? `size: ${cssPageSize};`
        : `size: ${cssPageSize} portrait;`
      : "";

    const css = `
    @page {
      ${pageSizeRule}
      margin: 10mm 0;
    }
    * {
      box-sizing: border-box;
    }
    body {
      font-family: ${safeFontFamily};
      font-size: ${safeFontSize}pt;
      line-height: 1.6;
      margin: 0;
      padding: 20px ${safeSideMargin}mm;
      background: #fff;
    }
    .player-footer {
      margin-top: 24px;
      padding-top: 12px;
      border-top: 2px solid #ccc;
    }
    .player-footer .attr-block {
      margin-bottom: 12px;
    }
    .player-footer .attr-label {
      font-weight: bold;
      font-size: 0.9em;
      color: #666;
      margin-bottom: 2px;
    }
    .player-footer .attr-value {
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .npc-section-header {
      font-weight: bold;
      margin-top: 20px;
      margin-bottom: 8px;
      padding: 4px 0;
    }
    .section-divider {
      border: none;
      border-top: 1px solid #ccc;
      margin: 20px 0;
    }
    .chat-container {
      max-width: 100%;
    }
    .message {
      margin-bottom: 4px;
      padding: 2px 0;
      max-width: 50%;
    }
    .message.npc {
      text-align: left;
      color: ${safeNpcColor};
      margin-right: auto;
    }
    .message.player {
      text-align: right;
      color: ${safePlayerColor};
      margin-left: auto;
    }`;

    const respawn: GameplayRespawnInfo | undefined = payload.respawn;
    const playerNickname = respawn?.nickname ?? "Player";

    const footerHtml = respawn ? this.renderFooterHtml(respawn) : "";

    let sectionsHtml = "";
    if (payload.npc) {
      const npcNickname = payload.npc.nickname ?? "NPC";
      const npcHeader = `
    <div class="npc-section-header">${this.escapeHtml(npcNickname)}</div>`;

      const dialogue = Array.isArray(payload.dialogue) ? payload.dialogue : [];
      const dialogueHtml = dialogue
        .map((entry) => {
          const typeClass = entry.role === "player" ? "player" : "npc";
          const speaker =
            entry.role === "player"
              ? this.escapeHtml(playerNickname)
              : this.escapeHtml(npcNickname);
          const content = `${speaker}: ${this.escapeHtml(entry.text)}`;
          return `\n    <div class="message ${typeClass}">${content}</div>`;
        })
        .join("");

      sectionsHtml = `${npcHeader}${dialogueHtml}`;
    }

    return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Chat History</title>
  <style>${fontFaceRule}${css}</style>
</head>
<body>
  <div class="chat-container">${sectionsHtml}${footerHtml}
  </div>
</body>
</html>`;
  }

  /**
   * Render an error page
   */
  private renderError(message: string): string {
    const { fontFamily, fontSize } = this.config;
    const safeFontFamily = this.sanitizeFontFamilyList(fontFamily);
    const safeFontSize = this.sanitizeNumber(fontSize, DEFAULT_CONFIG.fontSize, {
      min: 8,
      max: 512,
      integer: true,
    });

    return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error</title>
  <style>
    body {
      font-family: ${safeFontFamily};
      font-size: ${safeFontSize}pt;
      margin: 0;
      padding: 20px;
      color: #333;
    }
    .error {
      background: #ffebee;
      border: 1px solid #ef5350;
      border-radius: 4px;
      padding: 16px;
      color: #c62828;
    }
    .error-title {
      font-weight: bold;
      margin-bottom: 8px;
    }
  </style>
</head>
<body>
  <div class="error">
    <div class="error-title">Format Error</div>
    <div>${this.escapeHtml(message)}</div>
  </div>
</body>
</html>`;
  }

  private renderFooterHtml(respawn: GameplayRespawnInfo): string {
    const blocks: string[] = [];

    blocks.push(this.renderAttrBlock("名前 / Nickname", this.escapeHtml(respawn.nickname)));
    blocks.push(
      this.renderAttrBlock("年代 / Age Group", this.escapeHtml(this.localizeAge(respawn.age))),
    );
    blocks.push(
      this.renderAttrBlock("性別 / Gender", this.escapeHtml(this.localizeGender(respawn.gender))),
    );

    const optionalFields: Array<{ label: string; value: string | undefined }> = [
      { label: "悩み・葛藤 / Complaints &amp; Troubles", value: respawn.complaint_troubles },
      { label: "本音 / True Feelings", value: respawn.confession_true_feelings },
      { label: "心の変化 / Rediscovering Relief", value: respawn.rediscovering_relief },
      { label: "背景設定 / Backstory", value: respawn.convai_backstory },
    ];

    for (const field of optionalFields) {
      const text = this.toSafeText(field.value).trim();
      if (text.length > 0) {
        blocks.push(this.renderAttrBlock(field.label, this.escapeHtml(text)));
      }
    }

    return `
    <div class="player-footer">${blocks.join("")}
    </div>`;
  }

  private renderAttrBlock(label: string, escapedValue: string): string {
    return `
      <div class="attr-block">
        <div class="attr-label">${label}</div>
        <div class="attr-value">${escapedValue}</div>
      </div>`;
  }

  private localizeAge(age: string): string {
    const safeAge = this.toSafeText(age);
    const match = safeAge.match(/^(\d+)s$/);
    if (match) {
      return `${safeAge} （${match[1]}代）`;
    }
    return safeAge;
  }

  private localizeGender(gender: string): string {
    const safeGender = this.toSafeText(gender);
    const map: Record<string, string> = {
      male: "男性",
      female: "女性",
      other: "その他",
    };
    const japanese = map[safeGender.toLowerCase()];
    if (japanese) {
      return `${safeGender}（${japanese}）`;
    }
    return safeGender;
  }

  /**
   * Escape HTML entities to prevent XSS
   */
  private escapeHtml(text: unknown): string {
    return this.toSafeText(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  private toSafeText(value: unknown): string {
    if (typeof value === "string") return value;
    if (value === null || value === undefined) return "";
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
      return String(value);
    }
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  private sanitizeConfig(replayConfig: ReplayFormatConfig): typeof DEFAULT_CONFIG {
    const fontFamily =
      typeof replayConfig.fontFamily === "string" && replayConfig.fontFamily.trim().length > 0
        ? replayConfig.fontFamily
        : DEFAULT_CONFIG.fontFamily;

    const fontSize = this.sanitizeNumber(replayConfig.fontSize, DEFAULT_CONFIG.fontSize, {
      min: 8,
      max: 512,
      integer: true,
    });

    const pageWidth = this.sanitizeNumber(replayConfig.pageWidth, DEFAULT_CONFIG.pageWidth, {
      min: 10,
      max: 300,
      integer: true,
    });

    const sideMargin = this.sanitizeNumber(replayConfig.sideMargin, DEFAULT_CONFIG.sideMargin, {
      min: 0,
      max: 512,
      integer: true,
    });

    const npcColor = this.sanitizeHexColor(replayConfig.npcColor, DEFAULT_CONFIG.npcColor);
    const playerColor = this.sanitizeHexColor(replayConfig.playerColor, DEFAULT_CONFIG.playerColor);

    const css = typeof replayConfig.css === "string" ? replayConfig.css : undefined;
    const fontPath = this.sanitizeFontPath(replayConfig.fontPath);

    const pdfPaperSize =
      typeof replayConfig.pdfPaperSize === "string" && replayConfig.pdfPaperSize.trim().length > 0
        ? replayConfig.pdfPaperSize
        : undefined;

    return {
      outputFormat: "replay",
      fontFamily,
      fontSize,
      pageWidth,
      sideMargin,
      npcColor,
      playerColor,
      css,
      fontPath,
      pdfPaperSize,
    };
  }

  private getPrimaryFontFamily(fontFamily: string): string {
    const first = fontFamily.split(",")[0]?.trim() ?? "";
    if (first.startsWith("'") && first.endsWith("'")) return first.slice(1, -1);
    if (first.startsWith('"') && first.endsWith('"')) return first.slice(1, -1);
    return first;
  }

  private escapeCssString(value: string): string {
    // Escape CSS-string context and also neutralize `</style>`-style breakouts inside a <style> tag.
    return value
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'")
      .replace(/</g, "\\3C ")
      .replace(/>/g, "\\3E ")
      .replace(/\r/g, "\\D ")
      .replace(/\n/g, "\\A ");
  }

  private sanitizeNumber(
    value: unknown,
    fallback: number,
    options: { min: number; max: number; integer: boolean },
  ): number {
    const num = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(num)) return fallback;
    if (num < options.min || num > options.max) return fallback;
    return options.integer ? Math.round(num) : num;
  }

  private sanitizeHexColor(value: unknown, fallback: string): string {
    if (typeof value !== "string") return fallback;
    const trimmed = value.trim();
    if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed)) return trimmed;
    return fallback;
  }

  private sanitizeFontPath(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;
    if (/[\0\r\n<>]/.test(trimmed)) return undefined;
    // Disallow obviously dangerous schemes.
    if (/^(?:javascript|data):/i.test(trimmed)) return undefined;
    return trimmed;
  }

  private sanitizeFontFamilyList(fontFamily: string): string {
    const parts = fontFamily
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .filter((p) => !/[<>]/.test(p));

    const sanitized = parts
      .map((part) => {
        const unquoted = part.replace(/^['"]|['"]$/g, "");
        const lower = unquoted.toLowerCase();
        if (this.isGenericFontFamily(lower)) return lower;
        return `'${this.escapeCssString(unquoted)}'`;
      })
      .filter((p) => p.length > 0);

    if (sanitized.length > 0) return sanitized.join(", ");
    return this.sanitizeFontFamilyList(DEFAULT_CONFIG.fontFamily);
  }

  private isGenericFontFamily(value: string): boolean {
    return (
      value === "serif" ||
      value === "sans-serif" ||
      value === "monospace" ||
      value === "cursive" ||
      value === "fantasy" ||
      value === "system-ui" ||
      value === "ui-serif" ||
      value === "ui-sans-serif" ||
      value === "ui-monospace" ||
      value === "ui-rounded" ||
      value === "emoji" ||
      value === "math" ||
      value === "fangsong"
    );
  }

  /**
   * Get font format from file extension
   */
  /**
   * Convert a font file path to a file:// URL for Playwright setContent() compatibility
   */
  private toFontFileUrl(fontPath: string): string {
    const absolutePath = resolve(fontPath);
    return pathToFileURL(absolutePath).href;
  }

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
