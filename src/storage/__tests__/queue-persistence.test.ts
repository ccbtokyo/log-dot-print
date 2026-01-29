import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { unlink } from "fs/promises";
import { TypedEventEmitter } from "../../core/index.js";
import type { LogEntry, PrintJob } from "../../core/index.js";
import { SqliteStorage } from "../sqlite-storage.js";
import { QueuePersistenceHandler } from "../queue-persistence.js";

const TEST_DB_PATH = "/tmp/test-queue-persistence.db";

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

describe("QueuePersistenceHandler", () => {
  let storage: SqliteStorage;
  let eventBus: TypedEventEmitter;
  let handler: QueuePersistenceHandler;

  beforeEach(async () => {
    await cleanupTestDb();
    storage = new SqliteStorage(TEST_DB_PATH);
    await storage.initialize();
    eventBus = new TypedEventEmitter();
    handler = new QueuePersistenceHandler(storage, eventBus);
  });

  afterEach(async () => {
    handler.shutdown();
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

  describe("initialization", () => {
    test("should initialize without errors", () => {
      expect(() => handler.initialize()).not.toThrow();
    });

    test("should be idempotent", () => {
      handler.initialize();
      expect(() => handler.initialize()).not.toThrow();
    });

    test("should shutdown without errors", () => {
      handler.initialize();
      expect(() => handler.shutdown()).not.toThrow();
    });
  });

  describe("event handling", () => {
    test("should persist job on log:queued event", async () => {
      handler.initialize();

      const logEntry = createTestLogEntry();
      await storage.save(logEntry);

      const job = createTestPrintJob(logEntry);
      eventBus.emit("log:queued", job);

      // Wait for async persistence
      await new Promise((resolve) => setTimeout(resolve, 50));

      const pendingJobs = await storage.getPendingJobs();
      expect(pendingJobs).toHaveLength(1);
      expect(pendingJobs[0].id).toBe(job.id);
    });

    test("should update status on print:started event", async () => {
      handler.initialize();

      const logEntry = createTestLogEntry();
      await storage.save(logEntry);

      const job = createTestPrintJob(logEntry);
      await storage.savePrintJob(job);

      eventBus.emit("print:started", job);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const pendingJobs = await storage.getPendingJobs();
      expect(pendingJobs[0].status).toBe("printing");
    });

    test("should update status on print:completed event", async () => {
      handler.initialize();

      const logEntry = createTestLogEntry();
      await storage.save(logEntry);

      const job = createTestPrintJob(logEntry);
      await storage.savePrintJob(job);

      eventBus.emit("print:completed", job);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const pendingJobs = await storage.getPendingJobs();
      expect(pendingJobs).toHaveLength(0);
    });

    test("should update status on print:failed event", async () => {
      handler.initialize();

      const logEntry = createTestLogEntry();
      await storage.save(logEntry);

      const job = createTestPrintJob(logEntry);
      await storage.savePrintJob(job);

      const error = new Error("Print error");
      eventBus.emit("print:failed", job, error);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const history = await storage.getJobStatusHistory(job.id);
      const failedRecord = history.find((h) => h.status === "failed");
      expect(failedRecord).toBeDefined();
      expect(failedRecord?.error).toBe("Print error");
    });

    test("should record retry on print:retry event", async () => {
      handler.initialize();

      const logEntry = createTestLogEntry();
      await storage.save(logEntry);

      const job = createTestPrintJob(logEntry);
      await storage.savePrintJob(job);

      eventBus.emit("print:retry", job, 1);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const history = await storage.getJobStatusHistory(job.id);
      expect(history.length).toBeGreaterThan(1);
    });
  });

  describe("getPendingJobs", () => {
    test("should return pending jobs for restoration", async () => {
      const logEntry1 = createTestLogEntry({ id: "log-1" });
      const logEntry2 = createTestLogEntry({ id: "log-2" });

      await storage.saveBatch([logEntry1, logEntry2]);

      const job1 = createTestPrintJob(logEntry1, { id: "job-1" });
      const job2 = createTestPrintJob(logEntry2, { id: "job-2" });

      await storage.savePrintJob(job1);
      await storage.savePrintJob(job2);

      await storage.updatePrintJobStatus(job1.id, "completed", 0);

      const pendingJobs = await handler.getPendingJobs();
      expect(pendingJobs).toHaveLength(1);
      expect(pendingJobs[0].id).toBe("job-2");
    });
  });

  describe("complete workflow", () => {
    test("should track complete job lifecycle", async () => {
      handler.initialize();

      const logEntry = createTestLogEntry();
      await storage.save(logEntry);

      const job = createTestPrintJob(logEntry);

      // Job queued
      eventBus.emit("log:queued", job);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Print started
      eventBus.emit("print:started", job);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // First attempt fails
      job.retryCount = 1;
      eventBus.emit("print:failed", job, new Error("Temporary failure"));
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Retry
      eventBus.emit("print:retry", job, 1);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Second attempt succeeds
      eventBus.emit("print:started", job);
      await new Promise((resolve) => setTimeout(resolve, 50));

      eventBus.emit("print:completed", job);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify history
      const history = await storage.getJobStatusHistory(job.id);
      expect(history.length).toBeGreaterThanOrEqual(5);

      // Verify job is completed
      const pendingJobs = await storage.getPendingJobs();
      expect(pendingJobs).toHaveLength(0);
    });
  });

  describe("shutdown behavior", () => {
    test("should not handle events after shutdown", async () => {
      handler.initialize();
      handler.shutdown();

      const logEntry = createTestLogEntry();
      await storage.save(logEntry);

      const job = createTestPrintJob(logEntry);
      eventBus.emit("log:queued", job);

      await new Promise((resolve) => setTimeout(resolve, 50));

      const pendingJobs = await storage.getPendingJobs();
      expect(pendingJobs).toHaveLength(0);
    });
  });
});
