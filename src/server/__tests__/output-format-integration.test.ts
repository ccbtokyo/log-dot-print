import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import type { PrintJob, SystemConfig, LogEntry } from "../../core/index.js";
import { TypedEventEmitter } from "../../core/index.js";
import { DefaultFormatter } from "../../printers/formatter.js";
import { LogPrintApp, type DeepPartial } from "../app.js";
import type { AppConfig } from "../app.js";

/**
 * Integration test to verify outputFormat config flows correctly to PrintJob.contentType
 *
 * Bug: config.json has outputFormat: "json" but NativePrinter outputs .txt files
 * Expected: outputFormat: "json" should result in PrintJob.contentType = "json"
 */
describe("outputFormat integration", () => {
  let eventBus: TypedEventEmitter;

  beforeEach(() => {
    eventBus = new TypedEventEmitter();
  });

  describe("DefaultFormatter.getContentType()", () => {
    test("returns 'json' when outputFormat is 'json'", async () => {
      const formatter = new DefaultFormatter();
      const config: SystemConfig = {
        server: { port: 3000, host: "localhost" },
        printer: { type: "mock", options: {} },
        queue: { maxSize: 100, retryAttempts: 3, retryDelayMs: 1000 },
        format: {
          outputFormat: "json",
          maxLineWidth: 120,
          includeTimestamp: false,
          includeSource: false,
          includeLevel: false,
        },
      };

      await formatter.initialize(eventBus, config);

      expect(formatter.getContentType()).toBe("json");
    });

    test("returns 'text' when outputFormat is 'text'", async () => {
      const formatter = new DefaultFormatter();
      const config: SystemConfig = {
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

      await formatter.initialize(eventBus, config);

      expect(formatter.getContentType()).toBe("text");
    });
  });

  describe("End-to-end: config -> PrintJob.contentType", () => {
    test("PrintJob has contentType 'json' when config has outputFormat 'json'", async () => {
      // Simulate the flow in LogPrintApp.handleLogReceived
      const formatter = new DefaultFormatter();
      const config: SystemConfig = {
        server: { port: 3000, host: "localhost" },
        printer: { type: "mock", options: {} },
        queue: { maxSize: 100, retryAttempts: 3, retryDelayMs: 1000 },
        format: {
          outputFormat: "json",
          maxLineWidth: 120,
          includeTimestamp: false,
          includeSource: false,
          includeLevel: false,
        },
      };

      // Initialize formatter (as done in LogPrintApp.start())
      await formatter.initialize(eventBus, config);

      // Create a log entry
      const entry: LogEntry = {
        id: "test-entry-1",
        source: "TestSource",
        message: JSON.stringify({ foo: "bar", count: 42 }),
        level: "info",
        timestamp: new Date(),
        printed: false,
      };

      // Format the entry (as done in handleLogReceived)
      const formattedContent = formatter.format(entry);

      // Get content type (as done in handleLogReceived)
      const contentType = formatter.getContentType?.() ?? "text";

      // Verify the contentType is "json"
      expect(contentType).toBe("json");

      // Verify the formatted content is valid JSON
      expect(() => JSON.parse(formattedContent)).not.toThrow();
    });
  });

  describe("LogPrintApp: config -> log:formatted event", () => {
    let app: LogPrintApp;

    afterEach(async () => {
      if (app) {
        await app.stop();
      }
    });

    test("log:formatted event has contentType 'json' when config has outputFormat 'json'", async () => {
      const config: DeepPartial<AppConfig> = {
        server: { port: 0, host: "127.0.0.1" },
        printer: { type: "mock", options: { logToConsole: false } },
        queue: { maxSize: 100, retryAttempts: 3, retryDelayMs: 1000 },
        format: {
          outputFormat: "json",
          maxLineWidth: 120,
          includeTimestamp: false,
          includeSource: false,
          includeLevel: false,
        },
        storage: { enabled: false },
        ui: { enabled: false },
      };

      app = new LogPrintApp(config);
      await app.start();

      // Listen for log:formatted event
      const receivedJobs: PrintJob[] = [];
      app.getEventBus().on("log:formatted", (job: PrintJob) => {
        receivedJobs.push(job);
      });

      // Send a log via HTTP
      const response = await fetch(`http://127.0.0.1:${(app as any).config.server.port}/api/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: JSON.stringify({ foo: "bar" }) }),
      });

      expect(response.ok).toBe(true);

      // Wait for the event to be processed
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify the job's contentType
      expect(receivedJobs.length).toBeGreaterThan(0);
      expect(receivedJobs[0].contentType).toBe("json");
    });

    test("log:formatted event has contentType 'text' when config has outputFormat 'text'", async () => {
      const config: DeepPartial<AppConfig> = {
        server: { port: 0, host: "127.0.0.1" },
        printer: { type: "mock", options: { logToConsole: false } },
        queue: { maxSize: 100, retryAttempts: 3, retryDelayMs: 1000 },
        format: {
          outputFormat: "text",
          maxLineWidth: 80,
          includeTimestamp: true,
          includeSource: true,
          includeLevel: false,
        },
        storage: { enabled: false },
        ui: { enabled: false },
      };

      app = new LogPrintApp(config);
      await app.start();

      // Listen for log:formatted event
      const receivedJobs: PrintJob[] = [];
      app.getEventBus().on("log:formatted", (job: PrintJob) => {
        receivedJobs.push(job);
      });

      // Send a log via HTTP
      const response = await fetch(`http://127.0.0.1:${(app as any).config.server.port}/api/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "test message" }),
      });

      expect(response.ok).toBe(true);

      // Wait for the event to be processed
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify the job's contentType
      expect(receivedJobs.length).toBeGreaterThan(0);
      expect(receivedJobs[0].contentType).toBe("text");
    });
  });
});
