import { describe, test, expect, beforeEach } from "bun:test";
import { resolve } from "node:path";
import { ReplayFormatter } from "../replay-formatter.js";
import type {
  LogEntry,
  SystemConfig,
  ReplayFormatConfig,
  GameplayNpcInfo,
  GameplayDialogueEntry,
  GameplayRespawnInfo,
} from "../../core/types.js";
import { TypedEventEmitter } from "../../core/events.js";

/**
 * ReplayFormatter tests — multi-conversation gameplay JSON format
 *
 * @see /Users/eotel/ghq/github.com/ccbtokyo/log-dot-print/plans/gameplay-json-plan.md
 * @related HtmlFormatter
 */
describe("ReplayFormatter", () => {
  let formatter: ReplayFormatter;
  let eventBus: TypedEventEmitter;

  const createPayload = (
    overrides?: Partial<{
      gameplay: Array<{ npc: GameplayNpcInfo; dialogue: GameplayDialogueEntry[] }>;
      respawn: GameplayRespawnInfo;
    }>,
  ) => ({
    gameplay: overrides?.gameplay ?? [
      {
        npc: { replay_id: "r1", nickname: "sho" },
        dialogue: [
          { role: "player" as const, text: "こんにちは" },
          { role: "npc" as const, text: "こんにちは！元気ですか？" },
        ],
      },
    ],
    respawn: overrides?.respawn ?? {
      nickname: "Toshi",
      age: "40s",
      gender: "male",
      complaint_troubles: "仕事のストレス",
      confession_true_feelings: "本当は休みたい",
      rediscovering_relief: "散歩で気分転換",
      convai_backstory: "東京出身のサラリーマン",
    },
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
      await formatter.initialize(eventBus, createConfig({ skipRespawn: false }));

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).toContain('class="player-footer"');
      // Footer element appears after last dialogue message
      const lastMessagePos = html.lastIndexOf('class="message');
      const footerPos = html.indexOf('class="player-footer"');
      expect(footerPos).toBeGreaterThan(lastMessagePos);
    });

    test("renders bilingual nickname label", async () => {
      await formatter.initialize(eventBus, createConfig({ skipRespawn: false }));

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).toContain("名前 / Nickname");
      expect(html).toContain("Toshi");
    });

    test("renders bilingual age label with localized value", async () => {
      await formatter.initialize(eventBus, createConfig({ skipRespawn: false }));

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).toContain("年代 / Age Group");
      expect(html).toContain("40s （40代）");
    });

    test("renders bilingual gender label with localized value", async () => {
      await formatter.initialize(eventBus, createConfig({ skipRespawn: false }));

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).toContain("性別 / Gender");
      expect(html).toContain("male（男性）");
    });

    test("renders optional fields when provided", async () => {
      await formatter.initialize(eventBus, createConfig({ skipRespawn: false }));

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
      await formatter.initialize(eventBus, createConfig({ skipRespawn: false }));

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
      await formatter.initialize(eventBus, createConfig({ skipRespawn: false }));

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
      await formatter.initialize(eventBus, createConfig({ skipRespawn: false }));

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
      await formatter.initialize(eventBus, createConfig({ skipRespawn: false }));

      const payload = createPayload({
        respawn: { nickname: "X", age: "unknown", gender: "male" },
      });
      const entry = createLogEntry(JSON.stringify(payload));
      const html = formatter.format(entry);

      expect(html).toContain("unknown");
      expect(html).not.toContain("代）");
    });

    test("localizes known genders to Japanese", async () => {
      await formatter.initialize(eventBus, createConfig({ skipRespawn: false }));

      const genders = [
        { input: "male", expected: "male（男性）" },
        { input: "female", expected: "female（女性）" },
        { input: "nonbinary", expected: "nonbinary（ノンバイナリー）" },
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
      await formatter.initialize(eventBus, createConfig({ skipRespawn: false }));

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
              { role: "player" as const, text: "Message 1" },
              { role: "npc" as const, text: "Message 2" },
              { role: "player" as const, text: "Message 3" },
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

  describe("multi-conversation rendering", () => {
    test("renders all NPC conversations from gameplay array", async () => {
      await formatter.initialize(eventBus, createConfig());

      const payload = createPayload({
        gameplay: [
          {
            npc: { replay_id: "r1", nickname: "Ayumu" },
            dialogue: [{ role: "npc" as const, text: "やあ！" }],
          },
          {
            npc: { replay_id: "r2", nickname: "The Uncle" },
            dialogue: [{ role: "npc" as const, text: "おう、久しぶり" }],
          },
        ],
      });
      const entry = createLogEntry(JSON.stringify(payload));
      const html = formatter.format(entry);

      expect(html).toContain("Ayumu");
      expect(html).toContain("やあ！");
      expect(html).toContain("The Uncle");
      expect(html).toContain("おう、久しぶり");
    });

    test("inserts section-divider between conversations", async () => {
      await formatter.initialize(eventBus, createConfig());

      const payload = createPayload({
        gameplay: [
          {
            npc: { replay_id: "r1", nickname: "Ayumu" },
            dialogue: [{ role: "npc" as const, text: "Hello" }],
          },
          {
            npc: { replay_id: "r2", nickname: "The Uncle" },
            dialogue: [{ role: "npc" as const, text: "Hi" }],
          },
        ],
      });
      const entry = createLogEntry(JSON.stringify(payload));
      const html = formatter.format(entry);

      // Exactly one <div> divider between the two conversations
      const dividerCount = (html.match(/<div class="section-divider"><\/div>/g) ?? []).length;
      expect(dividerCount).toBe(1);
    });

    test("does not insert section-divider for single conversation", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).not.toContain('<div class="section-divider">');
    });

    test("uses respawn.nickname as player name in all conversations", async () => {
      await formatter.initialize(eventBus, createConfig());

      const payload = createPayload({
        gameplay: [
          {
            npc: { replay_id: "r1", nickname: "Ayumu" },
            dialogue: [{ role: "player" as const, text: "Hi Ayumu" }],
          },
          {
            npc: { replay_id: "r2", nickname: "The Uncle" },
            dialogue: [{ role: "player" as const, text: "Hi Uncle" }],
          },
        ],
        respawn: { nickname: "TakaiUki", age: "40s", gender: "male" },
      });
      const entry = createLogEntry(JSON.stringify(payload));
      const html = formatter.format(entry);

      // Both player messages should use respawn.nickname
      const playerMessages = html.match(/class="message player">[^<]*/g) ?? [];
      expect(playerMessages.length).toBe(2);
      for (const msg of playerMessages) {
        expect(msg).toContain("TakaiUki: ");
      }
    });

    test("renders footer only once at the end", async () => {
      await formatter.initialize(eventBus, createConfig({ skipRespawn: false }));

      const payload = createPayload({
        gameplay: [
          {
            npc: { replay_id: "r1", nickname: "Ayumu" },
            dialogue: [{ role: "npc" as const, text: "Hello" }],
          },
          {
            npc: { replay_id: "r2", nickname: "The Uncle" },
            dialogue: [{ role: "npc" as const, text: "Hi" }],
          },
        ],
      });
      const entry = createLogEntry(JSON.stringify(payload));
      const html = formatter.format(entry);

      // The actual footer div should appear exactly once
      const divFooterCount = (html.match(/<div class="player-footer">/g) ?? []).length;
      expect(divFooterCount).toBe(1);
    });

    test("renders conversations in array order", async () => {
      await formatter.initialize(eventBus, createConfig());

      const payload = createPayload({
        gameplay: [
          {
            npc: { replay_id: "r1", nickname: "FirstNPC" },
            dialogue: [{ role: "npc" as const, text: "First dialogue" }],
          },
          {
            npc: { replay_id: "r2", nickname: "SecondNPC" },
            dialogue: [{ role: "npc" as const, text: "Second dialogue" }],
          },
        ],
      });
      const entry = createLogEntry(JSON.stringify(payload));
      const html = formatter.format(entry);

      const firstPos = html.indexOf("FirstNPC");
      const secondPos = html.indexOf("SecondNPC");
      expect(firstPos).toBeLessThan(secondPos);
    });

    test("renders footer only for empty gameplay with respawn", async () => {
      await formatter.initialize(eventBus, createConfig({ skipRespawn: false }));

      const entry = createLogEntry(
        JSON.stringify({
          gameplay: [],
          respawn: { nickname: "Toshi", age: "30s", gender: "male" },
        }),
      );
      const html = formatter.format(entry);

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).not.toContain('class="error"');
      expect(html).toContain('class="player-footer"');
      expect(html).toContain("Toshi");
      expect(html).not.toContain('<div class="npc-section-header">');
    });

    test("renders error for empty gameplay without respawn", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(JSON.stringify({ gameplay: [] }));
      const html = formatter.format(entry);

      expect(html).toContain('class="error"');
    });

    test("skips invalid entries in gameplay array", async () => {
      await formatter.initialize(eventBus, createConfig());

      const raw = {
        gameplay: [
          "not-an-object",
          42,
          { noNpc: true },
          {
            npc: { replay_id: "r1", nickname: "ValidNPC" },
            dialogue: [{ role: "npc", text: "Valid message" }],
          },
        ],
        respawn: { nickname: "Toshi", age: "30s", gender: "male" },
      };
      const entry = createLogEntry(JSON.stringify(raw));
      const html = formatter.format(entry);

      expect(html).not.toContain('class="error"');
      expect(html).toContain("ValidNPC");
      expect(html).toContain("Valid message");
    });

    test("escapes NPC nicknames in all conversations for XSS prevention", async () => {
      await formatter.initialize(eventBus, createConfig());

      const payload = createPayload({
        gameplay: [
          {
            npc: { replay_id: "r1", nickname: "<script>alert('xss')</script>" },
            dialogue: [{ role: "npc" as const, text: "Test" }],
          },
          {
            npc: { replay_id: "r2", nickname: '<img onerror="hack()">' },
            dialogue: [{ role: "npc" as const, text: "Test2" }],
          },
        ],
      });
      const entry = createLogEntry(JSON.stringify(payload));
      const html = formatter.format(entry);

      expect(html).not.toContain("<script>");
      expect(html).not.toContain("<img");
      expect(html).toContain("&lt;script&gt;");
      expect(html).toContain("&lt;img");
    });

    test("handles conversation with missing dialogue gracefully", async () => {
      await formatter.initialize(eventBus, createConfig());

      const raw = {
        gameplay: [{ npc: { replay_id: "r1", nickname: "SilentNPC" } }],
        respawn: { nickname: "Toshi", age: "30s", gender: "male" },
      };
      const entry = createLogEntry(JSON.stringify(raw));
      const html = formatter.format(entry);

      expect(html).not.toContain('class="error"');
      expect(html).toContain("SilentNPC");
      // No message divs for this conversation
      expect(html).not.toContain('class="message');
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
            dialogue: [{ role: "npc" as const, text: "Test" }],
          },
        ],
      });
      const entry = createLogEntry(JSON.stringify(payload));
      const html = formatter.format(entry);

      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
    });

    test("escapes HTML in respawn nickname in footer", async () => {
      await formatter.initialize(eventBus, createConfig({ skipRespawn: false }));

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
      await formatter.initialize(eventBus, createConfig({ skipRespawn: false }));

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
                role: "npc" as const,
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

    test("returns error HTML when no recognized fields exist", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(JSON.stringify({ key: "value" }));
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

    test("renders respawn-only payload with footer only", async () => {
      await formatter.initialize(eventBus, createConfig({ skipRespawn: false }));

      const entry = createLogEntry(
        JSON.stringify({
          gameplay: [],
          respawn: { nickname: "Toshi", age: "30s", gender: "male" },
        }),
      );
      const html = formatter.format(entry);

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).not.toContain('class="error"');
      expect(html).toContain('class="player-footer"');
      expect(html).toContain("Toshi");
      expect(html).not.toContain('<div class="npc-section-header">');
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

    test("applies custom font path with base64 data URI @font-face", async () => {
      const fontPath = resolve(import.meta.dir, "fixtures/test-font.ttf");
      await formatter.initialize(
        eventBus,
        createConfig({
          fontFamily: "CustomFont",
          fontPath,
        }),
      );

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).toContain("@font-face");
      expect(html).toContain("data:font/ttf;base64,");
      expect(html).toContain("truetype");
      expect(html).not.toContain("file://");
    });

    test("omits @font-face when fontPath points to non-existent file", async () => {
      await formatter.initialize(
        eventBus,
        createConfig({
          fontFamily: "CustomFont",
          fontPath: "/non/existent/font.ttf",
        }),
      );

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).not.toContain("@font-face");
    });

    test("handles font family stacks with @font-face correctly", async () => {
      const fontPath = resolve(import.meta.dir, "fixtures/test-font.ttf");
      await formatter.initialize(
        eventBus,
        createConfig({
          fontFamily: "CustomFont, sans-serif",
          fontPath,
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

    test("treats string 'false' for skipRespawn as default (true)", async () => {
      // JSON config may pass string "false" instead of boolean false
      await formatter.initialize(
        eventBus,
        createConfig({ skipRespawn: "false" as unknown as boolean }),
      );

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      // Non-boolean value should fall back to default (true), so no footer
      expect(html).not.toContain('class="player-footer"');
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

      const payload = {
        gameplay: [
          {
            npc: { replay_id: "r1", nickname: "ガイドNPC" },
            dialogue: [
              { role: "npc" as const, text: "ようこそ、冒険者よ。" },
              { role: "player" as const, text: "こんにちは！" },
              {
                role: "npc" as const,
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

  describe("skipRespawn flag", () => {
    test("does not render footer when skipRespawn is true", async () => {
      await formatter.initialize(eventBus, createConfig({ skipRespawn: true }));

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).not.toContain('class="player-footer"');
      expect(html).not.toContain("名前 / Nickname");
      // Conversations should still be rendered
      expect(html).toContain('class="message npc"');
      expect(html).toContain('class="message player"');
    });

    test("still uses respawn.nickname as player speaker in dialogue", async () => {
      await formatter.initialize(eventBus, createConfig({ skipRespawn: true }));

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      const playerMessages = html.match(/class="message player">[^<]*/g) ?? [];
      expect(playerMessages.length).toBeGreaterThan(0);
      for (const msg of playerMessages) {
        expect(msg).toContain("Toshi: ");
      }
    });

    test("returns empty string for respawn-only payload when skipRespawn is true", async () => {
      await formatter.initialize(eventBus, createConfig({ skipRespawn: true }));

      const entry = createLogEntry(
        JSON.stringify({
          gameplay: [],
          respawn: { nickname: "Toshi", age: "30s", gender: "male" },
        }),
      );
      const html = formatter.format(entry);

      expect(html).toBe("");
    });

    test("does not render footer by default (skipRespawn defaults to true)", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).not.toContain('class="player-footer"');
    });

    test("renders footer when skipRespawn is explicitly false", async () => {
      await formatter.initialize(eventBus, createConfig({ skipRespawn: false }));

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).toContain('class="player-footer"');
    });
  });

  describe("artwork credit", () => {
    test("renders artwork credit section with RE:SPAWN READY", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).toContain('class="artwork-credit"');
      expect(html).toContain("RE:SPAWN READY");
    });

    test("renders credit after player-footer", async () => {
      await formatter.initialize(eventBus, createConfig({ skipRespawn: false }));

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      const footerPos = html.indexOf('class="player-footer"');
      const creditPos = html.indexOf('class="artwork-credit"');
      expect(footerPos).toBeGreaterThan(-1);
      expect(creditPos).toBeGreaterThan(footerPos);
    });

    test("renders credit even when skipRespawn is true", async () => {
      await formatter.initialize(eventBus, createConfig({ skipRespawn: true }));

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).not.toContain('class="player-footer"');
      expect(html).toContain('class="artwork-credit"');
      expect(html).toContain("RE:SPAWN READY");
    });

    test("renders credit after dialogue when no respawn", async () => {
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
      expect(html).toContain('class="artwork-credit"');
      expect(html).toContain("RE:SPAWN READY");
    });

    test("does not render credit for empty string output (skipRespawn + respawn-only)", async () => {
      await formatter.initialize(eventBus, createConfig({ skipRespawn: true }));

      const entry = createLogEntry(
        JSON.stringify({
          gameplay: [],
          respawn: { nickname: "Toshi", age: "30s", gender: "male" },
        }),
      );
      const html = formatter.format(entry);

      expect(html).toBe("");
    });

    test("artwork-credit uses CSS pseudo-element lines instead of text dashes", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      // No text dashes in the credit element
      expect(html).not.toContain("------");
      // CSS pseudo-elements draw the lines
      expect(html).toContain(".artwork-credit::before");
      expect(html).toContain(".artwork-credit::after");
      expect(html).toMatch(/\.artwork-credit::before[\s\S]*?border-top:\s*3px solid/);
    });

    test("renders credit @font-face when creditFontPath is specified", async () => {
      const creditFontPath = resolve(import.meta.dir, "fixtures/test-font.ttf");
      await formatter.initialize(
        eventBus,
        createConfig({
          creditFontPath,
          creditFontFamily: "IBMPlexSansJP, sans-serif",
        }),
      );

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      // Should have a @font-face for the credit font
      const fontFaceMatches = html.match(/@font-face\s*\{[^}]*\}/g) ?? [];
      const creditFontFace = fontFaceMatches.find((m) => m.includes("IBMPlexSansJP"));
      expect(creditFontFace).toBeDefined();
      expect(creditFontFace).toContain("data:font/ttf;base64,");
      expect(creditFontFace).toContain("truetype");
    });

    test("applies creditFontFamily to .artwork-credit CSS", async () => {
      const creditFontPath = resolve(import.meta.dir, "fixtures/test-font.ttf");
      await formatter.initialize(
        eventBus,
        createConfig({
          creditFontPath,
          creditFontFamily: "IBMPlexSansJP, sans-serif",
        }),
      );

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      const creditCssMatch = html.match(/\.artwork-credit\s*\{[^}]*\}/);
      expect(creditCssMatch).not.toBeNull();
      expect(creditCssMatch![0]).toContain("font-family:");
      expect(creditCssMatch![0]).toContain("IBMPlexSansJP");
    });

    test("does not add credit @font-face when creditFontPath is not specified", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      // No @font-face at all when neither fontPath nor creditFontPath is set
      expect(html).not.toContain("@font-face");
    });

    test("does not add font-family to .artwork-credit when creditFontFamily is not specified", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      const creditCssMatch = html.match(/\.artwork-credit\s*\{[^}]*\}/);
      expect(creditCssMatch).not.toBeNull();
      expect(creditCssMatch![0]).not.toContain("font-family:");
    });

    test("renders both primary and credit @font-face when both fontPath and creditFontPath are set", async () => {
      const fontPath = resolve(import.meta.dir, "fixtures/test-font.ttf");
      const creditFontPath = resolve(import.meta.dir, "fixtures/test-font.ttf");
      await formatter.initialize(
        eventBus,
        createConfig({
          fontFamily: "DartsFont, sans-serif",
          fontPath,
          creditFontPath,
          creditFontFamily: "IBMPlexSansJP, sans-serif",
        }),
      );

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      const fontFaceMatches = html.match(/@font-face\s*\{[^}]*\}/g) ?? [];
      expect(fontFaceMatches.length).toBe(2);
    });

    test("credit font does not affect body font-family", async () => {
      const creditFontPath = resolve(import.meta.dir, "fixtures/test-font.ttf");
      await formatter.initialize(
        eventBus,
        createConfig({
          creditFontPath,
          creditFontFamily: "IBMPlexSansJP, sans-serif",
        }),
      );

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      // Body should still use the default font family, not the credit font
      const bodyCssMatch = html.match(/body\s*\{[^}]*\}/);
      expect(bodyCssMatch).not.toBeNull();
      expect(bodyCssMatch![0]).not.toContain("IBMPlexSansJP");
    });

    test("artwork-credit CSS does not include border-top on main element", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      const creditCssMatch = html.match(/\.artwork-credit\s*\{[^}]*\}/);
      expect(creditCssMatch).not.toBeNull();
      expect(creditCssMatch![0]).not.toContain("border-top");
    });

    test("does not generate credit @font-face when creditFontFamily is invalid (XSS attempt)", async () => {
      const creditFontPath = resolve(import.meta.dir, "fixtures/test-font.ttf");
      await formatter.initialize(
        eventBus,
        createConfig({
          creditFontPath,
          creditFontFamily: "</style><script>alert(1)</script>",
        }),
      );

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      // Invalid creditFontFamily should not produce a credit @font-face
      expect(html).not.toContain("@font-face");
      expect(html).not.toContain("<script>");
    });
  });

  describe("section divider layout", () => {
    test("uses <div> element instead of <hr> for section divider", async () => {
      await formatter.initialize(eventBus, createConfig());

      const payload = createPayload({
        gameplay: [
          {
            npc: { replay_id: "r1", nickname: "NPC1" },
            dialogue: [{ role: "npc" as const, text: "Hello" }],
          },
          {
            npc: { replay_id: "r2", nickname: "NPC2" },
            dialogue: [{ role: "npc" as const, text: "Hi" }],
          },
        ],
      });
      const entry = createLogEntry(JSON.stringify(payload));
      const html = formatter.format(entry);

      expect(html).toContain('<div class="section-divider">');
      expect(html).not.toContain("<hr");
    });

    test("section-divider CSS uses 1px border-top", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      const dividerCssMatch = html.match(/\.section-divider\s*\{[^}]*\}/);
      expect(dividerCssMatch).not.toBeNull();
      expect(dividerCssMatch![0]).toContain("border-top: 1px solid");
    });

    test("section-divider has generous margin", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      const dividerCssMatch = html.match(/\.section-divider\s*\{[^}]*\}/);
      expect(dividerCssMatch).not.toBeNull();
      expect(dividerCssMatch![0]).toContain("margin: 32px 0");
    });
  });

  describe("default skipRespawn behavior", () => {
    test("player-footer is hidden by default", async () => {
      await formatter.initialize(eventBus, createConfig());

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).not.toContain('class="player-footer"');
      expect(html).toContain('class="message npc"');
    });

    test("player-footer is shown when skipRespawn is explicitly false", async () => {
      await formatter.initialize(eventBus, createConfig({ skipRespawn: false }));

      const entry = createLogEntry(JSON.stringify(createPayload()));
      const html = formatter.format(entry);

      expect(html).toContain('class="player-footer"');
    });
  });
});
