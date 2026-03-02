import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  LogEntry,
  LogFormatterPlugin,
  SystemConfig,
  TypedEventEmitter,
  ReplayFormatConfig,
  PrintContentType,
  GameplayConversation,
  GameplayRespawnInfo,
} from "../core/index.js";
import { paperNameToCssPageSize } from "./paper-size-resolver.js";

/**
 * Default re:play format configuration
 */
const DEFAULT_CONFIG: Required<
  Omit<
    ReplayFormatConfig,
    | "outputFormat"
    | "css"
    | "fontPath"
    | "sideMargin"
    | "pdfPaperSize"
    | "creditFontPath"
    | "creditFontFamily"
  >
> & {
  outputFormat: "replay";
  css?: string;
  fontPath?: string;
  sideMargin: number;
  pdfPaperSize?: string;
  creditFontPath?: string;
  creditFontFamily?: string;
} = {
  outputFormat: "replay",
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  fontSize: 16,
  pageWidth: 80,
  sideMargin: 10,
  npcColor: "#333",
  playerColor: "#333",
  skipRespawn: true,
};

/**
 * Re:play formatter for multi-conversation gameplay visualization
 * Formats gameplay JSON payloads as HTML chat UI
 *
 * Input format (in entry.message):
 *
 * { "gameplay": [{ "npc": {...}, "dialogue": [...] }, ...], "respawn": {...} }
 *
 * @see /Users/eotel/ghq/github.com/ccbtokyo/log-dot-print/plans/gameplay-json-plan.md
 * @related HtmlFormatter
 */
export class ReplayFormatter implements LogFormatterPlugin {
  readonly name = "replay-formatter";
  readonly version = "1.0.0";

  private config: typeof DEFAULT_CONFIG = { ...DEFAULT_CONFIG };
  private fontDataUri: string | undefined;
  private creditFontDataUri: string | undefined;

