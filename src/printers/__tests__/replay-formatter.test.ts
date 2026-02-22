import { describe, test, expect, beforeEach } from "bun:test";
import { ReplayFormatter } from "../replay-formatter.js";
import type {
  LogEntry,
  SystemConfig,
  ReplayFormatConfig,
  GameplayPayload,
} from "../../core/types.js";
import { TypedEventEmitter } from "../../core/events.js";

/**
 * ReplayFormatter tests — gameplay JSON format
 *
 * @see /Users/eotel/ghq/github.com/ccbtokyo/log-dot-print/plans/gameplay-json-plan.md
 * @related HtmlFormatter
 */
describe("ReplayFormatter", () => {
  let formatter: ReplayFormatter;
  let eventBus: TypedEventEmitter;

  const createPayload = (overrides?: Partial<GameplayPayload>): GameplayPayload => ({
    gameplay: [
      {
        npc: { replay_id: "r1", nickname: "sho" },
        dialogue: [
          { role: "player", text: "こんにちは" },
          { role: "npc", text: "こんにちは！元気ですか？" },
        ],
      },
    ],
    respawn: {
      nickname: "Toshi",
      age: "40s",
      gender: "male",
    },
    ...overrides,
  });

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

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("<html");
      expect(html).toContain("<head>");
      expect(html).toContain("<body>");
      expect(html).toContain("</html>");
    });

    test("sets lang attribute to ja", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).toContain('lang="ja"');
    });
  });

  describe("header rendering", () => {
    test("displays respawn nickname in header", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).toContain("Toshi");
      expect(html).toContain("player-header");
    });

    test("displays respawn age in header", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).toContain("40s");
    });

    test("displays respawn gender in header", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).toContain("male");
    });
  });

  describe("NPC section rendering", () => {
    test("displays NPC nickname as section header", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).toContain("npc-section-header");
      expect(html).toContain("sho");
    });

    test("renders section dividers between multiple NPC conversations", async () => {
      await formatter.initialize(eventBus, createConfig());

      const payload = createPayload({
        gameplay: [
          {
            npc: { replay_id: "r1", nickname: "sho" },
            dialogue: [{ role: "npc", text: "Hello" }],
          },
          {
            npc: { replay_id: "r2", nickname: "yuki" },
            dialogue: [{ role: "npc", text: "Hi" }],
          },
        ],
      });
      const entry = createLogEntry(JSON.stringify(payload));
      const html = formatter.format(entry);

      expect(html).toContain("sho");
      expect(html).toContain("yuki");
      expect(html).toContain("section-divider");
    });
  });

  describe("dialogue rendering", () => {
    test("renders NPC messages with npc class", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).toContain('class="message npc"');
      expect(html).toContain("こんにちは！元気ですか？");
    });

    test("renders Player messages with player class", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).toContain('class="message player"');
      expect(html).toContain("こんにちは");
    });

    test("NPC messages display npc.nickname as speaker", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      // NPC message should show NPC nickname
      const npcMessageMatch = html.match(/class="message npc"[^>]*>([^<]*(?:<[^>]*>[^<]*)*)/);
      expect(npcMessageMatch).not.toBeNull();
      expect(npcMessageMatch![0]).toContain("sho");
    });

    test("Player messages display respawn.nickname as speaker", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      // Player message should show respawn nickname
      const playerMessageMatch = html.match(/class="message player"[^>]*>([^<]*(?:<[^>]*>[^<]*)*)/);
      expect(playerMessageMatch).not.toBeNull();
      expect(playerMessageMatch![0]).toContain("Toshi");
    });

    test("renders multiple messages in order", async () => {
      await formatter.initialize(eventBus, createConfig());

      const payload = createPayload({
        gameplay: [
          {
            npc: { replay_id: "r1", nickname: "sho" },
            dialogue: [
              { role: "player", text: "Message 1" },
              { role: "npc", text: "Message 2" },
              { role: "player", text: "Message 3" },
            ],
          },
        ],
      });
      const entry = createLogEntry(JSON.stringify(payload));
      const html = formatter.format(entry);

      const msg1Pos = html.indexOf("Message 1");
      const msg2Pos = html.indexOf("Message 2");
      const msg3Pos = html.indexOf("Message 3");

      expect(msg1Pos).toBeLessThan(msg2Pos);
      expect(msg2Pos).toBeLessThan(msg3Pos);
    });

    test("does not render timestamps", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      // No timestamp-like patterns in message content
      expect(html).not.toContain("--:--");
      expect(html).not.toMatch(/class="message[^"]*"[^>]*>[^<]*\d{2}:\d{2}[^<]*/);
    });
  });

  describe("XSS prevention", () => {
    test("escapes HTML in NPC nickname", async () => {
      await formatter.initialize(eventBus, createConfig());

      const payload = createPayload({
        gameplay: [
          {
            npc: {
              replay_id: "r1",
              nickname: "<script>alert('xss')</script>",
            },
            dialogue: [{ role: "npc", text: "Test" }],
          },
        ],
      });
      const entry = createLogEntry(JSON.stringify(payload));
      const html = formatter.format(entry);

      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
    });

    test("escapes HTML in respawn nickname", async () => {
      await formatter.initialize(eventBus, createConfig());

      const payload = createPayload({
        respawn: {
          nickname: "<img src=x onerror=alert(1)>",
          age: "30s",
          gender: "female",
        },
      });
      const entry = createLogEntry(JSON.stringify(payload));
      const html = formatter.format(entry);

      expect(html).not.toContain("<img");
      expect(html).toContain("&lt;img");
    });

    test("escapes HTML in dialogue text", async () => {
      await formatter.initialize(eventBus, createConfig());

      const payload = createPayload({
        gameplay: [
          {
            npc: { replay_id: "r1", nickname: "NPC1" },
            dialogue: [
              {
                role: "npc",
                text: '<img src="x" onerror="alert(1)">',
              },
            ],
          },
        ],
      });
      const entry = createLogEntry(JSON.stringify(payload));
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

      const entry = createLogEntry(JSON.stringify(createPayload()));
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

      const entry = createLogEntry(JSON.stringify(createPayload()));
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

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).not.toContain("<script>");
      expect(html).toContain("color: #333");
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

    test("returns error HTML when gameplay key is missing", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(JSON.stringify({ key: "value" }));
      const html = formatter.format(entry);

      expect(html).toContain('class="error"');
    });

    test("returns error HTML when gameplay is not an array", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(JSON.stringify({ gameplay: "not-array", respawn: {} }));
      const html = formatter.format(entry);

      expect(html).toContain('class="error"');
    });

    test("handles empty dialogue array gracefully", async () => {
      await formatter.initialize(eventBus, createConfig());

      const payload = createPayload({
        gameplay: [
          {
            npc: { replay_id: "r1", nickname: "sho" },
            dialogue: [],
          },
        ],
      });
      const entry = createLogEntry(JSON.stringify(payload));
      const html = formatter.format(entry);

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).not.toContain('class="error"');
      expect(html).toContain("sho");
    });

    test("handles malformed gameplay element without npc field", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(
        JSON.stringify({
          gameplay: [{}],
          respawn: { nickname: "A", age: "20s", gender: "female" },
        }),
      );
      const html = formatter.format(entry);

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).not.toContain('class="error"');
    });

    test("handles malformed gameplay element with non-array dialogue", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(
        JSON.stringify({
          gameplay: [{ npc: { replay_id: "r1", nickname: "sho" }, dialogue: "not-array" }],
          respawn: { nickname: "A", age: "20s", gender: "female" },
        }),
      );
      const html = formatter.format(entry);

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).not.toContain('class="error"');
      expect(html).toContain("sho");
    });

    test("handles missing respawn gracefully", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(
        JSON.stringify({
          gameplay: [
            {
              npc: { replay_id: "r1", nickname: "sho" },
              dialogue: [{ role: "npc", text: "Hello" }],
            },
          ],
        }),
      );
      const html = formatter.format(entry);

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).not.toContain('class="error"');
      expect(html).toContain("sho");
    });

    test("handles empty gameplay array gracefully", async () => {
      await formatter.initialize(eventBus, createConfig());

      const payload = createPayload({ gameplay: [] });
      const entry = createLogEntry(JSON.stringify(payload));
      const html = formatter.format(entry);

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).not.toContain('class="error"');
    });
  });

  describe("configuration", () => {
    test("applies custom font family", async () => {
      await formatter.initialize(eventBus, createConfig({ fontFamily: "Noto Sans JP" }));

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).toContain("Noto Sans JP");
    });

    test("applies custom font size", async () => {
      await formatter.initialize(eventBus, createConfig({ fontSize: 18 }));

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).toContain("18px");
    });

    test("applies custom page width", async () => {
      await formatter.initialize(eventBus, createConfig({ pageWidth: 80 }));

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).toContain("80mm");
    });

    test("uses pdfPaperSize as CSS @page size when set to standard name", async () => {
      await formatter.initialize(eventBus, createConfig({ pdfPaperSize: "A4" }));

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).toContain("size: A4;");
    });

    test("uses pdfPaperSize as CSS @page size when set to Custom inch format", async () => {
      await formatter.initialize(eventBus, createConfig({ pdfPaperSize: "Custom.11x15.5in" }));

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).toContain("size: 11in 15.5in;");
    });

    test("falls back to pageWidth mm when pdfPaperSize is not set", async () => {
      await formatter.initialize(eventBus, createConfig({ pageWidth: 100 }));

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).toContain("size: 100mm auto;");
    });

    test("applies custom font path with @font-face", async () => {
      await formatter.initialize(
        eventBus,
        createConfig({
          fontFamily: "CustomFont",
          fontPath: "/fonts/custom.ttf",
        }),
      );

      const entry = createLogEntry(JSON.stringify(createPayload()));
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

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).toContain("font-family: 'CustomFont', sans-serif");
      expect(html).toContain("font-family: 'CustomFont'");
      expect(html).not.toContain("font-family: 'CustomFont, sans-serif'");
    });

    test("applies custom NPC color", async () => {
      await formatter.initialize(eventBus, createConfig({ npcColor: "#ff0000" }));

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).toContain("#ff0000");
    });

    test("applies custom Player color", async () => {
      await formatter.initialize(eventBus, createConfig({ playerColor: "#00ff00" }));

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).toContain("#00ff00");
    });

    test("falls back to defaults for non-positive sizes", async () => {
      await formatter.initialize(eventBus, createConfig({ fontSize: 0, pageWidth: 0 }));

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).toContain("28px");
      expect(html).toContain("80mm");
    });

    test("falls back to default colors for empty strings", async () => {
      await formatter.initialize(eventBus, createConfig({ npcColor: "", playerColor: "#00ff00" }));

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).toContain(".message.npc");
      expect(html).toContain("color: #333");
      expect(html).toContain("color: #00ff00");
    });
  });

  describe("CSS styles", () => {
    test("includes CSS for npc left alignment", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).toContain(".message.npc");
      expect(html).toContain("text-align:");
    });

    test("includes CSS for player right alignment", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(JSON.stringify(createPayload()));
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

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).toContain("<!DOCTYPE html>");
    });

    test("shutdown completes without error", async () => {
      await formatter.initialize(eventBus, createConfig());
      await expect(formatter.shutdown()).resolves.toBeUndefined();
    });
  });

  describe("API integration format", () => {
    test("formats gameplay payload into valid HTML", async () => {
      await formatter.initialize(eventBus, createConfig());

      const payload: GameplayPayload = {
        gameplay: [
          {
            npc: { replay_id: "r1", nickname: "ガイドNPC" },
            dialogue: [
              { role: "npc", text: "ようこそ、冒険者よ。" },
              { role: "player", text: "こんにちは！" },
              {
                role: "npc",
                text: "何かお手伝いできることはありますか？",
              },
            ],
          },
        ],
        respawn: {
          nickname: "プレイヤー",
          age: "30s",
          gender: "male",
        },
      };

      const entry = createLogEntry(JSON.stringify(payload));
      const html = formatter.format(entry);

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain('<html lang="ja">');
      expect(html).toContain("<head>");
      expect(html).toContain("<body>");
      expect(html).toContain("</html>");

      expect(html).toContain("ガイドNPC");
      expect(html).toContain("プレイヤー");
      expect(html).toContain("ようこそ、冒険者よ。");
      expect(html).toContain("こんにちは！");
      expect(html).toContain("何かお手伝いできることはありますか？");

      expect(html).toContain('class="message npc"');
      expect(html).toContain('class="message player"');

      expect(html).not.toContain('class="error"');
    });

    test("contentType is html for persistence", async () => {
      await formatter.initialize(eventBus, createConfig());
      expect(formatter.getContentType()).toBe("html");
    });
  });
});
