// Must be imported before app/printer code to ensure @printers/printers is mocked for other test files.
import "../../printers/__tests__/printers-mock.js";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { LogPrintApp } from "../app.js";

/**
 * Integration tests for Paper Settings API
 * Tests /api/papers and /api/settings/paper endpoints
 *
 * @related src/server/ui/queue-controller.ts - QueueController
 * @related src/printers/paper-discovery.ts - getAvailablePaperSizes
 * @related src/storage/sqlite-storage.ts - SqliteStorage
 */
describe("Paper Settings API", () => {
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

  describe("GET /api/papers", () => {
    test("returns paper sizes list with correct shape", async () => {
      const response = await fetch(`${baseUrl}/api/papers`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty("paperSizes");
      expect(data).toHaveProperty("source");
      expect(data).toHaveProperty("printerName");
      expect(Array.isArray(data.paperSizes)).toBe(true);
      expect(data.paperSizes.length).toBeGreaterThan(0);
      expect(["dynamic", "fallback"]).toContain(data.source);
    });
  });

  describe("GET /api/settings/paper", () => {
    test("returns default paper settings initially", async () => {
      const response = await fetch(`${baseUrl}/api/settings/paper`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.currentPaperSize).toBeNull();
      expect(data.isDefault).toBe(true);
    });
  });

  describe("PUT /api/settings/paper", () => {
    test("saves paper size setting", async () => {
      const response = await fetch(`${baseUrl}/api/settings/paper`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paperSize: "A4" }),
      });
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.paperSize).toBe("A4");
    });

    test("saved paper size persists across requests", async () => {
      await fetch(`${baseUrl}/api/settings/paper`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paperSize: "A4" }),
      });

      const response = await fetch(`${baseUrl}/api/settings/paper`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.currentPaperSize).toBe("A4");
      expect(data.isDefault).toBe(false);
    });

    test("clears paper size setting when null", async () => {
      // Set a paper size first
      await fetch(`${baseUrl}/api/settings/paper`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paperSize: "A4" }),
      });

      // Clear it
      const response = await fetch(`${baseUrl}/api/settings/paper`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paperSize: null }),
      });
      expect(response.status).toBe(200);

      // Verify cleared
      const getResponse = await fetch(`${baseUrl}/api/settings/paper`);
      const data = await getResponse.json();
      expect(data.currentPaperSize).toBeNull();
      expect(data.isDefault).toBe(true);
    });

    test("returns 400 for missing paperSize field", async () => {
      const response = await fetch(`${baseUrl}/api/settings/paper`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(400);
    });

    test("returns 400 for invalid JSON", async () => {
      const response = await fetch(`${baseUrl}/api/settings/paper`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });
      expect(response.status).toBe(400);
    });

    test("returns 400 for unknown paper size with available sizes", async () => {
      const response = await fetch(`${baseUrl}/api/settings/paper`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paperSize: "NonExistentSize" }),
      });
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data).toHaveProperty("error");
      expect(data).toHaveProperty("availableSizes");
      expect(Array.isArray(data.availableSizes)).toBe(true);
    });

    test("returns 400 for empty string", async () => {
      const response = await fetch(`${baseUrl}/api/settings/paper`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paperSize: "" }),
      });
      expect(response.status).toBe(400);
    });
  });
});
