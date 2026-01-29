import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { unlink } from "fs/promises";
import { SqliteStorage } from "../sqlite-storage.js";
import type { LogEntry, PrintJob } from "../../core/index.js";

const TEST_DB_PATH = "/tmp/test-sqlite-storage.db";

function createTestLogEntry(overrides?: Partial<LogEntry>): LogEntry {
  return {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    timestamp: new Date().toISOString(),
    level: "info",
    source: "test-source",
    message: "Test message",
    printed: false,
    ...overrides,
  };
}

function createTestPrintJob(logEntry: LogEntry, overrides?: Partial<PrintJob>): PrintJob {
  return {
    id: `job-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    logEntry,
    formattedContent: `Formatted: ${logEntry.message}`,
    createdAt: new Date(),
    status: "pending",
    retryCount: 0,
    ...overrides,
  };
}

describe("SqliteStorage", () => {
  let storage: SqliteStorage;

  beforeEach(async () => {
    await cleanupTestDb();
    storage = new SqliteStorage(TEST_DB_PATH);
    await storage.initialize();
  });

  afterEach(async () => {
    await storage.shutdown();
    await cleanupTestDb();
  });

  async function cleanupTestDb() {
    try {
      await unlink(TEST_DB_PATH);
    } catch {
      // Ignore if file doesn't exist
    }
    try {
      await unlink(`${TEST_DB_PATH}-wal`);
    } catch {
      // Ignore
    }
    try {
      await unlink(`${TEST_DB_PATH}-shm`);
    } catch {
      // Ignore
    }
  }

  describe("StoragePlugin interface", () => {
    test("should have correct name", () => {
      expect(storage.name).toBe("sqlite-storage");
    });

    test("should save and query log entry", async () => {
      const entry = createTestLogEntry();
      await storage.save(entry);

      const results = await storage.query({});
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(entry.id);
      expect(results[0].message).toBe(entry.message);
    });

    test("should save batch of log entries", async () => {
      const entries = [
        createTestLogEntry({ source: "source1" }),
        createTestLogEntry({ source: "source2" }),
        createTestLogEntry({ source: "source3" }),
      ];
      await storage.saveBatch(entries);

      const results = await storage.query({});
      expect(results).toHaveLength(3);
    });

    test("should mark entry as printed", async () => {
      const entry = createTestLogEntry({ printed: false });
      await storage.save(entry);

      const updated = await storage.markPrinted(entry.id);
      expect(updated).toBe(true);

      const results = await storage.query({});
      expect(results[0].printed).toBe(true);
    });

    test("should return false when marking non-existent entry", async () => {
      const updated = await storage.markPrinted("non-existent-id");
      expect(updated).toBe(false);
    });

    test("should filter by source", async () => {
      await storage.saveBatch([
        createTestLogEntry({ source: "source-a" }),
        createTestLogEntry({ source: "source-b" }),
        createTestLogEntry({ source: "source-a" }),
      ]);

      const results = await storage.query({ source: "source-a" });
      expect(results).toHaveLength(2);
      expect(results.every((e) => e.source === "source-a")).toBe(true);
    });

    test("should filter by level", async () => {
      await storage.saveBatch([
        createTestLogEntry({ level: "info" }),
        createTestLogEntry({ level: "error" }),
        createTestLogEntry({ level: "info" }),
      ]);

      const results = await storage.query({ level: "error" });
      expect(results).toHaveLength(1);
      expect(results[0].level).toBe("error");
    });

    test("should filter by time range", async () => {
      const now = new Date();
      const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      await storage.saveBatch([
        createTestLogEntry({ timestamp: twoHoursAgo.toISOString() }),
        createTestLogEntry({ timestamp: hourAgo.toISOString() }),
        createTestLogEntry({ timestamp: now.toISOString() }),
      ]);

      const results = await storage.query({
        from: new Date(now.getTime() - 90 * 60 * 1000).toISOString(),
      });
      expect(results).toHaveLength(2);
    });

    test("should order by timestamp", async () => {
      const now = new Date();
      const entries = [
        createTestLogEntry({ timestamp: new Date(now.getTime() - 1000).toISOString() }),
        createTestLogEntry({ timestamp: new Date(now.getTime() - 3000).toISOString() }),
        createTestLogEntry({ timestamp: new Date(now.getTime() - 2000).toISOString() }),
      ];
      await storage.saveBatch(entries);

      const ascResults = await storage.query({ order: "asc" });
      expect(ascResults[0].timestamp).toBe(entries[1].timestamp);

      const descResults = await storage.query({ order: "desc" });
      expect(descResults[0].timestamp).toBe(entries[0].timestamp);
    });

    test("should apply limit and offset", async () => {
      const entries = Array.from({ length: 10 }, (_, i) =>
        createTestLogEntry({ message: `Message ${i}` }),
      );
      await storage.saveBatch(entries);

      const results = await storage.query({ limit: 3, offset: 2 });
      expect(results).toHaveLength(3);
    });

    test("should count entries", async () => {
      await storage.saveBatch([
        createTestLogEntry({ source: "source-a" }),
        createTestLogEntry({ source: "source-b" }),
        createTestLogEntry({ source: "source-a" }),
      ]);

      const totalCount = await storage.count();
      expect(totalCount).toBe(3);

      const filteredCount = await storage.count({ source: "source-a" });
      expect(filteredCount).toBe(2);
    });

    test("should handle metadata", async () => {
      const entry = createTestLogEntry({
        metadata: { key: "value", nested: { data: 123 } },
      });
      await storage.save(entry);

      const results = await storage.query({});
      expect(results[0].metadata).toEqual({ key: "value", nested: { data: 123 } });
    });
  });

  describe("QueuePersistencePlugin interface", () => {
    test("should save print job", async () => {
      const logEntry = createTestLogEntry();
      await storage.save(logEntry);

      const job = createTestPrintJob(logEntry);
      await storage.savePrintJob(job);

      const pendingJobs = await storage.getPendingJobs();
      expect(pendingJobs).toHaveLength(1);
      expect(pendingJobs[0].id).toBe(job.id);
    });

    test("should update print job status", async () => {
      const logEntry = createTestLogEntry();
      await storage.save(logEntry);

      const job = createTestPrintJob(logEntry);
      await storage.savePrintJob(job);

      await storage.updatePrintJobStatus(job.id, "printing", 0);
      let pendingJobs = await storage.getPendingJobs();
      expect(pendingJobs[0].status).toBe("printing");

      await storage.updatePrintJobStatus(job.id, "completed", 0);
      pendingJobs = await storage.getPendingJobs();
      expect(pendingJobs).toHaveLength(0);
    });

    test("should record status history", async () => {
      const logEntry = createTestLogEntry();
      await storage.save(logEntry);

      const job = createTestPrintJob(logEntry);
      await storage.savePrintJob(job);

      await storage.updatePrintJobStatus(job.id, "printing", 0);
      await storage.updatePrintJobStatus(job.id, "failed", 1, "Connection error");
      await storage.updatePrintJobStatus(job.id, "pending", 1);
      await storage.updatePrintJobStatus(job.id, "printing", 1);
      await storage.updatePrintJobStatus(job.id, "completed", 1);

      const history = await storage.getJobStatusHistory(job.id);
      expect(history).toHaveLength(6); // initial pending + 5 updates
      expect(history[0].status).toBe("pending");
      expect(history[1].status).toBe("printing");
      expect(history[2].status).toBe("failed");
      expect(history[2].error).toBe("Connection error");
      expect(history[5].status).toBe("completed");
    });

    test("should get pending jobs for restoration", async () => {
      const logEntry1 = createTestLogEntry({ id: "log-1" });
      const logEntry2 = createTestLogEntry({ id: "log-2" });
      const logEntry3 = createTestLogEntry({ id: "log-3" });

      await storage.saveBatch([logEntry1, logEntry2, logEntry3]);

      const job1 = createTestPrintJob(logEntry1, { id: "job-1" });
      const job2 = createTestPrintJob(logEntry2, { id: "job-2" });
      const job3 = createTestPrintJob(logEntry3, { id: "job-3" });

      await storage.savePrintJob(job1);
      await storage.savePrintJob(job2);
      await storage.savePrintJob(job3);

      await storage.updatePrintJobStatus(job1.id, "completed", 0);
      await storage.updatePrintJobStatus(job2.id, "printing", 0);
      // job3 remains pending

      const pendingJobs = await storage.getPendingJobs();
      expect(pendingJobs).toHaveLength(2);
      const ids = pendingJobs.map((j) => j.id);
      expect(ids).toContain("job-2");
      expect(ids).toContain("job-3");
    });

    test("should restore PrintJob with correct types", async () => {
      const logEntry = createTestLogEntry({
        metadata: { complex: { data: [1, 2, 3] } },
      });
      await storage.save(logEntry);

      const job = createTestPrintJob(logEntry);
      await storage.savePrintJob(job);

      const pendingJobs = await storage.getPendingJobs();
      expect(pendingJobs).toHaveLength(1);

      const restored = pendingJobs[0];
      expect(restored.createdAt).toBeInstanceOf(Date);
      expect(restored.logEntry.metadata).toEqual({ complex: { data: [1, 2, 3] } });
      expect(restored.status).toBe("pending");
      expect(restored.retryCount).toBe(0);
    });
  });

  describe("error handling", () => {
    test("should throw when not initialized", async () => {
      const uninitializedStorage = new SqliteStorage("/tmp/uninit.db");
      await expect(uninitializedStorage.save(createTestLogEntry())).rejects.toThrow(
        "SqliteStorage not initialized",
      );
    });
  });
});
