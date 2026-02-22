// Import shared mock FIRST - this sets up the module mock
import {
  mockNamedPrinter,
  mockGetDefaultPrinter,
  mockGetPrinterByName,
  resetPrinterMocks,
} from "./printers-mock.js";
import { mockPrint, resetPdfToPrinterMocks } from "./pdf-to-printer-mock.js";

import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stat, rm, mkdir, readFile } from "node:fs/promises";

import { NativePrinter } from "../native.js";
import { TypedEventEmitter } from "../../core/events.js";
import type { PrintJob, SystemConfig } from "../../core/types.js";

/**
 * Override NativePrinter's private isWindowsPlatform() for testing.
 * This avoids mock.module leaking across test files.
 */
function enableWindowsPlatform(printer: NativePrinter): void {
  // biome-ignore lint/suspicious/noExplicitAny: test-only override of private method
  (printer as any).isWindowsPlatform = () => true;
}

function disableWindowsPlatform(printer: NativePrinter): void {
  // biome-ignore lint/suspicious/noExplicitAny: test-only override of private method
  (printer as any).isWindowsPlatform = () => false;
}

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
    resetPdfToPrinterMocks();
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

    test("connects in degraded mode when no default printer", async () => {
      mockGetDefaultPrinter.mockImplementationOnce(() => Promise.resolve(null));
      const printer = new NativePrinter();

      await printer.initialize(eventBus, config);

      const status = await printer.getStatus();
      expect(status.connected).toBe(true);
      expect(status.ready).toBe(false);

      await printer.shutdown();
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

    test("throws error when in degraded mode", async () => {
      mockGetDefaultPrinter.mockImplementationOnce(() => Promise.resolve(null));
      const printer = new NativePrinter();
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob();
      await expect(printer.print(job)).rejects.toThrow("Printer not connected");

      await printer.shutdown();
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

    test("accepts arbitrary string as paperSize", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        paperSize: "Custom.11x15.5in",
      });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob();
      await printer.print(job);

      const [, options] = mockNamedPrinter.printFile.mock.calls[0];
      expect(options.simple.paperSize).toBe("Custom.11x15.5in");

      await printer.shutdown();
    });

    test("uses getPaperSizeFromStorage callback value over config paperSize", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        paperSize: "A4",
        getPaperSizeFromStorage: async () => "Custom.11x15in",
      });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob();
      await printer.print(job);

      const [, options] = mockNamedPrinter.printFile.mock.calls[0];
      expect(options.simple.paperSize).toBe("Custom.11x15in");

      await printer.shutdown();
    });

    test("falls back to config paperSize when storage returns null", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        paperSize: "A4",
        getPaperSizeFromStorage: async () => null,
      });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob();
      await printer.print(job);

      const [, options] = mockNamedPrinter.printFile.mock.calls[0];
      expect(options.simple.paperSize).toBe("A4");

      await printer.shutdown();
    });

    test("uses config paperSize when no storage callback is set", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        paperSize: "Letter",
      });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob();
      await printer.print(job);

      const [, options] = mockNamedPrinter.printFile.mock.calls[0];
      expect(options.simple.paperSize).toBe("Letter");

      await printer.shutdown();
    });

    test("does not set paperSize when neither storage nor config provides one", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
      });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob();
      await printer.print(job);

      const [, options] = mockNamedPrinter.printFile.mock.calls[0];
      expect(options.simple.paperSize).toBeUndefined();

      await printer.shutdown();
    });
  });

  describe("CUPS options", () => {
    test("sends orientation-requested=3 when landscape is false (default)", async () => {
      const printer = new NativePrinter({ printerName: "EPSON_PX1VL" });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob();
      await printer.print(job);

      const [, options] = mockNamedPrinter.printFile.mock.calls[0];
      expect(options.cups).toBeDefined();
      expect(options.cups["orientation-requested"]).toBe(3);

      await printer.shutdown();
    });

    test("does not send orientation-requested when landscape is true", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        landscape: true,
      });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob();
      await printer.print(job);

      const [, options] = mockNamedPrinter.printFile.mock.calls[0];
      expect(options.cups?.["orientation-requested"]).toBeUndefined();

      await printer.shutdown();
    });

    test("does not send orientation-requested for custom dimensions paper", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        paperSize: "Custom.15x11in",
      });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob();
      await printer.print(job);

      const [, options] = mockNamedPrinter.printFile.mock.calls[0];
      // Custom dimensions encode orientation via width/height
      expect(options.cups?.["orientation-requested"]).toBeUndefined();

      await printer.shutdown();
    });

    test("sends fit-to-page=false and natural-scaling=100 by default", async () => {
      const printer = new NativePrinter({ printerName: "EPSON_PX1VL" });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob();
      await printer.print(job);

      const [, options] = mockNamedPrinter.printFile.mock.calls[0];
      expect(options.cups["fit-to-page"]).toBe(false);
      expect(options.cups["natural-scaling"]).toBe(100);

      await printer.shutdown();
    });

    test("does not send scaling options when fitToPage is true", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        fitToPage: true,
      });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob();
      await printer.print(job);

      const [, options] = mockNamedPrinter.printFile.mock.calls[0];
      expect(options.cups?.["fit-to-page"]).toBeUndefined();
      expect(options.cups?.["natural-scaling"]).toBeUndefined();

      await printer.shutdown();
    });
  });

  describe("Windows PDF fallback", () => {
    const customPersistDir = join(tmpdir(), "log-dot-print-test-win-pdf");

    function createPdfPrintJob(id: string = "pdf-test"): PrintJob {
      return {
        id,
        logEntry: {
          id,
          timestamp: new Date().toISOString(),
          level: "info",
          source: "test",
          message: "Test PDF message",
          printed: false,
        },
        formattedContent: "",
        createdAt: new Date(),
        status: "pending",
        retryCount: 0,
        contentType: "pdf",
        binaryContent: Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]),
      };
    }

    beforeEach(async () => {
      await mkdir(customPersistDir, { recursive: true });
    });

    afterEach(async () => {
      await rm(customPersistDir, { recursive: true, force: true });
    });

    test("uses pdf-to-printer when Windows and PDF", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        persistDir: customPersistDir,
      });
      enableWindowsPlatform(printer);
      await printer.initialize(eventBus, config);

      const job = createPdfPrintJob();
      await printer.print(job);

      expect(mockPrint).toHaveBeenCalledTimes(1);
      expect(mockNamedPrinter.printFile).not.toHaveBeenCalled();

      await printer.shutdown();
    });

    test("passes printer name to pdf-to-printer", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        persistDir: customPersistDir,
      });
      enableWindowsPlatform(printer);
      await printer.initialize(eventBus, config);

      const job = createPdfPrintJob();
      await printer.print(job);

      const [, printOptions] = mockPrint.mock.calls[0];
      expect(printOptions.printer).toBe("EPSON_PX1VL");
      expect(printOptions.monochrome).toBe(true);
      expect(printOptions.orientation).toBe("portrait");
      expect(printOptions.silent).toBe(true);

      await printer.shutdown();
    });

    test("maps landscape option to orientation", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        landscape: true,
        persistDir: customPersistDir,
      });
      enableWindowsPlatform(printer);
      await printer.initialize(eventBus, config);

      const job = createPdfPrintJob();
      await printer.print(job);

      const [, printOptions] = mockPrint.mock.calls[0];
      expect(printOptions.orientation).toBe("landscape");

      await printer.shutdown();
    });

    test("maps duplex option to side", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        duplex: true,
        persistDir: customPersistDir,
      });
      enableWindowsPlatform(printer);
      await printer.initialize(eventBus, config);

      const job = createPdfPrintJob();
      await printer.print(job);

      const [, printOptions] = mockPrint.mock.calls[0];
      expect(printOptions.side).toBe("duplex");

      await printer.shutdown();
    });

    test("maps fitToPage option to scale", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        fitToPage: true,
        persistDir: customPersistDir,
      });
      enableWindowsPlatform(printer);
      await printer.initialize(eventBus, config);

      const job = createPdfPrintJob();
      await printer.print(job);

      const [, printOptions] = mockPrint.mock.calls[0];
      expect(printOptions.scale).toBe("fit");

      await printer.shutdown();
    });

    test("uses noscale when fitToPage is false", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        fitToPage: false,
        persistDir: customPersistDir,
      });
      enableWindowsPlatform(printer);
      await printer.initialize(eventBus, config);

      const job = createPdfPrintJob();
      await printer.print(job);

      const [, printOptions] = mockPrint.mock.calls[0];
      expect(printOptions.scale).toBe("noscale");

      await printer.shutdown();
    });

    test("uses @printers/printers for Windows text content", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        persistDir: customPersistDir,
      });
      enableWindowsPlatform(printer);
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob();
      await printer.print(job);

      expect(mockNamedPrinter.printFile).toHaveBeenCalledTimes(1);
      expect(mockPrint).not.toHaveBeenCalled();

      await printer.shutdown();
    });

    test("uses @printers/printers for Windows image content", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        persistDir: customPersistDir,
      });
      enableWindowsPlatform(printer);
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob("image-test");
      job.contentType = "image";
      job.binaryContent = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      await printer.print(job);

      expect(mockNamedPrinter.printFile).toHaveBeenCalledTimes(1);
      expect(mockPrint).not.toHaveBeenCalled();

      await printer.shutdown();
    });

    test("uses @printers/printers for non-Windows PDF", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        persistDir: customPersistDir,
      });
      disableWindowsPlatform(printer);
      await printer.initialize(eventBus, config);

      const job = createPdfPrintJob();
      await printer.print(job);

      expect(mockNamedPrinter.printFile).toHaveBeenCalledTimes(1);
      expect(mockPrint).not.toHaveBeenCalled();

      await printer.shutdown();
    });

    test("uses storage printer name for Windows PDF", async () => {
      const storagePrinter = {
        name: "Storage_Printer",
        state: "idle",
        printFile: mock(() => Promise.resolve(99999)),
      };
      mockGetPrinterByName.mockImplementation((name: string) => {
        if (name === "Storage_Printer") return storagePrinter;
        if (name === "EPSON_PX1VL") return mockNamedPrinter;
        return null;
      });

      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        persistDir: customPersistDir,
        getPrinterNameFromStorage: async () => "Storage_Printer",
      });
      enableWindowsPlatform(printer);
      await printer.initialize(eventBus, config);

      const job = createPdfPrintJob();
      await printer.print(job);

      const [, printOptions] = mockPrint.mock.calls[0];
      expect(printOptions.printer).toBe("Storage_Printer");

      await printer.shutdown();
    });

    test("persists file for Windows PDF print", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        persistDir: customPersistDir,
      });
      enableWindowsPlatform(printer);
      await printer.initialize(eventBus, config);

      const job = createPdfPrintJob("persist-pdf-test");
      await printer.print(job);

      expect(job.filePath).toBeDefined();
      expect(job.filePath).toContain(customPersistDir);
      expect(job.filePath).toMatch(/\.pdf$/);

      const content = await readFile(job.filePath!);
      expect(content[0]).toBe(0x25);
      expect(content[1]).toBe(0x50);

      await printer.shutdown();
    });

    test("passes configured paper size directly to SumatraPDF", async () => {
      const warnSpy = mock(() => {});
      const origWarn = console.warn;
      console.warn = warnSpy;

      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        paperSize: "15x11",
        persistDir: customPersistDir,
      });
      enableWindowsPlatform(printer);
      await printer.initialize(eventBus, config);

      const job = createPdfPrintJob();
      await printer.print(job);

      // Raw paper name is passed through without normalization
      const [, printOptions] = mockPrint.mock.calls[0];
      expect(printOptions.paperSize).toBe("15x11");

      // CUPS normalization warning must NOT fire for Windows PDF path
      const paperSizeWarnings = warnSpy.mock.calls.filter(
        (args) => typeof args[0] === "string" && args[0].includes("[PaperSize]"),
      );
      expect(paperSizeWarnings).toHaveLength(0);
      console.warn = origWarn;

      await printer.shutdown();
    });

    test("passes Windows fanfold paper name to SumatraPDF", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        paperSize: "Fanfold 15 x 11 1/2 inch",
        persistDir: customPersistDir,
      });
      enableWindowsPlatform(printer);
      await printer.initialize(eventBus, config);

      const job = createPdfPrintJob();
      await printer.print(job);

      const [, printOptions] = mockPrint.mock.calls[0];
      expect(printOptions.paperSize).toBe("Fanfold 15 x 11 1/2 inch");

      await printer.shutdown();
    });

    test("does not set paperSize on SumatraPDF when not configured", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        persistDir: customPersistDir,
      });
      enableWindowsPlatform(printer);
      await printer.initialize(eventBus, config);

      const job = createPdfPrintJob();
      await printer.print(job);

      const [, printOptions] = mockPrint.mock.calls[0];
      expect(printOptions.paperSize).toBeUndefined();

      await printer.shutdown();
    });

    test("skips Custom.* CUPS format for SumatraPDF", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        paperSize: "Custom.11x15.5in",
        persistDir: customPersistDir,
      });
      enableWindowsPlatform(printer);
      await printer.initialize(eventBus, config);

      const job = createPdfPrintJob();
      await printer.print(job);

      // Custom.* is CUPS syntax — SumatraPDF cannot parse it
      const [, printOptions] = mockPrint.mock.calls[0];
      expect(printOptions.paperSize).toBeUndefined();

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

  describe("file persistence", () => {
    const customPersistDir = join(tmpdir(), "log-dot-print-test-persist");
    const defaultPersistDir = "./data/prints";

    beforeEach(async () => {
      await mkdir(customPersistDir, { recursive: true });
    });

    afterEach(async () => {
      await rm(customPersistDir, { recursive: true, force: true });
      // Clean up default persist dir if created during tests
      await rm(defaultPersistDir, { recursive: true, force: true }).catch(() => {});
    });

    test("persists print file when persistDir is configured", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        persistDir: customPersistDir,
      });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob("persist-test");
      await printer.print(job);

      // Verify file path is set on job
      expect(job.filePath).toBeDefined();
      expect(job.filePath).toContain(customPersistDir);
      expect(job.filePath).toContain("persist-test");

      // Verify file exists and has correct content
      const content = await readFile(job.filePath!, "utf-8");
      expect(content).toBe(job.formattedContent);

      await printer.shutdown();
    });

    test("uses default persistDir when not configured", async () => {
      const printer = new NativePrinter({ printerName: "EPSON_PX1VL" });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob("default-persist-test");
      await printer.print(job);

      // Verify file path is set and uses default directory
      expect(job.filePath).toBeDefined();
      expect(job.filePath).toMatch(/data[/\\]prints/);
      expect(job.filePath).toContain("default-persist-test");

      // Verify file exists and has correct content
      const content = await readFile(job.filePath!, "utf-8");
      expect(content).toBe(job.formattedContent);

      await printer.shutdown();
    });

    test("uses .txt extension for text contentType", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        persistDir: customPersistDir,
      });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob("text-ext-test");
      job.contentType = "text";
      await printer.print(job);

      expect(job.filePath).toBeDefined();
      expect(job.filePath).toMatch(/\.txt$/);

      await printer.shutdown();
    });

    test("uses .json extension for json contentType", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        persistDir: customPersistDir,
      });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob("json-ext-test");
      job.contentType = "json";
      await printer.print(job);

      expect(job.filePath).toBeDefined();
      expect(job.filePath).toMatch(/\.json$/);

      await printer.shutdown();
    });

    test("uses .html extension for html contentType", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        persistDir: customPersistDir,
      });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob("html-ext-test");
      job.contentType = "html";
      await printer.print(job);

      expect(job.filePath).toBeDefined();
      expect(job.filePath).toMatch(/\.html$/);

      await printer.shutdown();
    });

    test("uses .txt extension when contentType is undefined", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        persistDir: customPersistDir,
      });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob("no-content-type-test");
      // contentType is not set (undefined)
      await printer.print(job);

      expect(job.filePath).toBeDefined();
      expect(job.filePath).toMatch(/\.txt$/);

      await printer.shutdown();
    });

    test("uses .png extension for image contentType", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        persistDir: customPersistDir,
      });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob("image-ext-test");
      job.contentType = "image";
      // PNG magic bytes
      job.binaryContent = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      await printer.print(job);

      expect(job.filePath).toBeDefined();
      expect(job.filePath).toMatch(/\.png$/);

      // Verify binary content was written
      const content = await readFile(job.filePath!);
      expect(content[0]).toBe(0x89);
      expect(content[1]).toBe(0x50);
      expect(content[2]).toBe(0x4e);
      expect(content[3]).toBe(0x47);

      await printer.shutdown();
    });

    test("uses .pdf extension for pdf contentType", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        persistDir: customPersistDir,
      });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob("pdf-ext-test");
      job.contentType = "pdf";
      // PDF magic bytes: %PDF
      job.binaryContent = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
      await printer.print(job);

      expect(job.filePath).toBeDefined();
      expect(job.filePath).toMatch(/\.pdf$/);

      // Verify binary content was written
      const content = await readFile(job.filePath!);
      expect(content[0]).toBe(0x25); // %
      expect(content[1]).toBe(0x50); // P
      expect(content[2]).toBe(0x44); // D
      expect(content[3]).toBe(0x46); // F

      await printer.shutdown();
    });

    test("writes binary content for image contentType", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        persistDir: customPersistDir,
      });
      await printer.initialize(eventBus, config);

      const testImageData = Buffer.alloc(100, 0xaa);
      const job = createTestPrintJob("binary-content-test");
      job.contentType = "image";
      job.binaryContent = testImageData;
      await printer.print(job);

      // Verify binary content was written correctly
      const content = await readFile(job.filePath!);
      expect(content.length).toBe(100);
      expect(content.every((b) => b === 0xaa)).toBe(true);

      await printer.shutdown();
    });
  });
});
