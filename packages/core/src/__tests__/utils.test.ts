import { describe, test, expect } from "bun:test";
import {
  generateId,
  parseLogEntry,
  formatTimestamp,
  truncate,
  wordWrap,
  createPrintJob,
} from "../utils";

describe("generateId", () => {
  test("generates unique UUIDs", () => {
    const id1 = generateId();
    const id2 = generateId();
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("parseLogEntry", () => {
  test("parses valid log entry", () => {
    const data = {
      source: "AI_1",
      level: "thought",
      message: "Hello world",
    };
    const entry = parseLogEntry(data);
    expect(entry).not.toBeNull();
    expect(entry!.source).toBe("AI_1");
    expect(entry!.level).toBe("thought");
    expect(entry!.message).toBe("Hello world");
    expect(entry!.id).toBeDefined();
    expect(entry!.timestamp).toBeDefined();
  });

  test("returns null for invalid data", () => {
    expect(parseLogEntry(null)).toBeNull();
    expect(parseLogEntry(undefined)).toBeNull();
    expect(parseLogEntry({})).toBeNull();
    expect(parseLogEntry({ source: "AI" })).toBeNull(); // missing message
  });

  test("uses provided id and timestamp", () => {
    const data = {
      id: "custom-id",
      timestamp: "2025-01-01T00:00:00Z",
      source: "AI_1",
      level: "info",
      message: "Test",
    };
    const entry = parseLogEntry(data);
    expect(entry!.id).toBe("custom-id");
    expect(entry!.timestamp).toBe("2025-01-01T00:00:00Z");
  });

  test("defaults level to info", () => {
    const entry = parseLogEntry({ message: "Test" });
    expect(entry!.level).toBe("info");
  });
});

describe("formatTimestamp", () => {
  test("formats ISO timestamp to time string", () => {
    const result = formatTimestamp("2025-01-15T14:30:45Z");
    expect(result).toMatch(/\d{2}:\d{2}:\d{2}/);
  });
});

describe("truncate", () => {
  test("returns short text unchanged", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  test("truncates long text with ellipsis", () => {
    expect(truncate("hello world", 8)).toBe("hello...");
  });
});

describe("wordWrap", () => {
  test("wraps text at word boundaries", () => {
    const result = wordWrap("hello world foo bar", 10);
    expect(result).toEqual(["hello", "world foo", "bar"]);
  });

  test("handles long words", () => {
    const result = wordWrap("superlongword short", 5);
    expect(result[0]).toBe("super");
    expect(result[1]).toBe("longw");
    expect(result[2]).toBe("ord");
    expect(result[3]).toBe("short");
  });

  test("returns empty array for empty string", () => {
    expect(wordWrap("", 10)).toEqual([]);
  });
});

describe("createPrintJob", () => {
  test("creates print job from log entry", () => {
    const entry = {
      id: "log-1",
      timestamp: "2025-01-01T00:00:00Z",
      source: "AI_1",
      level: "action" as const,
      message: "Moving forward",
    };
    const job = createPrintJob(entry, "Formatted content");

    expect(job.logEntry).toBe(entry);
    expect(job.formattedContent).toBe("Formatted content");
    expect(job.status).toBe("pending");
    expect(job.retryCount).toBe(0);
    expect(job.id).toBeDefined();
    expect(job.createdAt).toBeInstanceOf(Date);
  });
});
