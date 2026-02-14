import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { FileStorage } from "../file-storage";
import { mkdtemp, rm, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import type { LogEntry } from "../../core/types";

const makeEntry = (overrides?: Partial<LogEntry>): LogEntry => ({
  id: `entry-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  timestamp: new Date().toISOString(),
  source: "test",
  level: "info",
  message: "test message",
  printed: false,
  ...overrides,
});

describe("FileStorage", () => {
  let tempDir: string;
  let filePath: string;
  let storage: FileStorage;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "filestorage-test-"));
    filePath = join(tempDir, "test-logs.jsonl");
    storage = new FileStorage(filePath, { flushIntervalMs: 0 });
    await storage.initialize();
  });

  afterEach(async () => {
    await storage.shutdown();
    await rm(tempDir, { recursive: true });
  });

  describe("initialize / shutdown", () => {
    test("creates directory on initialize", async () => {
      const nestedPath = join(tempDir, "nested", "deep", "logs.jsonl");
      const nested = new FileStorage(nestedPath, { flushIntervalMs: 0 });
      await nested.initialize();

      // Should not throw - directory was created
      await nested.save(makeEntry());
      await nested.shutdown();

      const content = await readFile(nestedPath, "utf-8");
      expect(content.trim()).not.toBe("");
    });

    test("flushes buffer on shutdown", async () => {
      await storage.save(makeEntry({ id: "flush-test" }));
      await storage.shutdown();

      const content = await readFile(filePath, "utf-8");
      expect(content).toContain("flush-test");
    });
  });

  describe("save / query", () => {
    test("round-trips a single entry", async () => {
      const entry = makeEntry({ id: "rt-1", source: "AI_1", message: "hello" });
      await storage.save(entry);

      const results = await storage.query({});
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("rt-1");
      expect(results[0].source).toBe("AI_1");
      expect(results[0].message).toBe("hello");
      expect(results[0].printed).toBe(false);
    });

    test("round-trips multiple entries", async () => {
      await storage.save(makeEntry({ id: "m-1" }));
      await storage.save(makeEntry({ id: "m-2" }));
      await storage.save(makeEntry({ id: "m-3" }));

      const results = await storage.query({});
      expect(results).toHaveLength(3);
    });

    test("sets printed to false if missing", async () => {
      const entry = makeEntry();
      delete (entry as Record<string, unknown>).printed;
      await storage.save(entry);

      const results = await storage.query({});
      expect(results[0].printed).toBe(false);
    });
  });

  describe("saveBatch", () => {
    test("saves multiple entries at once", async () => {
      const entries = [
        makeEntry({ id: "b-1" }),
        makeEntry({ id: "b-2" }),
        makeEntry({ id: "b-3" }),
      ];
      await storage.saveBatch(entries);

      const results = await storage.query({});
      expect(results).toHaveLength(3);
      expect(results.map((e) => e.id)).toContain("b-1");
      expect(results.map((e) => e.id)).toContain("b-2");
      expect(results.map((e) => e.id)).toContain("b-3");
    });
  });

  describe("markPrinted", () => {
    test("marks buffered entry as printed", async () => {
      await storage.save(makeEntry({ id: "mp-1" }));
      const result = await storage.markPrinted("mp-1");

      expect(result).toBe(true);
      const entries = await storage.query({});
      expect(entries[0].printed).toBe(true);
    });

    test("marks persisted entry as printed", async () => {
      await storage.save(makeEntry({ id: "mp-2" }));
      // Force flush to persist
      await storage.shutdown();

      // Re-create storage to work with persisted data
      storage = new FileStorage(filePath, { flushIntervalMs: 0 });
      await storage.initialize();

      const result = await storage.markPrinted("mp-2");
      expect(result).toBe(true);

      const entries = await storage.query({});
      expect(entries[0].printed).toBe(true);
    });

    test("returns false for non-existent id", async () => {
      const result = await storage.markPrinted("nonexistent");
      expect(result).toBe(false);
    });
  });

  describe("query options", () => {
    test("filters by source", async () => {
      await storage.save(makeEntry({ id: "qs-1", source: "AI_1" }));
      await storage.save(makeEntry({ id: "qs-2", source: "AI_2" }));
      await storage.save(makeEntry({ id: "qs-3", source: "AI_1" }));

      const results = await storage.query({ source: "AI_1" });
      expect(results).toHaveLength(2);
      expect(results.every((e) => e.source === "AI_1")).toBe(true);
    });

    test("filters by level", async () => {
      await storage.save(makeEntry({ id: "ql-1", level: "info" }));
      await storage.save(makeEntry({ id: "ql-2", level: "error" }));
      await storage.save(makeEntry({ id: "ql-3", level: "info" }));

      const results = await storage.query({ level: "error" });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("ql-2");
    });

    test("filters by time range", async () => {
      await storage.save(makeEntry({ id: "qt-1", timestamp: "2025-01-01T00:00:00Z" }));
      await storage.save(makeEntry({ id: "qt-2", timestamp: "2025-01-15T00:00:00Z" }));
      await storage.save(makeEntry({ id: "qt-3", timestamp: "2025-02-01T00:00:00Z" }));

      const results = await storage.query({
        from: "2025-01-10T00:00:00Z",
        to: "2025-01-20T00:00:00Z",
      });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("qt-2");
    });

    test("sorts ascending by default", async () => {
      await storage.save(makeEntry({ id: "so-1", timestamp: "2025-01-03T00:00:00Z" }));
      await storage.save(makeEntry({ id: "so-2", timestamp: "2025-01-01T00:00:00Z" }));
      await storage.save(makeEntry({ id: "so-3", timestamp: "2025-01-02T00:00:00Z" }));

      const results = await storage.query({});
      expect(results[0].id).toBe("so-2");
      expect(results[1].id).toBe("so-3");
      expect(results[2].id).toBe("so-1");
    });

    test("sorts descending", async () => {
      await storage.save(makeEntry({ id: "sd-1", timestamp: "2025-01-01T00:00:00Z" }));
      await storage.save(makeEntry({ id: "sd-2", timestamp: "2025-01-03T00:00:00Z" }));

      const results = await storage.query({ order: "desc" });
      expect(results[0].id).toBe("sd-2");
      expect(results[1].id).toBe("sd-1");
    });

    test("applies limit and offset", async () => {
      for (let i = 0; i < 5; i++) {
        await storage.save(makeEntry({ id: `pg-${i}`, timestamp: `2025-01-0${i + 1}T00:00:00Z` }));
      }

      const results = await storage.query({ limit: 2, offset: 1 });
      expect(results).toHaveLength(2);
      expect(results[0].id).toBe("pg-1");
      expect(results[1].id).toBe("pg-2");
    });
  });

  describe("count", () => {
    test("counts all entries", async () => {
      await storage.save(makeEntry());
      await storage.save(makeEntry());
      await storage.save(makeEntry());

      const count = await storage.count();
      expect(count).toBe(3);
    });

    test("counts with filter", async () => {
      await storage.save(makeEntry({ source: "AI_1" }));
      await storage.save(makeEntry({ source: "AI_2" }));
      await storage.save(makeEntry({ source: "AI_1" }));

      const count = await storage.count({ source: "AI_1" });
      expect(count).toBe(2);
    });

    test("returns 0 for empty storage", async () => {
      const count = await storage.count();
      expect(count).toBe(0);
    });
  });

  describe("getFilePath / getFileSize", () => {
    test("returns configured file path", () => {
      expect(storage.getFilePath()).toBe(filePath);
    });

    test("returns file size after writes", async () => {
      await storage.save(makeEntry());
      // Flush to disk
      await storage.shutdown();
      storage = new FileStorage(filePath, { flushIntervalMs: 0 });
      await storage.initialize();

      const size = await storage.getFileSize();
      expect(size).toBeGreaterThan(0);
    });

    test("returns 0 for non-existent file", async () => {
      const emptyStorage = new FileStorage(join(tempDir, "nonexistent.jsonl"), {
        flushIntervalMs: 0,
      });
      const size = await emptyStorage.getFileSize();
      expect(size).toBe(0);
    });
  });
});