  async initialize(_eventBus: TypedEventEmitter, config: SystemConfig): Promise<void> {
    if (config.format?.outputFormat === "replay") {
      const replayConfig = config.format as ReplayFormatConfig;
      this.config = this.sanitizeConfig(replayConfig);
    }
    this.fontDataUri = this.config.fontPath
      ? await this.loadFontAsDataUri(this.config.fontPath)
      : undefined;
    this.creditFontDataUri = this.config.creditFontPath
      ? await this.loadFontAsDataUri(this.config.creditFontPath)
      : undefined;
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
    try {
      const parsed: unknown = JSON.parse(entry.message);
      if (!this.isRecord(parsed)) {
        return this.renderError("Invalid format: expected a gameplay JSON object");
      }
      const hasGameplay = Array.isArray(parsed.gameplay);
      const hasRespawn = this.isRecord(parsed.respawn);
      if (!hasGameplay && !hasRespawn) {
        return this.renderError("Invalid format: expected 'gameplay' array and/or 'respawn' field");
      }
      const conversations = this.parseConversations(parsed.gameplay);
      if (conversations.length === 0 && !hasRespawn) {
        return this.renderError("Invalid format: 'gameplay' array is empty and no 'respawn' field");
      }
      const respawn = hasRespawn ? (parsed.respawn as GameplayRespawnInfo) : undefined;
      if (this.config.skipRespawn && conversations.length === 0) {
        return "";
      }
      const effectiveRespawn = this.config.skipRespawn ? undefined : respawn;
      return this.renderGameplayHtml({
        conversations,
        respawn: effectiveRespawn,
        playerNickname: respawn?.nickname,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return this.renderError(`JSON parse error: ${errorMessage}`);
    }
  }

  /**
   * Render chat messages as HTML
   */
  private renderGameplayHtml(payload: {
    conversations: GameplayConversation[];
    respawn?: GameplayRespawnInfo;
    playerNickname?: string;
  }): string {
    const {
      fontFamily,
      fontSize,
      sideMargin,
      npcColor,
      playerColor,
      fontPath,
      pdfPaperSize,
      creditFontPath,
      creditFontFamily,
    } = this.config;

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
    const fontFaceRule = this.fontDataUri
      ? `
    @font-face {
      font-family: '${this.escapeCssString(primaryFontFamily)}';
      src: url('${this.fontDataUri}') format('${this.getFontFormat(safeFontPath!)}');
      font-weight: normal;
      font-style: normal;
    }`
      : "";

    const safeCreditFontPath = this.sanitizeFontPath(creditFontPath);
    // Only apply credit font when a valid non-generic font family was explicitly provided.
    // sanitizeFontFamilyList() falls back to the default system font stack when input is
    // entirely invalid, which would cause the credit @font-face to collide with the body font.
    const safeCreditFontFamily = creditFontFamily
      ? this.sanitizeCreditFontFamily(creditFontFamily)
      : undefined;
    const creditPrimaryFontFamily = safeCreditFontFamily
      ? this.getPrimaryFontFamily(safeCreditFontFamily)
      : undefined;
    const creditFontFaceRule =
      this.creditFontDataUri && creditPrimaryFontFamily
        ? `
    @font-face {
      font-family: '${this.escapeCssString(creditPrimaryFontFamily)}';
      src: url('${this.creditFontDataUri}') format('${this.getFontFormat(safeCreditFontPath!)}');
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
      margin: 0;
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
      border-top: 1px solid #ccc;
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
    .artwork-credit {
      margin-top: 192px;
      margin-bottom: 192px;
      text-align: center;
      font-weight: bold;
      font-size: 1.2em;
      letter-spacing: 0.1em;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 16px;${safeCreditFontFamily ? `\n      font-family: ${safeCreditFontFamily};` : ""}
    }
    .artwork-credit::before,
    .artwork-credit::after {
      content: '';
      display: inline-block;
      width: 320px;
      border-top: 2px solid #ccc;
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
      margin: 32px 0;
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

    const respawn = payload.respawn;
    const playerNickname = payload.playerNickname ?? respawn?.nickname ?? "Player";

    const footerHtml = respawn ? this.renderFooterHtml(respawn) : "";
    const creditHtml = this.renderCreditHtml();

    const sectionsHtml = payload.conversations
      .map((conv, index) => {
        const divider = index > 0 ? `\n    <div class="section-divider"></div>` : "";
        const npcNickname = conv.npc?.nickname ?? "NPC";
        const npcHeader = `\n    <div class="npc-section-header">${this.escapeHtml(npcNickname)}</div>`;
        const dialogue = Array.isArray(conv.dialogue) ? conv.dialogue : [];
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
        return `${divider}${npcHeader}${dialogueHtml}`;
      })
      .join("");

    return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Chat History</title>
  <style>${fontFaceRule}${creditFontFaceRule}${css}</style>
</head>
<body>
  <div class="chat-container">${sectionsHtml}${footerHtml}${creditHtml}
  </div>
</body>
</html>`;
  }

  private parseConversations(gameplay: unknown): GameplayConversation[] {
    if (!Array.isArray(gameplay)) return [];
    const result: GameplayConversation[] = [];
    for (const item of gameplay) {
      if (!this.isRecord(item) || !this.isRecord(item.npc)) continue;
      result.push({
        npc: item.npc as unknown as GameplayConversation["npc"],
        dialogue: Array.isArray(item.dialogue)
          ? (item.dialogue as GameplayConversation["dialogue"])
          : [],
      });
    }
    return result;
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

  private renderCreditHtml(): string {
    return `
    <div class="artwork-credit">RE:SPAWN READY</div>`;
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
      nonbinary: "ノンバイナリー",
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

    const skipRespawn =
      typeof replayConfig.skipRespawn === "boolean"
        ? replayConfig.skipRespawn
        : DEFAULT_CONFIG.skipRespawn;

    const creditFontPath = this.sanitizeFontPath(replayConfig.creditFontPath);
    const creditFontFamily =
      typeof replayConfig.creditFontFamily === "string" &&
      replayConfig.creditFontFamily.trim().length > 0
        ? replayConfig.creditFontFamily
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
      skipRespawn,
      creditFontPath,
      creditFontFamily,
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

  /**
   * Sanitize a credit font family list.
   * Unlike sanitizeFontFamilyList(), returns undefined when the input contains
   * no valid non-generic font family names, preventing fallback to the default
   * system font stack (which would collide with the body font).
   */
  private sanitizeCreditFontFamily(fontFamily: string): string | undefined {
    const parts = fontFamily
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .filter((p) => !/[<>]/.test(p));

    const hasNonGeneric = parts.some((part) => {
      const unquoted = part.replace(/^['"]|['"]$/g, "");
      return !this.isGenericFontFamily(unquoted.toLowerCase());
    });

    if (!hasNonGeneric) return undefined;
    return this.sanitizeFontFamilyList(fontFamily);
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
   * Read a font file and return a base64 data URI.
   * Playwright's page.setContent() loads pages at about:blank origin,
   * which blocks file:// URLs. Embedding fonts as data URIs avoids this.
   */
  private async loadFontAsDataUri(fontPath: string): Promise<string | undefined> {
    const absolutePath = resolve(fontPath);
    try {
      // Use fetch + file:// URL to handle Unicode filenames on Windows.
      // Bun.file() and node:fs fail with Japanese characters on Windows.
      const fileUrl = pathToFileURL(absolutePath);
      const response = await fetch(fileUrl);
      if (!response.ok) {
        console.warn(`[ReplayFormatter] Font file not found: ${absolutePath}`);
        return undefined;
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      const base64 = Buffer.from(bytes).toString("base64");
      const mimeType = this.getFontMimeType(fontPath);
      return `data:${mimeType};base64,${base64}`;
    } catch {
      console.warn(`[ReplayFormatter] Font file not found: ${absolutePath}`);
      return undefined;
    }
  }

  private getFontMimeType(fontPath: string): string {
    const ext = fontPath.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "woff2":
        return "font/woff2";
      case "woff":
        return "font/woff";
      case "otf":
        return "font/otf";
      case "ttf":
      default:
        return "font/ttf";
    }
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
