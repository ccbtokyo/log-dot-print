import { describe, test, expect, beforeEach } from "bun:test";
import { DefaultFormatter } from "../formatter";
import type { LogEntry, SystemConfig, TypedEventEmitter } from "../../core/index.js";
import { EventEmitter } from "events";

describe("DefaultFormatter", () => {
  let formatter: DefaultFormatter;
  let mockEventBus: TypedEventEmitter;

  const createEntry = (overrides?: Partial<LogEntry>): LogEntry => ({
    id: "test-id",
    source: "TestSource",
    message: "Test message",
    level: "info",
    timestamp: new Date("2024-01-15T10:30:00Z"),
    printed: false,
    ...overrides,
  });

  const createConfig = (formatOverrides?: Partial<SystemConfig["format"]>): SystemConfig => ({
    server: { port: 3000, host: "localhost" },
    printer: { type: "mock", options: {} },
    queue: { maxSize: 100, retryAttempts: 3, retryDelayMs: 1000 },
    format: {
      outputFormat: "text",
      maxLineWidth: 80,
      includeTimestamp: true,
      includeSource: true,
      includeLevel: false,
      ...formatOverrides,
    },
  });

  beforeEach(() => {
    formatter = new DefaultFormatter();
    mockEventBus = new EventEmitter() as TypedEventEmitter;
  });

  describe("text format (default)", () => {
    test("formats entry with timestamp and source", async () => {
      await formatter.initialize(mockEventBus, createConfig());
      const entry = createEntry();

      const result = formatter.format(entry);

      // formatTimestamp returns time only (HH:mm:ss format)
      expect(result).toMatch(/\[\d{2}:\d{2}:\d{2}\]/);
      expect(result).toContain("<TestSource>");
      expect(result).toContain("Test message");
    });

    test("wraps long messages", async () => {
      await formatter.initialize(mockEventBus, createConfig({ maxLineWidth: 20 }));
      const entry = createEntry({ message: "This is a very long message that should be wrapped" });

      const result = formatter.format(entry);
      const lines = result.split("\n");

      // Check that no content line exceeds maxLineWidth (excluding separator)
      const contentLines = lines.filter(
        (l) => !l.startsWith("=") && !l.startsWith("-") && l.trim(),
      );
      for (const line of contentLines) {
        if (!line.startsWith("[")) {
          // Skip header line
          expect(line.length).toBeLessThanOrEqual(20);
        }
      }
    });

    test("includes metadata when present", async () => {
      await formatter.initialize(mockEventBus, createConfig());
      const entry = createEntry({ metadata: { key: "value", num: 42 } });

      const result = formatter.format(entry);

      expect(result).toContain("metadata:");
      expect(result).toContain('key: "value"');
      expect(result).toContain("num: 42");
    });

    test("excludes timestamp when disabled", async () => {
      await formatter.initialize(mockEventBus, createConfig({ includeTimestamp: false }));
      const entry = createEntry();

      const result = formatter.format(entry);

      expect(result).not.toMatch(/\[\d{2}:\d{2}:\d{2}\]/);
    });

    test("includes level when enabled", async () => {
      await formatter.initialize(mockEventBus, createConfig({ includeLevel: true }));
      const entry = createEntry({ level: "warn" });

      const result = formatter.format(entry);

      expect(result).toContain("(WARN)");
    });
  });

  describe("json format", () => {
    test("outputs original data as pretty-printed JSON", async () => {
      await formatter.initialize(mockEventBus, createConfig({ outputFormat: "json" }));
      // entry.message contains the original data as JSON string
      const originalData = { foo: "bar", count: 42 };
      const entry = createEntry({ message: JSON.stringify(originalData) });

      const result = formatter.format(entry);

      // Should be valid JSON matching original data
      const parsed = JSON.parse(result);
      expect(parsed).toEqual(originalData);
    });

    test("handles nested objects", async () => {
      await formatter.initialize(mockEventBus, createConfig({ outputFormat: "json" }));
      const originalData = { nested: { deep: { value: 123 } }, arr: [1, 2, 3] };
      const entry = createEntry({ message: JSON.stringify(originalData) });

      const result = formatter.format(entry);
      const parsed = JSON.parse(result);

      expect(parsed).toEqual(originalData);
    });

    test("handles plain string message", async () => {
      await formatter.initialize(mockEventBus, createConfig({ outputFormat: "json" }));
      // If message is a JSON string of a plain string
      const entry = createEntry({ message: '"just a string"' });

      const result = formatter.format(entry);
      const parsed = JSON.parse(result);

      expect(parsed).toBe("just a string");
    });

    test("handles non-JSON message gracefully", async () => {
      await formatter.initialize(mockEventBus, createConfig({ outputFormat: "json" }));
      // If message is not valid JSON, use as-is
      const entry = createEntry({ message: "not valid json" });

      const result = formatter.format(entry);
      const parsed = JSON.parse(result);

      expect(parsed).toBe("not valid json");
    });

    test("is properly indented (pretty print)", async () => {
      await formatter.initialize(mockEventBus, createConfig({ outputFormat: "json" }));
      const originalData = { key: "value", nested: { a: 1 } };
      const entry = createEntry({ message: JSON.stringify(originalData) });

      const result = formatter.format(entry);

      // Pretty printed JSON should have multiple lines
      expect(result.split("\n").length).toBeGreaterThan(1);
      // Should have indentation
      expect(result).toContain("  ");
    });

    test("truncates long lines based on maxLineWidth", async () => {
      await formatter.initialize(
        mockEventBus,
        createConfig({ outputFormat: "json", maxLineWidth: 30 }),
      );
      const originalData = { longValue: "a".repeat(50) };
      const entry = createEntry({ message: JSON.stringify(originalData) });

      const result = formatter.format(entry);
      const lines = result.split("\n");

      // Lines should be truncated
      for (const line of lines) {
        expect(line.length).toBeLessThanOrEqual(30);
      }
    });
  });

  describe("getContentType", () => {
    test("returns 'text' for text format", async () => {
      await formatter.initialize(mockEventBus, createConfig({ outputFormat: "text" }));
      expect(formatter.getContentType()).toBe("text");
    });

    test("returns 'json' for json format", async () => {
      await formatter.initialize(mockEventBus, createConfig({ outputFormat: "json" }));
      expect(formatter.getContentType()).toBe("json");
    });

    test("returns 'text' by default", async () => {
      await formatter.initialize(mockEventBus, createConfig());
      expect(formatter.getContentType()).toBe("text");
    });
  });

  describe("default values", () => {
    test("uses text format by default", async () => {
      await formatter.initialize(mockEventBus, {
        server: { port: 3000, host: "localhost" },
        printer: { type: "mock", options: {} },
        queue: { maxSize: 100, retryAttempts: 3, retryDelayMs: 1000 },
        format: {} as SystemConfig["format"],
      });
      const entry = createEntry();

      const result = formatter.format(entry);

      // Text format has separator lines
      expect(result).toContain("=".repeat(80));
    });
  });
});
