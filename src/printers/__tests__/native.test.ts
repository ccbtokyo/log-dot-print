// Import shared mock FIRST - this sets up the module mock
import {
  mockNamedPrinter,
  mockGetDefaultPrinter,
  mockGetPrinterByName,
  resetPrinterMocks,
} from "./printers-mock.js";

import { describe, test, expect, beforeEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stat } from "node:fs/promises";

import { NativePrinter } from "../native.js";
import { TypedEventEmitter } from "../../core/events.js";
import type { PrintJob, SystemConfig } from "../../core/types.js";

// Test fixtures
function createTestConfig(): SystemConfig {
  return {
    server: { port: 3000, host: "localhost" },
    printer: { type: "native", options: {} },
    queue: { maxSize: 100, retryAttempts: 3, retryDelayMs: 1000 },
    format: {
      maxLineWidth: 80,
      includeTimestamp: true,
      includeSource: true,
      includeLevel: true,
    },
  };
}

function createTestPrintJob(id: string = "test-123"): PrintJob {
  return {
    id,
    logEntry: {
      id,
      timestamp: new Date().toISOString(),
      level: "info",
      source: "test",
      message: "Test message",
      printed: false,
    },
    formattedContent: "Formatted test content\nLine 2\nLine 3",
    createdAt: new Date(),
    status: "pending",
    retryCount: 0,
  };
}

describe("NativePrinter", () => {
  let eventBus: TypedEventEmitter;
  let config: SystemConfig;

  beforeEach(() => {
    eventBus = new TypedEventEmitter();
    config = createTestConfig();
    resetPrinterMocks();
  });

  describe("constructor", () => {
    test("creates with default options", () => {
      const printer = new NativePrinter();
      expect(printer.name).toBe("native-printer");
      expect(printer.version).toBe("1.0.0");
    });

    test("creates with custom options", () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        copies: 2,
        duplex: true,
        quality: "high",
      });
      expect(printer.name).toBe("native-printer");
    });
  });

  describe("initialize", () => {
    test("connects to default printer when no name specified", async () => {
      const printer = new NativePrinter();
      await printer.initialize(eventBus, config);

      expect(mockGetDefaultPrinter).toHaveBeenCalledTimes(1);

      const status = await printer.getStatus();
      expect(status.connected).toBe(true);
      expect(status.name).toBe("Default_Printer");

      await printer.shutdown();
    });

    test("connects to named printer", async () => {
      const printer = new NativePrinter({ printerName: "EPSON_PX1VL" });
      await printer.initialize(eventBus, config);

      expect(mockGetPrinterByName).toHaveBeenCalledWith("EPSON_PX1VL");

      const status = await printer.getStatus();
      expect(status.connected).toBe(true);
      expect(status.name).toBe("EPSON_PX1VL");

      await printer.shutdown();
    });

    test("throws error for non-existent printer", async () => {
      mockGetPrinterByName.mockImplementationOnce(() => Promise.resolve(null));
      const printer = new NativePrinter({ printerName: "NonExistent" });

      await expect(printer.initialize(eventBus, config)).rejects.toThrow(
        "Printer not found: NonExistent",
      );
    });
  });

  describe("testConnection", () => {
    test("returns true for existing printer", async () => {
      const printer = new NativePrinter({ printerName: "EPSON_PX1VL" });
      const result = await printer.testConnection();
      expect(result).toBe(true);
    });

    test("returns false for non-existing printer", async () => {
      mockGetPrinterByName.mockImplementation(() => Promise.resolve(null));
      const printer = new NativePrinter({ printerName: "NonExistent" });
      const result = await printer.testConnection();
      expect(result).toBe(false);
    });
  });

  describe("getStatus", () => {
    test("returns correct status when connected", async () => {
      const printer = new NativePrinter({ printerName: "EPSON_PX1VL" });
      await printer.initialize(eventBus, config);

      const status = await printer.getStatus();
      expect(status).toEqual({
        connected: true,
        name: "EPSON_PX1VL",
        type: "native",
        ready: true,
        info: "idle",
      });

      await printer.shutdown();
    });

    test("returns correct status when not connected", async () => {
      const printer = new NativePrinter({ printerName: "EPSON_PX1VL" });

      const status = await printer.getStatus();
      expect(status.connected).toBe(false);
      expect(status.name).toBe("EPSON_PX1VL");
    });
  });

  describe("print", () => {
    test("prints job successfully", async () => {
      const printer = new NativePrinter({ printerName: "EPSON_PX1VL" });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob();
      await printer.print(job);

      expect(mockNamedPrinter.printFile).toHaveBeenCalledTimes(1);
      const [filePath, options] = mockNamedPrinter.printFile.mock.calls[0];
      expect(filePath).toMatch(/log-dot-print-[^/\\]+[\\/]+print-test-123\.txt$/);
      expect(options.simple).toMatchObject({
        copies: 1,
        quality: "normal",
        jobName: "log-test-123",
      });

      await printer.shutdown();
    });

    test("throws error when not connected", async () => {
      const printer = new NativePrinter();
      const job = createTestPrintJob();

      await expect(printer.print(job)).rejects.toThrow("Printer not connected");
    });

    test("cleans up temp file after printing", async () => {
      const printer = new NativePrinter({ printerName: "EPSON_PX1VL" });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob("cleanup-test");
      await printer.print(job);

      // Verify temp file was cleaned up
      const [filePath] = mockNamedPrinter.printFile.mock.calls[0];
      await expect(stat(filePath)).rejects.toThrow();

      await printer.shutdown();
    });

    test("uses custom print options", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        copies: 3,
        duplex: true,
        quality: "high",
        paperSize: "A4",
        landscape: true,
      });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob();
      await printer.print(job);

      const [, options] = mockNamedPrinter.printFile.mock.calls[0];
      expect(options.simple).toMatchObject({
        copies: 3,
        duplex: true,
        quality: "high",
        paperSize: "A4",
        landscape: true,
      });

      await printer.shutdown();
    });
  });

  describe("shutdown", () => {
    test("disconnects properly", async () => {
      const printer = new NativePrinter({ printerName: "EPSON_PX1VL" });
      await printer.initialize(eventBus, config);

      expect((await printer.getStatus()).connected).toBe(true);

      await printer.shutdown();

      expect((await printer.getStatus()).connected).toBe(false);
    });
  });
});
