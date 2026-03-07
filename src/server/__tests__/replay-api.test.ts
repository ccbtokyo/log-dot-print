// Must be imported before app/printer code to ensure @printers/printers is mocked for other test files.
import "../../printers/__tests__/printers-mock.js";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { LogPrintApp } from "../app.js";
import type { TypedEventEmitter, PrintJob } from "../../core/index.js";

/**
 * Integration tests for Replay API
 * Verifies that completed jobs can be re-submitted for printing via POST /api/history/:id/replay
 *
 * @see docs/architecture.md for design details
 * @related src/server/ui/queue-controller.ts - QueueController
 * @related src/storage/sqlite-storage.ts - SqliteStorage
 */
describe("Replay API integration", () => {
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

  test("POST /api/history/:id/replay re-prints a completed job", async () => {
    // 1. Submit a log entry and wait for completion
    const logResponse = await fetch(`${baseUrl}/api/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "replay test message" }),
    });
    expect(logResponse.status).toBe(200);
    await waitForEvent<PrintJob>("print:completed");
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 2. Get the job ID from history
    const historyResponse = await fetch(`${baseUrl}/api/history`);
    const historyData = await historyResponse.json();
    expect(historyData.jobs.length).toBeGreaterThan(0);
    const jobId = historyData.jobs[0].id;

    // 3. Replay the job
    const replayPromise = waitForEvent<PrintJob>("print:completed");
    const replayResponse = await fetch(`${baseUrl}/api/history/${jobId}/replay`, {
      method: "POST",
    });
    expect(replayResponse.status).toBe(200);

    const replayData = await replayResponse.json();
    expect(replayData.success).toBe(true);
    expect(replayData.id).toBeDefined();

    // 4. Verify the replayed job completed
    await replayPromise;
  });

  test("POST /api/history/:id/replay returns 404 for non-existent job", async () => {
    const response = await fetch(`${baseUrl}/api/history/non-existent-id/replay`, {
      method: "POST",
    });
    expect(response.status).toBe(404);

    const data = await response.json();
    expect(data.error).toBeDefined();
  });

  test("replayed job appears in history as a new entry", async () => {
    // 1. Submit and wait
    await fetch(`${baseUrl}/api/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "original for replay" }),
    });
    await waitForEvent<PrintJob>("print:completed");
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 2. Get history before replay
    const beforeHistory = await fetch(`${baseUrl}/api/history`);
    const beforeData = await beforeHistory.json();
    expect(beforeData.pagination.total).toBe(1);
    const jobId = beforeData.jobs[0].id;

    // 3. Replay
    const replayPromise = waitForEvent<PrintJob>("print:completed");
    await fetch(`${baseUrl}/api/history/${jobId}/replay`, { method: "POST" });
    await replayPromise;
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 4. History should now have 2 entries
    const afterHistory = await fetch(`${baseUrl}/api/history`);
    const afterData = await afterHistory.json();
    expect(afterData.pagination.total).toBe(2);
  });
});
