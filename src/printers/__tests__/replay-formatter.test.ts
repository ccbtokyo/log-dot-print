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
      complaint_troubles: "仕事のストレス",
      confession_true_feelings: "本当は休みたい",
      rediscovering_relief: "散歩で気分転換",
      convai_backstory: "東京出身のサラリーマン",
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

  describe("footer rendering", () => {
    test("does not render player-header", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).not.toContain('class="player-header"');
    });

    test("renders player-footer after dialogue sections", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).toContain('class="player-footer"');
      // Footer element appears after last dialogue message
      const lastMessagePos = html.lastIndexOf('class="message');
      const footerPos = html.indexOf('class="player-footer"');
      expect(footerPos).toBeGreaterThan(lastMessagePos);
    });

    test("renders bilingual nickname label", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).toContain("名前 / Nickname");
      expect(html).toContain("Toshi");
    });

    test("renders bilingual age label with localized value", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).toContain("年代 / Age Group");
      expect(html).toContain("40s （40代）");
    });

    test("renders bilingual gender label with localized value", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).toContain("性別 / Gender");
      expect(html).toContain("male（男性）");
    });

    test("renders optional fields when provided", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).toContain("悩み・葛藤 / Complaints &amp; Troubles");
      expect(html).toContain("仕事のストレス");
      expect(html).toContain("本音 / True Feelings");
      expect(html).toContain("本当は休みたい");
      expect(html).toContain("心の変化 / Rediscovering Relief");
      expect(html).toContain("散歩で気分転換");
      expect(html).toContain("背景設定 / Backstory");
      expect(html).toContain("東京出身のサラリーマン");
    });

    test("omits optional fields when absent", async () => {
      await formatter.initialize(eventBus, createConfig());

      const payload = createPayload({
        respawn: {
          nickname: "Toshi",
          age: "40s",
          gender: "male",
        },
      });
      const entry = createLogEntry(JSON.stringify(payload));
      const html = formatter.format(entry);

      expect(html).toContain("名前 / Nickname");
      expect(html).toContain("年代 / Age Group");
      expect(html).toContain("性別 / Gender");
      expect(html).not.toContain("悩み・葛藤");
      expect(html).not.toContain("本音 / True Feelings");
      expect(html).not.toContain("心の変化");
      expect(html).not.toContain("背景設定");
    });

    test("omits optional fields when empty string", async () => {
      await formatter.initialize(eventBus, createConfig());

      const payload = createPayload({
        respawn: {
          nickname: "Toshi",
          age: "40s",
          gender: "male",
          complaint_troubles: "",
          confession_true_feelings: "  ",
          rediscovering_relief: "",
          convai_backstory: "",
        },
      });
      const entry = createLogEntry(JSON.stringify(payload));
      const html = formatter.format(entry);

      expect(html).not.toContain("悩み・葛藤");
      expect(html).not.toContain("本音 / True Feelings");
      expect(html).not.toContain("心の変化");
      expect(html).not.toContain("背景設定");
    });

    test("does not render footer when respawn is missing", async () => {
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

      expect(html).not.toContain('class="player-footer"');
    });
  });

  describe("age/gender localization", () => {
    test("localizes age decades to Japanese", async () => {
      await formatter.initialize(eventBus, createConfig());

      const ages = [
        { input: "20s", expected: "20s （20代）" },
        { input: "30s", expected: "30s （30代）" },
        { input: "40s", expected: "40s （40代）" },
        { input: "50s", expected: "50s （50代）" },
        { input: "60s", expected: "60s （60代）" },
      ];

      for (const { input, expected } of ages) {
        const payload = createPayload({
          respawn: { nickname: "X", age: input, gender: "male" },
        });
        const entry = createLogEntry(JSON.stringify(payload));
        const html = formatter.format(entry);

        expect(html).toContain(expected);
      }
    });

    test("renders unknown age value as-is", async () => {
      await formatter.initialize(eventBus, createConfig());

      const payload = createPayload({
        respawn: { nickname: "X", age: "unknown", gender: "male" },
      });
      const entry = createLogEntry(JSON.stringify(payload));
      const html = formatter.format(entry);

      expect(html).toContain("unknown");
      expect(html).not.toContain("代）");
    });

    test("localizes known genders to Japanese", async () => {
      await formatter.initialize(eventBus, createConfig());

      const genders = [
        { input: "male", expected: "male（男性）" },
        { input: "female", expected: "female（女性）" },
        { input: "other", expected: "other（その他）" },
      ];

      for (const { input, expected } of genders) {
        const payload = createPayload({
          respawn: { nickname: "X", age: "20s", gender: input },
        });
        const entry = createLogEntry(JSON.stringify(payload));
        const html = formatter.format(entry);

        expect(html).toContain(expected);
      }
    });

    test("renders unknown gender value as-is", async () => {
      await formatter.initialize(eventBus, createConfig());

      const payload = createPayload({
        respawn: { nickname: "X", age: "20s", gender: "non-binary" },
      });
      const entry = createLogEntry(JSON.stringify(payload));
      const html = formatter.format(entry);

      expect(html).toContain("non-binary");
      // Gender should not have Japanese parenthetical
      expect(html).not.toContain("non-binary（");
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

    test("NPC messages display npc.nickname as speaker with colon separator", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      // NPC message should show "nickname: text" without brackets
      const npcMessageMatch = html.match(/class="message npc"[^>]*>([^<]*(?:<[^>]*>[^<]*)*)/);
      expect(npcMessageMatch).not.toBeNull();
      expect(npcMessageMatch![0]).toContain("sho: ");
      expect(npcMessageMatch![0]).not.toContain("[sho]");
    });

    test("Player messages display respawn.nickname as speaker with colon separator", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      // Player message should show "nickname: text" without brackets
      const playerMessageMatch = html.match(/class="message player"[^>]*>([^<]*(?:<[^>]*>[^<]*)*)/);
      expect(playerMessageMatch).not.toBeNull();
      expect(playerMessageMatch![0]).toContain("Toshi: ");
      expect(playerMessageMatch![0]).not.toContain("[Toshi]");
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

    test("escapes HTML in respawn nickname in footer", async () => {
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

    test("escapes HTML in optional footer fields", async () => {
      await formatter.initialize(eventBus, createConfig());

      const payload = createPayload({
        respawn: {
          nickname: "Safe",
          age: "30s",
          gender: "female",
          complaint_troubles: "<script>alert('xss')</script>",
          confession_true_feelings: '<img src=x onerror="alert(1)">',
          convai_backstory: '<div onclick="steal()">evil</div>',
        },
      });
      const entry = createLogEntry(JSON.stringify(payload));
      const html = formatter.format(entry);

      expect(html).not.toContain("<script>");
      expect(html).not.toContain("<img");
      expect(html).not.toContain("<div onclick");
      expect(html).toContain("&lt;script&gt;");
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

    test("returns error HTML when gameplay is not an array or object", async () => {
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

    test("accepts gameplay as a single object and wraps it in an array", async () => {
      await formatter.initialize(eventBus, createConfig());

      const singleConversation = {
        npc: { replay_id: "r1", nickname: "sho" },
        dialogue: [
          { role: "player", text: "こんにちは" },
          { role: "npc", text: "やあ！" },
        ],
      };
      const entry = createLogEntry(
        JSON.stringify({
          gameplay: singleConversation,
          respawn: { nickname: "Toshi", age: "30s", gender: "male" },
        }),
      );
      const html = formatter.format(entry);

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).not.toContain('class="error"');
      expect(html).toContain("sho");
      expect(html).toContain("こんにちは");
      expect(html).toContain("やあ！");
      expect(html).toContain("Toshi");
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

      expect(html).toContain("18pt");
    });

    test("does not emit @page size when only pageWidth is set (no pdfPaperSize)", async () => {
      await formatter.initialize(eventBus, createConfig({ pageWidth: 80 }));

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      // @page block should not contain a size declaration when pdfPaperSize is absent
      expect(html).not.toMatch(/@page\s*\{[^}]*\bsize:/);
    });

    test("uses pdfPaperSize as CSS @page size when set to standard name", async () => {
      await formatter.initialize(eventBus, createConfig({ pdfPaperSize: "A4" }));

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).toContain("size: A4 portrait;");
    });

    test("uses pdfPaperSize as CSS @page size when set to Custom inch format", async () => {
      await formatter.initialize(eventBus, createConfig({ pdfPaperSize: "Custom.11x15.5in" }));

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      // Custom dimensions should NOT have portrait keyword (it's invalid CSS)
      expect(html).toContain("size: 11in 15.5in;");
    });

    test("omits @page size when pdfPaperSize is not set", async () => {
      await formatter.initialize(eventBus, createConfig({ pageWidth: 100 }));

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      // @page block should not contain a size declaration
      expect(html).not.toMatch(/@page\s*\{[^}]*\bsize:/);
    });

    test("includes portrait keyword in @page size rule for standard names", async () => {
      await formatter.initialize(eventBus, createConfig({ pdfPaperSize: "A4" }));

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).toContain("size: A4 portrait;");
    });

    test("does not include portrait keyword for custom dimensions", async () => {
      await formatter.initialize(eventBus, createConfig({ pdfPaperSize: "Custom.11x15.5in" }));

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      // Explicit dimensions already encode orientation via width/height ordering
      expect(html).toContain("size: 11in 15.5in;");
      expect(html).not.toContain("portrait");
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

    test("resolves relative fontPath to absolute file:// URL", async () => {
      await formatter.initialize(
        eventBus,
        createConfig({
          fontFamily: "CustomFont",
          fontPath: "./fonts/custom.ttf",
        }),
      );

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).toContain("@font-face");
      // Relative path should be resolved to file:// absolute URL
      expect(html).toContain("file://");
      expect(html).toMatch(/file:\/\/.*fonts\/custom\.ttf/);
      // Should NOT contain the raw relative path
      expect(html).not.toContain("url('./fonts/custom.ttf')");
    });

    test("keeps absolute fontPath as file:// URL", async () => {
      await formatter.initialize(
        eventBus,
        createConfig({
          fontFamily: "CustomFont",
          fontPath: "/usr/share/fonts/custom.ttf",
        }),
      );

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).toContain("file:///usr/share/fonts/custom.ttf");
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

      expect(html).toContain("16pt");
      // pageWidth is no longer used in @page size (only pdfPaperSize drives that)
      // but sideMargin default (10mm) should still appear in margin/padding
      expect(html).toContain("10mm");
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
