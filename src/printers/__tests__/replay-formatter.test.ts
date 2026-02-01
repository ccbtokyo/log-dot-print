import { describe, test, expect, beforeEach } from "bun:test";
import { ReplayFormatter } from "../replay-formatter.js";
import type { LogEntry, SystemConfig, ReplayFormatConfig } from "../../core/types.js";
import { TypedEventEmitter } from "../../core/events.js";

/**
 * ReplayFormatter tests
 *
 * @see /Users/eotel/ghq/github.com/ccbtokyo/log-dot-print/plans/replay-formatter-plan.md
 * @related HtmlFormatter
 */
describe("ReplayFormatter", () => {
  let formatter: ReplayFormatter;
  let eventBus: TypedEventEmitter;

  const createLogEntry = (message: string): LogEntry => ({
    id: "test-id-123",
    timestamp: "2024-01-15T10:30:00Z",
    level: "info",
    source: "chat",
    message,
    printed: false,
  });

  const createConfig = (formatConfig?: Partial<ReplayFormatConfig>): SystemConfig => ({
    server: { port: 3000, host: "localhost" },
    printer: { type: "mock", options: {} },
    queue: { maxSize: 100, retryAttempts: 3, retryDelayMs: 1000 },
    format: { outputFormat: "replay", ...formatConfig },
  });

  beforeEach(async () => {
    formatter = new ReplayFormatter();
    eventBus = new TypedEventEmitter();
  });

  describe("basic properties", () => {
    test("has correct name", () => {
      expect(formatter.name).toBe("replay-formatter");
    });

    test("has correct version", () => {
      expect(formatter.version).toBe("1.0.0");
    });

    test("returns html content type", () => {
      expect(formatter.getContentType()).toBe("html");
    });
  });

  describe("HTML structure", () => {
    test("generates valid HTML structure with DOCTYPE", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(
        JSON.stringify([
          { timestamp: "2024-01-15T10:30:00Z", username: "NPC1", type: "npc", message: "Hello" },
        ]),
      );
      const html = formatter.format(entry);

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("<html");
      expect(html).toContain("<head>");
      expect(html).toContain("<body>");
      expect(html).toContain("</html>");
    });

    test("sets lang attribute to ja", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(
        JSON.stringify([
          { timestamp: "2024-01-15T10:30:00Z", username: "NPC1", type: "npc", message: "Hello" },
        ]),
      );
      const html = formatter.format(entry);

      expect(html).toContain('lang="ja"');
    });
  });

  describe("message rendering", () => {
    test("renders NPC messages with npc class (left-aligned)", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(
        JSON.stringify([
          {
            timestamp: "2024-01-15T10:30:00Z",
            username: "NPC1",
            type: "npc",
            message: "こんにちは",
          },
        ]),
      );
      const html = formatter.format(entry);

      expect(html).toContain('class="message npc"');
      expect(html).toContain("こんにちは");
    });

    test("renders Player messages with player class (right-aligned)", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(
        JSON.stringify([
          {
            timestamp: "2024-01-15T10:30:05Z",
            username: "Player1",
            type: "player",
            message: "やあ!",
          },
        ]),
      );
      const html = formatter.format(entry);

      expect(html).toContain('class="message player"');
      expect(html).toContain("やあ!");
    });

    test("renders message in correct format ([name] HH:mm | message)", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(
        JSON.stringify([
          {
            timestamp: "2024-01-15T10:30:00Z",
            username: "NPC1",
            type: "npc",
            message: "Hello",
          },
        ]),
      );
      const html = formatter.format(entry);

      // Should contain "[NPC1] 10:30 | Hello" format
      expect(html).toContain("[NPC1]");
      expect(html).toContain("10:30");
      expect(html).toContain(" | ");
      expect(html).toContain("Hello");
    });

    test("renders multiple messages in order", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(
        JSON.stringify([
          {
            timestamp: "2024-01-15T10:30:00Z",
            username: "NPC1",
            type: "npc",
            message: "Message 1",
          },
          {
            timestamp: "2024-01-15T10:30:05Z",
            username: "Player1",
            type: "player",
            message: "Message 2",
          },
          {
            timestamp: "2024-01-15T10:30:10Z",
            username: "NPC2",
            type: "npc",
            message: "Message 3",
          },
        ]),
      );
      const html = formatter.format(entry);

      const msg1Pos = html.indexOf("Message 1");
      const msg2Pos = html.indexOf("Message 2");
      const msg3Pos = html.indexOf("Message 3");

      expect(msg1Pos).toBeLessThan(msg2Pos);
      expect(msg2Pos).toBeLessThan(msg3Pos);
    });
  });

  describe("XSS prevention", () => {
    test("escapes HTML in username", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(
        JSON.stringify([
          {
            timestamp: "2024-01-15T10:30:00Z",
            username: "<script>alert('xss')</script>",
            type: "npc",
            message: "Test",
          },
        ]),
      );
      const html = formatter.format(entry);

      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
    });

    test("escapes HTML in message", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(
        JSON.stringify([
          {
            timestamp: "2024-01-15T10:30:00Z",
            username: "NPC1",
            type: "npc",
            message: '<img src="x" onerror="alert(1)">',
          },
        ]),
      );
      const html = formatter.format(entry);

      expect(html).not.toContain('<img src="x"');
      expect(html).toContain("&lt;img src=");
    });
  });

  describe("style/CSS injection prevention", () => {
    test("prevents breaking out of <style> via fontFamily", async () => {
      await formatter.initialize(
        eventBus,
        createConfig({
          fontFamily: "</style><script>alert('xss')</script><style>",
        }),
      );

      const entry = createLogEntry(
        JSON.stringify([
          { timestamp: "2024-01-15T10:30:00Z", username: "NPC1", type: "npc", message: "Test" },
        ]),
      );
      const html = formatter.format(entry);

      expect(html).not.toContain("<script>");
      expect(html).not.toContain("</style><script>");
    });

    test("rejects fontPath with unsafe characters", async () => {
      await formatter.initialize(
        eventBus,
        createConfig({
          fontFamily: "CustomFont",
          fontPath: "/fonts/custom.ttf</style><script>alert(1)</script><style>",
        }),
      );

      const entry = createLogEntry(
        JSON.stringify([
          { timestamp: "2024-01-15T10:30:00Z", username: "NPC1", type: "npc", message: "Test" },
        ]),
      );
      const html = formatter.format(entry);

      expect(html).not.toContain("<script>");
      expect(html).not.toContain("@font-face");
    });

    test("rejects non-hex colors to avoid CSS injection", async () => {
      await formatter.initialize(
        eventBus,
        createConfig({
          npcColor: "#333;}</style><script>alert(1)</script><style>",
        }),
      );

      const entry = createLogEntry(
        JSON.stringify([
          { timestamp: "2024-01-15T10:30:00Z", username: "NPC1", type: "npc", message: "Test" },
        ]),
      );
      const html = formatter.format(entry);

      // Invalid color should fall back to default
      expect(html).not.toContain("<script>");
      expect(html).toContain("color: #333");
      // The malicious string should not appear in the output
      expect(html).not.toContain("alert(1)");
    });
  });

  describe("error handling", () => {
    test("returns error HTML for invalid JSON", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry("not valid json");
      const html = formatter.format(entry);

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain('class="error"');
      expect(html).toContain("JSON");
    });

    test("returns error HTML for non-array JSON", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(JSON.stringify({ key: "value" }));
      const html = formatter.format(entry);

      expect(html).toContain('class="error"');
    });

    test("handles empty array gracefully", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(JSON.stringify([]));
      const html = formatter.format(entry);

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).not.toContain('class="error"');
    });
  });

  describe("edge cases", () => {
    test("handles null fields without throwing", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(
        JSON.stringify([{ timestamp: null, username: null, type: "player", message: null }]),
      );
      const html = formatter.format(entry);

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("Unknown");
      expect(html).toContain("--:--");
    });

    test("handles non-object items in the array", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(JSON.stringify([null, 1, "hello"]));
      const html = formatter.format(entry);

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("hello");
      expect(html).toContain("Unknown");
    });

    test("shows --:-- for invalid timestamps", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(
        JSON.stringify([
          { timestamp: "not-a-date", username: "NPC1", type: "npc", message: "Test" },
        ]),
      );
      const html = formatter.format(entry);

      expect(html).toContain("--:--");
    });
  });

  describe("configuration", () => {
    test("applies custom font family", async () => {
      await formatter.initialize(
        eventBus,
        createConfig({
          fontFamily: "Noto Sans JP",
        }),
      );

      const entry = createLogEntry(
        JSON.stringify([
          { timestamp: "2024-01-15T10:30:00Z", username: "NPC1", type: "npc", message: "Test" },
        ]),
      );
      const html = formatter.format(entry);

      expect(html).toContain("Noto Sans JP");
    });

    test("applies custom font size", async () => {
      await formatter.initialize(
        eventBus,
        createConfig({
          fontSize: 18,
        }),
      );

      const entry = createLogEntry(
        JSON.stringify([
          { timestamp: "2024-01-15T10:30:00Z", username: "NPC1", type: "npc", message: "Test" },
        ]),
      );
      const html = formatter.format(entry);

      expect(html).toContain("18px");
    });

    test("applies custom page width", async () => {
      await formatter.initialize(
        eventBus,
        createConfig({
          pageWidth: 80,
        }),
      );

      const entry = createLogEntry(
        JSON.stringify([
          { timestamp: "2024-01-15T10:30:00Z", username: "NPC1", type: "npc", message: "Test" },
        ]),
      );
      const html = formatter.format(entry);

      expect(html).toContain("80mm");
    });

    test("applies custom font path with @font-face", async () => {
      await formatter.initialize(
        eventBus,
        createConfig({
          fontFamily: "CustomFont",
          fontPath: "/fonts/custom.ttf",
        }),
      );

      const entry = createLogEntry(
        JSON.stringify([
          { timestamp: "2024-01-15T10:30:00Z", username: "NPC1", type: "npc", message: "Test" },
        ]),
      );
      const html = formatter.format(entry);

      expect(html).toContain("@font-face");
      expect(html).toContain("/fonts/custom.ttf");
      expect(html).toContain("truetype");
    });

    test("handles font family stacks with @font-face correctly", async () => {
      await formatter.initialize(
        eventBus,
        createConfig({
          fontFamily: "CustomFont, sans-serif",
          fontPath: "/fonts/custom.ttf",
        }),
      );

      const entry = createLogEntry(
        JSON.stringify([
          { timestamp: "2024-01-15T10:30:00Z", username: "NPC1", type: "npc", message: "Test" },
        ]),
      );
      const html = formatter.format(entry);

      // Body font uses sanitized font family list with proper quoting
      expect(html).toContain("font-family: 'CustomFont', sans-serif");
      // @font-face uses only the primary font name
      expect(html).toContain("font-family: 'CustomFont'");
      // Should not quote the entire comma-separated list
      expect(html).not.toContain("font-family: 'CustomFont, sans-serif'");
    });

    test("applies custom NPC color", async () => {
      await formatter.initialize(
        eventBus,
        createConfig({
          npcColor: "#ff0000",
        }),
      );

      const entry = createLogEntry(
        JSON.stringify([
          { timestamp: "2024-01-15T10:30:00Z", username: "NPC1", type: "npc", message: "Test" },
        ]),
      );
      const html = formatter.format(entry);

      expect(html).toContain("#ff0000");
    });

    test("applies custom Player color", async () => {
      await formatter.initialize(
        eventBus,
        createConfig({
          playerColor: "#00ff00",
        }),
      );

      const entry = createLogEntry(
        JSON.stringify([
          {
            timestamp: "2024-01-15T10:30:00Z",
            username: "Player1",
            type: "player",
            message: "Test",
          },
        ]),
      );
      const html = formatter.format(entry);

      expect(html).toContain("#00ff00");
    });

    test("falls back to defaults for non-positive sizes", async () => {
      await formatter.initialize(
        eventBus,
        createConfig({
          fontSize: 0,
          pageWidth: 0,
        }),
      );

      const entry = createLogEntry(
        JSON.stringify([
          { timestamp: "2024-01-15T10:30:00Z", username: "NPC1", type: "npc", message: "Test" },
        ]),
      );
      const html = formatter.format(entry);

      expect(html).toContain("14px");
      expect(html).toContain("80mm");
    });

    test("falls back to default colors for empty strings", async () => {
      await formatter.initialize(
        eventBus,
        createConfig({
          npcColor: "",
          playerColor: "#00ff00",
        }),
      );

      const entry = createLogEntry(
        JSON.stringify([
          { timestamp: "2024-01-15T10:30:00Z", username: "NPC1", type: "npc", message: "Test" },
          {
            timestamp: "2024-01-15T10:30:01Z",
            username: "Player1",
            type: "player",
            message: "Test",
          },
        ]),
      );
      const html = formatter.format(entry);

      expect(html).toContain(".message.npc");
      expect(html).toContain("color: #333");
      expect(html).toContain("color: #00ff00");
    });
  });

  describe("CSS styles", () => {
    test("includes CSS for npc left alignment", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(
        JSON.stringify([
          { timestamp: "2024-01-15T10:30:00Z", username: "NPC1", type: "npc", message: "Test" },
        ]),
      );
      const html = formatter.format(entry);

      expect(html).toContain(".message.npc");
      expect(html).toContain("text-align:");
    });

    test("includes CSS for player right alignment", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(
        JSON.stringify([
          { timestamp: "2024-01-15T10:30:00Z", username: "NPC1", type: "npc", message: "Test" },
        ]),
      );
      const html = formatter.format(entry);

      expect(html).toContain(".message.player");
    });
  });

  describe("lifecycle", () => {
    test("initialize with non-replay config uses defaults", async () => {
      const nonReplayConfig: SystemConfig = {
        server: { port: 3000, host: "localhost" },
        printer: { type: "mock", options: {} },
        queue: { maxSize: 100, retryAttempts: 3, retryDelayMs: 1000 },
        format: {
          outputFormat: "text",
          maxLineWidth: 80,
          includeTimestamp: true,
          includeSource: true,
          includeLevel: false,
        },
      };

      await formatter.initialize(eventBus, nonReplayConfig);

      const entry = createLogEntry(
        JSON.stringify([
          { timestamp: "2024-01-15T10:30:00Z", username: "NPC1", type: "npc", message: "Test" },
        ]),
      );
      const html = formatter.format(entry);

      // Should still work with default settings
      expect(html).toContain("<!DOCTYPE html>");
    });

    test("shutdown completes without error", async () => {
      await formatter.initialize(eventBus, createConfig());
      await expect(formatter.shutdown()).resolves.toBeUndefined();
    });
  });

  describe("API integration format", () => {
    test("formats ChatMessage array (as sent via API) into valid HTML", async () => {
      await formatter.initialize(eventBus, createConfig());

      // This is the exact format sent to POST /api/log
      // API receives array → JSON.stringify → entry.message
      const chatMessages = [
        {
          timestamp: "2024-01-15T10:30:00Z",
          username: "ガイドNPC",
          type: "npc",
          message: "ようこそ、冒険者よ。",
        },
        {
          timestamp: "2024-01-15T10:30:15Z",
          username: "プレイヤー",
          type: "player",
          message: "こんにちは！",
        },
        {
          timestamp: "2024-01-15T10:30:30Z",
          username: "ガイドNPC",
          type: "npc",
          message: "何かお手伝いできることはありますか？",
        },
      ];

      const entry = createLogEntry(JSON.stringify(chatMessages));
      const html = formatter.format(entry);

      // Verify HTML structure
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain('<html lang="ja">');
      expect(html).toContain("<head>");
      expect(html).toContain("<body>");
      expect(html).toContain("</html>");

      // Verify all messages are rendered
      expect(html).toContain("ガイドNPC");
      expect(html).toContain("プレイヤー");
      expect(html).toContain("ようこそ、冒険者よ。");
      expect(html).toContain("こんにちは！");
      expect(html).toContain("何かお手伝いできることはありますか？");

      // Verify message types
      expect(html).toContain('class="message npc"');
      expect(html).toContain('class="message player"');

      // Verify time formatting
      expect(html).toContain("10:30");

      // Verify no error state
      expect(html).not.toContain('class="error"');
    });

    test("contentType is html for persistence", async () => {
      await formatter.initialize(eventBus, createConfig());
      expect(formatter.getContentType()).toBe("html");
    });
  });
});
