// Must be imported before app/printer code to ensure @printers/printers is mocked for other test files.
import "../../printers/__tests__/printers-mock.js";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { LogPrintApp } from "../app.js";

/**
 * Integration tests for Simulate Settings API
 * Tests /api/settings/simulate endpoints for simulate mode toggle
 *
 * @related src/server/ui/queue-controller.ts - QueueController
 * @related src/storage/sqlite-storage.ts - SqliteStorage
 */
describe("Settings API - Simulate", () => {
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
    const port = (app as unknown as { config: { server: { port: number } } }).config.server.port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await app.stop();
  });

  describe("GET /api/settings/simulate", () => {
    test("returns simulate=false by default", async () => {
      const response = await fetch(`${baseUrl}/api/settings/simulate`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toEqual({ simulate: false });
    });
  });

  describe("PUT /api/settings/simulate", () => {
    test("enables simulate mode", async () => {
      const response = await fetch(`${baseUrl}/api/settings/simulate`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ simulate: true }),
      });
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toEqual({ success: true, simulate: true });
    });

    test("disables simulate mode", async () => {
      // First enable
      await fetch(`${baseUrl}/api/settings/simulate`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ simulate: true }),
      });

      // Then disable
      const response = await fetch(`${baseUrl}/api/settings/simulate`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ simulate: false }),
      });
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toEqual({ success: true, simulate: false });
    });

    test("persists simulate setting across requests", async () => {
      await fetch(`${baseUrl}/api/settings/simulate`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ simulate: true }),
      });

      const response = await fetch(`${baseUrl}/api/settings/simulate`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toEqual({ simulate: true });
    });

    test("returns 400 for missing simulate field", async () => {
      const response = await fetch(`${baseUrl}/api/settings/simulate`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(400);
    });

    test("returns 400 for non-boolean simulate value", async () => {
      const response = await fetch(`${baseUrl}/api/settings/simulate`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ simulate: "yes" }),
      });
      expect(response.status).toBe(400);
    });

    test("returns 400 for invalid JSON", async () => {
      const response = await fetch(`${baseUrl}/api/settings/simulate`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });
      expect(response.status).toBe(400);
    });
  });
});
