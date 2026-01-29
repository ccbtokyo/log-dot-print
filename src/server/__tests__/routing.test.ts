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
});
