import { describe, test, expect, beforeEach } from "bun:test";
import { MockPrinter } from "../mock";
import { TypedEventEmitter } from "../../core/events";
import type { PrintJob, LogEntry, SystemConfig } from "../../core/types";

const makeLogEntry = (overrides?: Partial<LogEntry>): LogEntry => ({
  id: "log-1",
  timestamp: "2025-01-01T00:00:00Z",
  source: "AI_1",
  level: "info",
  message: "test",
  printed: false,
  ...overrides,
});

const makePrintJob = (overrides?: Partial<PrintJob>): PrintJob => ({
  id: "job-1",
  logEntry: makeLogEntry(),
  formattedContent: "Hello World",
  createdAt: new Date("2025-01-01T00:00:00Z"),
  status: "pending",
  retryCount: 0,
  ...overrides,
});

const makeConfig = (): SystemConfig => ({
  server: { port: 3000, host: "localhost" },
  printer: { type: "mock", options: {} },
  queue: { maxSize: 100, retryAttempts: 3, retryDelayMs: 1000 },
  format: {
    outputFormat: "text",
    maxLineWidth: 80,
    includeTimestamp: true,
    includeSource: true,
    includeLevel: true,
  },
});

describe("MockPrinter", () => {
  let printer: MockPrinter;
  let eventBus: TypedEventEmitter;

  beforeEach(() => {
    eventBus = new TypedEventEmitter();
  });

  describe("default properties", () => {
    test("has correct name", () => {
      printer = new MockPrinter({ logToConsole: false });
      expect(printer.name).toBe("mock-printer");
    });

    test("has correct version", () => {
      printer = new MockPrinter({ logToConsole: false });
      expect(printer.version).toBe("1.0.0");
    });
  });

  describe("connect / disconnect", () => {
    test("connects successfully", async () => {
      printer = new MockPrinter({ logToConsole: false });
      await printer.initialize(eventBus, makeConfig());

      const status = await printer.getStatus();
      expect(status.connected).toBe(true);
    });

    test("disconnects successfully", async () => {
      printer = new MockPrinter({ logToConsole: false });
      await printer.initialize(eventBus, makeConfig());
      await printer.shutdown();

      const status = await printer.getStatus();
      expect(status.connected).toBe(false);
    });
  });

  describe("print", () => {
    test("prints successfully with zero delay", async () => {
      printer = new MockPrinter({ printDelayMs: 0, logToConsole: false });
      await printer.initialize(eventBus, makeConfig());

      await expect(printer.print(makePrintJob())).resolves.toBeUndefined();
    });

    test("respects printDelayMs", async () => {
      printer = new MockPrinter({ printDelayMs: 50, logToConsole: false });
      await printer.initialize(eventBus, makeConfig());

      const start = Date.now();
      await printer.print(makePrintJob());
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(40); // allow small timing variance
    });

    test("throws on failureProbability=1", async () => {
      printer = new MockPrinter({
        printDelayMs: 0,
        failureProbability: 1,
        logToConsole: false,
      });
      await printer.initialize(eventBus, makeConfig());

      await expect(printer.print(makePrintJob())).rejects.toThrow("Simulated print failure");
    });

    test("succeeds with failureProbability=0", async () => {
      printer = new MockPrinter({
        printDelayMs: 0,
        failureProbability: 0,
        logToConsole: false,
      });
      await printer.initialize(eventBus, makeConfig());

      await expect(printer.print(makePrintJob())).resolves.toBeUndefined();
    });
  });

  describe("getStatus", () => {
    test("includes printCount info", async () => {
      printer = new MockPrinter({ printDelayMs: 0, logToConsole: false });
      await printer.initialize(eventBus, makeConfig());

      await printer.print(makePrintJob({ id: "j1" }));
      await printer.print(makePrintJob({ id: "j2" }));

      const status = await printer.getStatus();
      expect(status.info).toContain("2 jobs printed");
      expect(status.type).toBe("mock");
    });
  });
});
