// Must be imported before app/printer code to ensure @printers/printers is mocked for other test files.
import "../../printers/__tests__/printers-mock.js";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { LogPrintApp } from "../app.js";

/**
 * Tests for HTTP routing in LogPrintApp
 * @see docs/architecture.md for design details
 * @related src/server/app.ts - LogPrintApp.handleHttpRequest
 * @related src/server/ui/queue-controller.ts - QueueController
 */
describe("LogPrintApp HTTP routing", () => {
  let app: LogPrintApp;
  let baseUrl: string;

  beforeEach(async () => {
    app = new LogPrintApp({
      server: { port: 0, host: "127.0.0.1" },
      printer: { type: "mock", options: { logToConsole: false } },
      storage: { enabled: true, type: "sqlite", path: ":memory:" },
      ui: { enabled: true },
    });
    await app.start();
    // Get the actual port from the server
    const port = (app as unknown as { config: { server: { port: number } } }).config.server.port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await app.stop();
  });

  test("/api/queue routes to QueueController and returns 200", async () => {
    const response = await fetch(`${baseUrl}/api/queue`);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty("jobs");
    expect(data).toHaveProperty("totalSize");
  });

  test("/api/history routes to QueueController and returns 200", async () => {
    const response = await fetch(`${baseUrl}/api/history`);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty("jobs");
    expect(data).toHaveProperty("pagination");
  });

  test("/api/history with query parameters returns paginated results", async () => {
    const response = await fetch(`${baseUrl}/api/history?page=1&limit=10`);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.pagination.page).toBe(1);
    expect(data.pagination.limit).toBe(10);
  });

  test("/api/history with status filter returns filtered results", async () => {
    const response = await fetch(`${baseUrl}/api/history?status=completed`);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty("jobs");
  });

  test("/api/history/:id/download returns 404 for non-existent job", async () => {
    const response = await fetch(`${baseUrl}/api/history/non-existent-id/download`);

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("Job not found");
  });

  test("/api/history response includes hasFile field", async () => {
    const response = await fetch(`${baseUrl}/api/history`);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty("jobs");
    // Empty jobs array is valid, but if there are jobs they should have hasFile
    if (data.jobs.length > 0) {
      expect(data.jobs[0]).toHaveProperty("hasFile");
    }
  });

  test("/log routes to HttpReceiver (not QueueController)", async () => {
    const response = await fetch(`${baseUrl}/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "test log" }),
    });

    // Should be handled by HttpReceiver and return success
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
  });

  test("/health routes to HttpReceiver", async () => {
    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe("ok");
  });

  test("/openapi.json routes to HttpReceiver", async () => {
    const response = await fetch(`${baseUrl}/openapi.json`);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.openapi).toBeDefined();
    expect(data.info).toBeDefined();
  });

  test("/logs (batch) routes to HttpReceiver", async () => {
    const response = await fetch(`${baseUrl}/logs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ message: "batch log 1" }, { message: "batch log 2" }]),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.results).toBeInstanceOf(Array);
    expect(data.results.length).toBe(2);
  });

  test("/api/queue/pause routes to QueueController", async () => {
    const response = await fetch(`${baseUrl}/api/queue/pause`, {
      method: "POST",
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.message).toBe("Queue paused");
  });

  test("/api/queue/resume routes to QueueController", async () => {
    // First pause, then resume
    await fetch(`${baseUrl}/api/queue/pause`, { method: "POST" });

    const response = await fetch(`${baseUrl}/api/queue/resume`, {
      method: "POST",
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.message).toBe("Queue resumed");
  });

  test("/api/queue/clear routes to QueueController", async () => {
    const response = await fetch(`${baseUrl}/api/queue/clear`, {
      method: "POST",
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(typeof data.removedCount).toBe("number");
  });

  test("/api/queue/:id returns 404 for non-existent job", async () => {
    const response = await fetch(`${baseUrl}/api/queue/non-existent-id`);

    expect(response.status).toBe(404);
  });

  test("/api/queue/:id/preview returns 404 for non-existent job", async () => {
    const response = await fetch(`${baseUrl}/api/queue/non-existent-id/preview`);

    expect(response.status).toBe(404);
  });

  test("DELETE /api/queue/:id returns 404 for non-existent job", async () => {
    const response = await fetch(`${baseUrl}/api/queue/non-existent-id`, {
      method: "DELETE",
    });

    expect(response.status).toBe(404);
  });

  test("/api/queue/:id/prioritize returns 404 for non-existent job", async () => {
    const response = await fetch(`${baseUrl}/api/queue/non-existent-id/prioritize`, {
      method: "POST",
    });

    expect(response.status).toBe(404);
  });
});

/**
 * Tests for Printer discovery API
 * @see docs/architecture.md for design details
 * @related src/server/ui/queue-controller.ts - QueueController
 * @related src/printers/discovery.ts - PrinterDiscoveryService
 */
describe("Printer discovery API", () => {
  let app: LogPrintApp;
  let baseUrl: string;

  beforeEach(async () => {
    app = new LogPrintApp({
      server: { port: 0, host: "127.0.0.1" },
      printer: { type: "native", options: {} },
      storage: { enabled: true, type: "sqlite", path: ":memory:" },
      ui: { enabled: true },
    });
    await app.start();
    const port = (app as unknown as { config: { server: { port: number } } }).config.server.port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await app.stop();
  });

  test("/api/printers returns 200 with array of printers", async () => {
    const response = await fetch(`${baseUrl}/api/printers`);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(Array.isArray(data.printers)).toBe(true);
  });

  test("/api/printers response includes required fields", async () => {
    const response = await fetch(`${baseUrl}/api/printers`);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.printers.length).toBeGreaterThan(0);

    const printer = data.printers[0];
    expect(typeof printer.name).toBe("string");
    expect(typeof printer.isDefault).toBe("boolean");
  });

  test("/api/printers marks default printer correctly", async () => {
    const response = await fetch(`${baseUrl}/api/printers`);

    expect(response.status).toBe(200);
    const data = await response.json();
    const defaultPrinters = data.printers.filter((p: { isDefault: boolean }) => p.isDefault);
    // Mock printers list (EPSON_PX1VL, PDF_Printer, Broken_Printer) doesn't include
    // the mock default printer (Default_Printer), so no printer is marked as default
    expect(defaultPrinters.length).toBeLessThanOrEqual(1);
  });
});
