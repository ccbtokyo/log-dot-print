// Must be imported before app/printer code to ensure @printers/printers is mocked for other test files.
import "../../printers/__tests__/printers-mock.js";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { LogPrintApp } from "../app.js";

/**
 * Integration tests for Settings API
 * Tests /api/settings/printer endpoints for printer selection and persistence
 *
 * @see plans/printer-selector.md for feature specification
 * @related src/server/ui/queue-controller.ts - QueueController
 * @related src/storage/sqlite-storage.ts - SqliteStorage
 */
describe("Settings API - Printer", () => {
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

  describe("GET /api/settings/printer", () => {
    test("returns current printer settings", async () => {
      const response = await fetch(`${baseUrl}/api/settings/printer`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty("currentPrinter");
      expect(data).toHaveProperty("availablePrinters");
      expect(data).toHaveProperty("isDefault");
      expect(data).toHaveProperty("paperSize");
      expect(Array.isArray(data.availablePrinters)).toBe(true);
    });

    test("availablePrinters contains printer objects with required fields", async () => {
      const response = await fetch(`${baseUrl}/api/settings/printer`);
      expect(response.status).toBe(200);

      const data = await response.json();
      // Mocked environment may have no printers, but if there are any, they should have the right shape
      for (const printer of data.availablePrinters) {
        expect(printer).toHaveProperty("name");
        expect(typeof printer.name).toBe("string");
      }
    });
  });

  describe("PUT /api/settings/printer", () => {
    test("saves printer setting", async () => {
      const response = await fetch(`${baseUrl}/api/settings/printer`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ printerName: "Test Printer" }),
      });
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.printerName).toBe("Test Printer");
    });

    test("saved printer persists across requests", async () => {
      // Set the printer
      await fetch(`${baseUrl}/api/settings/printer`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ printerName: "EPSON VP-F4400 ESC/P" }),
      });

      // Get the settings
      const response = await fetch(`${baseUrl}/api/settings/printer`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.currentPrinter).toBe("EPSON VP-F4400 ESC/P");
      expect(data.isDefault).toBe(false);
    });

    test("returns 400 for missing printerName and paperSize", async () => {
      const response = await fetch(`${baseUrl}/api/settings/printer`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(400);
    });

    test("returns 400 for invalid JSON", async () => {
      const response = await fetch(`${baseUrl}/api/settings/printer`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });
      expect(response.status).toBe(400);
    });

    test("clears printer setting when printerName is null", async () => {
      // First, set a printer
      await fetch(`${baseUrl}/api/settings/printer`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ printerName: "Test Printer" }),
      });

      // Clear the setting
      const response = await fetch(`${baseUrl}/api/settings/printer`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ printerName: null }),
      });
      expect(response.status).toBe(200);

      // Verify it's cleared
      const getResponse = await fetch(`${baseUrl}/api/settings/printer`);
      const data = await getResponse.json();
      expect(data.currentPrinter).toBeNull();
      expect(data.isDefault).toBe(true);
    });

    test("saves paper size setting", async () => {
      const response = await fetch(`${baseUrl}/api/settings/printer`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paperSize: "A4" }),
      });
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.paperSize).toBe("A4");

      const getResponse = await fetch(`${baseUrl}/api/settings/printer`);
      const getData = await getResponse.json();
      expect(getData.paperSize).toBe("A4");
    });
  });
});
