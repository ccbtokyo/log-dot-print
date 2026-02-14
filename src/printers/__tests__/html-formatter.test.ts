import { describe, test, expect, beforeEach } from "bun:test";
import { HtmlFormatter } from "../html-formatter";
import type {
  LogEntry,
  SystemConfig,
  TypedEventEmitter,
  HtmlFormatConfig,
} from "../../core/index.js";
import { EventEmitter } from "events";

describe("HtmlFormatter", () => {
  let formatter: HtmlFormatter;
  let mockEventBus: TypedEventEmitter;

  const createEntry = (overrides?: Partial<LogEntry>): LogEntry => ({
    id: "test-id",
    source: "TestSource",
    message: "Test message",
    level: "info",
    timestamp: "2024-01-15T10:30:00Z",
    printed: false,
    ...overrides,
  });

  const createConfig = (formatOverrides?: Partial<HtmlFormatConfig>): SystemConfig => ({
    server: { port: 3000, host: "localhost" },
    printer: { type: "mock", options: {} },
    queue: { maxSize: 100, retryAttempts: 3, retryDelayMs: 1000 },
    format: {
      outputFormat: "html",
      includeTimestamp: true,
      includeSource: true,
      includeLevel: false,
      ...formatOverrides,
    },
  });

  beforeEach(() => {
    formatter = new HtmlFormatter();
    mockEventBus = new EventEmitter() as TypedEventEmitter;
  });

  describe("basic HTML generation", () => {
    test("generates valid HTML document", async () => {
      await formatter.initialize(mockEventBus, createConfig());
      const entry = createEntry();

      const result = formatter.format(entry);

      expect(result).toContain("<!DOCTYPE html>");
      expect(result).toContain("<html");
      expect(result).toContain("</html>");
      expect(result).toContain("<head>");
      expect(result).toContain("<body>");
    });

    test("includes message content", async () => {
      await formatter.initialize(mockEventBus, createConfig());
      const entry = createEntry({ message: "Hello World" });

      const result = formatter.format(entry);

      expect(result).toContain("Hello World");
    });

    test("escapes HTML entities in message", async () => {
      await formatter.initialize(mockEventBus, createConfig());
      const entry = createEntry({ message: "<script>alert('xss')</script>" });

      const result = formatter.format(entry);

      expect(result).not.toContain("<script>");
      expect(result).toContain("&lt;script&gt;");
    });
  });

  describe("timestamp display", () => {
    test("includes timestamp when enabled", async () => {
      await formatter.initialize(mockEventBus, createConfig({ includeTimestamp: true }));
      const entry = createEntry();

      const result = formatter.format(entry);

      // formatTimestamp returns time only (HH:mm:ss format)
      expect(result).toMatch(/\d{2}:\d{2}:\d{2}/);
    });

    test("excludes timestamp when disabled", async () => {
      await formatter.initialize(mockEventBus, createConfig({ includeTimestamp: false }));
      const entry = createEntry();

      const result = formatter.format(entry);

      // Should not have timestamp class/element
      expect(result).not.toContain('class="timestamp"');
    });
  });

  describe("source display", () => {
    test("includes source when enabled", async () => {
      await formatter.initialize(mockEventBus, createConfig({ includeSource: true }));
      const entry = createEntry({ source: "MySource" });

      const result = formatter.format(entry);

      expect(result).toContain("MySource");
      expect(result).toContain('class="source"');
    });

    test("excludes source when disabled", async () => {
      await formatter.initialize(mockEventBus, createConfig({ includeSource: false }));
      const entry = createEntry({ source: "MySource" });

      const result = formatter.format(entry);

      expect(result).not.toContain('class="source"');
    });
  });

  describe("level display", () => {
    test("includes level when enabled", async () => {
      await formatter.initialize(mockEventBus, createConfig({ includeLevel: true }));
      const entry = createEntry({ level: "warn" });

      const result = formatter.format(entry);

      expect(result).toContain("WARN");
      expect(result).toContain('class="level level-warn"');
    });

    test("excludes level when disabled", async () => {
      await formatter.initialize(mockEventBus, createConfig({ includeLevel: false }));
      const entry = createEntry({ level: "warn" });

      const result = formatter.format(entry);

      expect(result).not.toContain('class="level"');
    });
  });

  describe("metadata display", () => {
    test("includes metadata when present", async () => {
      await formatter.initialize(mockEventBus, createConfig());
      const entry = createEntry({ metadata: { key: "value", num: 42 } });

      const result = formatter.format(entry);

      expect(result).toContain("key");
      expect(result).toContain("value");
      expect(result).toContain("42");
    });

    test("omits metadata section when no metadata", async () => {
      await formatter.initialize(mockEventBus, createConfig());
      const entry = createEntry({ metadata: undefined });

      const result = formatter.format(entry);

      expect(result).not.toContain('class="metadata"');
    });
  });

  describe("font configuration", () => {
    test("uses default font when no custom font specified", async () => {
      await formatter.initialize(mockEventBus, createConfig());
      const entry = createEntry();

      const result = formatter.format(entry);

      // Default font stack
      expect(result).toContain("font-family");
    });

    test("applies custom font family", async () => {
      await formatter.initialize(mockEventBus, createConfig({ fontFamily: "MyCustomFont" }));
      const entry = createEntry();

      const result = formatter.format(entry);

      expect(result).toContain("MyCustomFont");
    });

    test("includes @font-face when fontPath is specified", async () => {
      await formatter.initialize(
        mockEventBus,
        createConfig({
          fontFamily: "CustomFont",
          fontPath: "/path/to/font.ttf",
        }),
      );
      const entry = createEntry();

      const result = formatter.format(entry);

      expect(result).toContain("@font-face");
      expect(result).toContain("CustomFont");
      expect(result).toContain("/path/to/font.ttf");
    });

    test("applies custom font size", async () => {
      await formatter.initialize(mockEventBus, createConfig({ fontSize: 18 }));
      const entry = createEntry();

      const result = formatter.format(entry);

      expect(result).toContain("font-size: 18px");
    });
  });

  describe("page configuration", () => {
    test("applies page width for PDF conversion", async () => {
      await formatter.initialize(mockEventBus, createConfig({ pageWidth: 80 }));
      const entry = createEntry();

      const result = formatter.format(entry);

      expect(result).toContain("80mm");
    });

    test("uses pdfPaperSize as CSS @page size when set to standard name", async () => {
      await formatter.initialize(mockEventBus, createConfig({ pdfPaperSize: "A4" }));
      const entry = createEntry();

      const result = formatter.format(entry);

      expect(result).toContain("size: A4;");
    });

    test("uses pdfPaperSize as CSS @page size when set to Custom inch format", async () => {
      await formatter.initialize(mockEventBus, createConfig({ pdfPaperSize: "Custom.11x15.5in" }));
      const entry = createEntry();

      const result = formatter.format(entry);

      expect(result).toContain("size: 11in 15.5in;");
    });

    test("falls back to pageWidth mm when pdfPaperSize is not set", async () => {
      await formatter.initialize(mockEventBus, createConfig({ pageWidth: 100 }));
      const entry = createEntry();

      const result = formatter.format(entry);

      expect(result).toContain("size: 100mm auto;");
    });
  });

  describe("plugin interface", () => {
    test("has correct name and version", () => {
      expect(formatter.name).toBe("html-formatter");
      expect(formatter.version).toBe("1.0.0");
    });

    test("shutdown completes without error", async () => {
      await formatter.initialize(mockEventBus, createConfig());
      await expect(formatter.shutdown()).resolves.toBeUndefined();
    });
  });

  describe("content type", () => {
    test("getContentType returns html", async () => {
      await formatter.initialize(mockEventBus, createConfig());
      expect(formatter.getContentType()).toBe("html");
    });
  });
});
