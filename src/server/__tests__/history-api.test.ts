// Must be imported before app/printer code to ensure @printers/printers is mocked for other test files.
import "../../printers/__tests__/printers-mock.js";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { LogPrintApp } from "../app.js";
import type { TypedEventEmitter, PrintJob } from "../../core/index.js";

/**
 * Integration tests for History API
 * Verifies that completed/failed jobs appear in /api/history
 *
 * @see docs/architecture.md for design details
 * @related src/server/ui/queue-controller.ts - QueueController
 * @related src/storage/queue-persistence.ts - QueuePersistenceHandler
 */
describe("History API integration", () => {
  let app: LogPrintApp;
  let baseUrl: string;
  let eventBus: TypedEventEmitter;

  beforeEach(async () => {
    app = new LogPrintApp({
      server: { port: 0, host: "127.0.0.1" },
      printer: { type: "mock", options: { logToConsole: false } },
      storage: { enabled: true, type: "sqlite", path: ":memory:" },
      ui: { enabled: true },
    });
    await app.start();
    const port = (app as unknown as { config: { server: { port: number } } }).config.server.port;
    baseUrl = `http://127.0.0.1:${port}`;
    eventBus = app.getEventBus();
  });

  afterEach(async () => {
    await app.stop();
  });

  /**
   * Helper to wait for a specific event
   */
  function waitForEvent<T>(
    event: string,
    predicate?: (payload: T) => boolean,
    timeout = 5000,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for event: ${event}`));
      }, timeout);

      const handler = (payload: T) => {
        if (!predicate || predicate(payload)) {
          clearTimeout(timer);
          eventBus.off(event, handler);
          resolve(payload);
        }
      };
      eventBus.on(event, handler);
    });
  }

  test("completed job appears in /api/history", async () => {
    // Submit a log entry
    const logResponse = await fetch(`${baseUrl}/api/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "test log for history" }),
    });
    expect(logResponse.status).toBe(200);

    // Wait for the job to complete
    await waitForEvent<PrintJob>("print:completed");

    // Wait for async persistence to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Query history
    const historyResponse = await fetch(`${baseUrl}/api/history`);
    expect(historyResponse.status).toBe(200);

    const data = await historyResponse.json();
    console.log("[Test] History response:", JSON.stringify(data, null, 2));

    expect(data.jobs.length).toBeGreaterThan(0);
    expect(data.jobs[0].status).toBe("completed");
    expect(data.jobs[0].messagePreview).toContain("test log for history");
  });

  test("multiple completed jobs appear in correct order", async () => {
    // Submit multiple log entries
    for (let i = 1; i <= 3; i++) {
      const response = await fetch(`${baseUrl}/api/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: `log entry ${i}` }),
      });
      expect(response.status).toBe(200);

      // Wait for job to complete before submitting next
      await waitForEvent<PrintJob>("print:completed");
    }

    // Wait for async persistence
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Query history
    const historyResponse = await fetch(`${baseUrl}/api/history`);
    const data = await historyResponse.json();

    expect(data.jobs.length).toBe(3);
    // Jobs should be in descending order (newest first)
    expect(data.jobs[0].messagePreview).toContain("log entry 3");
    expect(data.jobs[2].messagePreview).toContain("log entry 1");
  });

  test("pagination works correctly", async () => {
    // Submit 5 log entries
    for (let i = 1; i <= 5; i++) {
      await fetch(`${baseUrl}/api/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: `pagination test ${i}` }),
      });
      await waitForEvent<PrintJob>("print:completed");
    }

    // Wait for async persistence
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Query with limit
    const page1Response = await fetch(`${baseUrl}/api/history?page=1&limit=2`);
    const page1Data = await page1Response.json();

    expect(page1Data.jobs.length).toBe(2);
    expect(page1Data.pagination.page).toBe(1);
    expect(page1Data.pagination.limit).toBe(2);
    expect(page1Data.pagination.total).toBe(5);
    expect(page1Data.pagination.totalPages).toBe(3);

    // Query second page
    const page2Response = await fetch(`${baseUrl}/api/history?page=2&limit=2`);
    const page2Data = await page2Response.json();

    expect(page2Data.jobs.length).toBe(2);
    expect(page2Data.pagination.page).toBe(2);
  });

  test("history count returns correct total", async () => {
    // Submit logs
    for (let i = 1; i <= 3; i++) {
      await fetch(`${baseUrl}/api/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: `count test ${i}` }),
      });
      await waitForEvent<PrintJob>("print:completed");
    }

    await new Promise((resolve) => setTimeout(resolve, 100));

    const historyResponse = await fetch(`${baseUrl}/api/history`);
    const data = await historyResponse.json();

    expect(data.pagination.total).toBe(3);
  });
});
