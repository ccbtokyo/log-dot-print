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
    expect(entry!.source).toBe("unknown");
    expect(entry!.level).toBe("info");
    expect(entry!.message).toBe(JSON.stringify(data));
    expect(entry!.printed).toBe(false);
    expect(entry!.id).toBeDefined();
    expect(entry!.timestamp).toBeDefined();
  });

  test("returns null for invalid data", () => {
    expect(parseLogEntry(null)).not.toBeNull();
    expect(parseLogEntry(undefined)).toBeNull();
  });

  test("uses generated id and timestamp", () => {
    const data = {
      id: "custom-id",
      timestamp: "2025-01-01T00:00:00Z",
      source: "AI_1",
      level: "info",
      message: "Test",
    };
    const entry = parseLogEntry(data);
    expect(entry!.id).not.toBe("custom-id");
    expect(entry!.timestamp).not.toBe("2025-01-01T00:00:00Z");
    expect(entry!.printed).toBe(false);
  });

  test("defaults level to info", () => {
    const entry = parseLogEntry({ message: "Test" });
    expect(entry!.level).toBe("info");
  });

  test("uses provided source override", () => {
    const entry = parseLogEntry({ hello: "world" }, { source: "10.0.0.1" });
    expect(entry!.source).toBe("10.0.0.1");
  });

  test("accepts arbitrary objects without message", () => {
    const entry = parseLogEntry({ foo: "bar", count: 2 });
    expect(entry).not.toBeNull();
    expect(entry!.message).toBe('{"foo":"bar","count":2}');
  });

  test("stringifies jsonable message values", () => {
    const arrayEntry = parseLogEntry(["a", 1, true]);
    expect(arrayEntry!.message).toBe('["a",1,true]');

    const objectEntry = parseLogEntry({ foo: "bar", n: 2 });
    expect(objectEntry!.message).toBe('{"foo":"bar","n":2}');

    const nullEntry = parseLogEntry(null);
    expect(nullEntry!.message).toBe("null");

    const numberEntry = parseLogEntry(123);
    expect(numberEntry!.message).toBe("123");

    const boolEntry = parseLogEntry(false);
    expect(boolEntry!.message).toBe("false");

    const stringEntry = parseLogEntry("plain");
    expect(stringEntry!.message).toBe('"plain"');
  });

  test("returns null for non-serializable values", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(parseLogEntry(circular)).toBeNull();
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
      printed: false,
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
