import type {
  LogEntry,
  LogFormatterPlugin,
  SystemConfig,
  TypedEventEmitter,
  ReplayFormatConfig,
  PrintContentType,
} from "../core/index.js";

/**
 * Chat message structure for re:play formatter
 */
interface ChatMessage {
  timestamp: string;
  username: string;
  type: "npc" | "player";
  message: string;
}

/**
 * Default re:play format configuration
 */
const DEFAULT_CONFIG: Required<Omit<ReplayFormatConfig, "outputFormat" | "css" | "fontPath">> & {
  outputFormat: "replay";
  css?: string;
  fontPath?: string;
} = {
  outputFormat: "replay",
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  fontSize: 14,
  pageWidth: 80,
  npcColor: "#333",
  playerColor: "#333",
};

/**
 * Re:play formatter for chat history visualization
 * Formats JSON chat message arrays as HTML chat UI
 *
 * Input format (in entry.message):
 * ```json
 * [
 *   {"timestamp": "2024-01-15T10:30:00Z", "username": "NPC1", "type": "npc", "message": "こんにちは"},
 *   {"timestamp": "2024-01-15T10:30:05Z", "username": "Player1", "type": "player", "message": "やあ!"}
 * ]
 * ```
 *
 * Output format per message:
 * ```
 * {HH:mm}｜{name}
 * {message}
 * ```
 *
 * @see /Users/eotel/ghq/github.com/ccbtokyo/log-dot-print/plans/replay-formatter-plan.md
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
    let messages: ChatMessage[];

    try {
      const parsed: unknown = JSON.parse(entry.message);
      if (!Array.isArray(parsed)) {
        return this.renderError("Invalid format: expected an array of chat messages");
      }
      messages = this.normalizeMessages(parsed);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return this.renderError(`JSON parse error: ${errorMessage}`);
    }

    return this.renderChatHtml(messages);
  }

  /**
   * Render chat messages as HTML
   */
  private renderChatHtml(messages: ChatMessage[]): string {
    const { fontFamily, fontSize, pageWidth, npcColor, playerColor, fontPath } = this.config;

    const safeFontFamily = this.sanitizeFontFamilyList(fontFamily);
    const safeFontSize = this.sanitizeNumber(fontSize, DEFAULT_CONFIG.fontSize, {
      min: 8,
      max: 72,
      integer: true,
    });
    const safePageWidth = this.sanitizeNumber(pageWidth, DEFAULT_CONFIG.pageWidth, {
      min: 10,
      max: 300,
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
      src: url('${this.escapeCssString(safeFontPath)}') format('${this.getFontFormat(safeFontPath)}');
      font-weight: normal;
      font-style: normal;
    }`
      : "";

    const css = `
    @page {
      size: ${safePageWidth}mm auto;
      margin: 10mm;
    }
    * {
      box-sizing: border-box;
    }
    body {
      font-family: ${safeFontFamily};
      font-size: ${safeFontSize}px;
      line-height: 1.6;
      margin: 0;
      padding: 20px;
      background: #fff;
    }
    .chat-container {
      max-width: 100%;
    }
    .message {
      margin-bottom: 16px;
      padding: 8px 0;
    }
    .message.npc {
      text-align: left;
      color: ${safeNpcColor};
    }
    .message.player {
      text-align: right;
      color: ${safePlayerColor};
    }`;

    const messagesHtml = messages
      .map((msg) => {
        const typeClass = msg.type === "player" ? "player" : "npc";
        const timeStr = this.formatTime(msg.timestamp);
        const content = `[${this.escapeHtml(msg.username)}] ${this.escapeHtml(timeStr)} | ${this.escapeHtml(msg.message)}`;

        return `
    <div class="message ${typeClass}">${content}</div>`;
      })
      .join("");

    return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Chat History</title>
  <style>${fontFaceRule}${css}</style>
</head>
<body>
  <div class="chat-container">${messagesHtml}
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
      max: 72,
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
      font-size: ${safeFontSize}px;
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

  /**
   * Format ISO timestamp to HH:mm
   */
  private formatTime(isoTimestamp: string): string {
    try {
      const date = new Date(isoTimestamp);
      if (Number.isNaN(date.getTime())) {
        return "--:--";
      }
      const hours = date.getHours().toString().padStart(2, "0");
      const minutes = date.getMinutes().toString().padStart(2, "0");
      return `${hours}:${minutes}`;
    } catch {
      return "--:--";
    }
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

  private normalizeMessages(parsed: unknown[]): ChatMessage[] {
    return parsed.map((item) => this.normalizeMessage(item));
  }

  private normalizeMessage(item: unknown): ChatMessage {
    if (!this.isRecord(item)) {
      return {
        timestamp: "",
        username: "Unknown",
        type: "npc",
        message: this.toSafeText(item),
      };
    }

    const timestamp = typeof item.timestamp === "string" ? item.timestamp : "";
    const usernameRaw = typeof item.username === "string" ? item.username : "";
    const username = usernameRaw.trim().length > 0 ? usernameRaw : "Unknown";

    const type = item.type === "player" ? "player" : "npc";

    const message =
      typeof item.message === "string"
        ? item.message
        : item.message === undefined
          ? ""
          : this.toSafeText(item.message);

    return { timestamp, username, type, message };
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
      max: 72,
      integer: true,
    });

    const pageWidth = this.sanitizeNumber(replayConfig.pageWidth, DEFAULT_CONFIG.pageWidth, {
      min: 10,
      max: 300,
      integer: true,
    });

    const npcColor = this.sanitizeHexColor(replayConfig.npcColor, DEFAULT_CONFIG.npcColor);
    const playerColor = this.sanitizeHexColor(replayConfig.playerColor, DEFAULT_CONFIG.playerColor);

    const css = typeof replayConfig.css === "string" ? replayConfig.css : undefined;
    const fontPath = this.sanitizeFontPath(replayConfig.fontPath);

    return {
      outputFormat: "replay",
      fontFamily,
      fontSize,
      pageWidth,
      npcColor,
      playerColor,
      css,
      fontPath,
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
