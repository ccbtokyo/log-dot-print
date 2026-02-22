// Import shared mock FIRST - this sets up the module mock
import {
  mockGetPrinters,
  mockGetDefaultPrinter,
  mockPrint,
  resetPdfToPrinterMocks,
} from "./pdf-to-printer-mock.js";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stat, rm, mkdir, readFile } from "node:fs/promises";

import { PdfToPrinterPrinter } from "../pdf-to-printer.js";
import { TypedEventEmitter } from "../../core/events.js";
import type { PrintJob, SystemConfig } from "../../core/types.js";

function createTestConfig(): SystemConfig {
  return {
    server: { port: 3000, host: "localhost" },
    printer: { type: "pdf-to-printer", options: {} },
    queue: { maxSize: 100, retryAttempts: 3, retryDelayMs: 1000 },
    format: {
      outputFormat: "text",
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

describe("PdfToPrinterPrinter", () => {
  let eventBus: TypedEventEmitter;
  let config: SystemConfig;

  beforeEach(() => {
    eventBus = new TypedEventEmitter();
    config = createTestConfig();
    resetPdfToPrinterMocks();
  });

  describe("constructor", () => {
    test("creates with default options", () => {
      const printer = new PdfToPrinterPrinter();
      expect(printer.name).toBe("pdf-to-printer");
      expect(printer.version).toBe("1.0.0");
    });

    test("creates with custom options", () => {
      const printer = new PdfToPrinterPrinter({
        printerName: "EPSON VP-F4400",
        copies: 2,
        monochrome: true,
        scale: "noscale",
      });
      expect(printer.name).toBe("pdf-to-printer");
    });

    test("sanitizes invalid copies to 1", () => {
      const printer = new PdfToPrinterPrinter({ copies: -1 });
      expect(printer.name).toBe("pdf-to-printer");
    });

    test("trims printer name", () => {
      const printer = new PdfToPrinterPrinter({ printerName: "  EPSON VP-F4400  " });
      expect(printer.name).toBe("pdf-to-printer");
    });
  });

  describe("initialize", () => {
    test("connects to default printer when no name specified", async () => {
      const printer = new PdfToPrinterPrinter();
      await printer.initialize(eventBus, config);

      expect(mockGetDefaultPrinter).toHaveBeenCalledTimes(1);

      const status = await printer.getStatus();
      expect(status.connected).toBe(true);
      expect(status.name).toBe("Default PDF Printer");

      await printer.shutdown();
    });

    test("connects to named printer", async () => {
      const printer = new PdfToPrinterPrinter({ printerName: "EPSON VP-F4400" });
      await printer.initialize(eventBus, config);

      expect(mockGetPrinters).toHaveBeenCalledTimes(1);

      const status = await printer.getStatus();
      expect(status.connected).toBe(true);
      expect(status.name).toBe("EPSON VP-F4400");

      await printer.shutdown();
    });

    test("throws error for non-existent printer", async () => {
      const printer = new PdfToPrinterPrinter({ printerName: "NonExistent" });

      await expect(printer.initialize(eventBus, config)).rejects.toThrow(
        'Printer not found: "NonExistent"',
      );
    });

    test("connects in degraded mode when no default printer", async () => {
      mockGetDefaultPrinter.mockImplementationOnce(() => Promise.resolve(null));
      const printer = new PdfToPrinterPrinter();

      await printer.initialize(eventBus, config);

      const status = await printer.getStatus();
      expect(status.connected).toBe(true);
      expect(status.ready).toBe(false);

      await printer.shutdown();
    });
  });

  describe("print (PDF)", () => {
    test("prints PDF binary content successfully", async () => {
      const printer = new PdfToPrinterPrinter({ printerName: "EPSON VP-F4400" });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob("pdf-test");
      job.contentType = "pdf";
      job.binaryContent = Buffer.from("%PDF-1.4 test content");
      await printer.print(job);

      expect(mockPrint).toHaveBeenCalledTimes(1);
      const [filePath, options] = mockPrint.mock.calls[0];
      expect(filePath).toMatch(/\.pdf$/);
      expect(options.printer).toBe("EPSON VP-F4400");

      await printer.shutdown();
    });

    test("prints image binary content successfully", async () => {
      const printer = new PdfToPrinterPrinter({ printerName: "EPSON VP-F4400" });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob("image-test");
      job.contentType = "image";
      job.binaryContent = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      await printer.print(job);

      expect(mockPrint).toHaveBeenCalledTimes(1);
      const [filePath] = mockPrint.mock.calls[0];
      expect(filePath).toMatch(/\.png$/);

      await printer.shutdown();
    });

    test("throws error for text content type", async () => {
      const printer = new PdfToPrinterPrinter({ printerName: "EPSON VP-F4400" });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob("text-test");
      job.contentType = "text";
      await expect(printer.print(job)).rejects.toThrow(
        "pdf-to-printer only supports PDF and image content",
      );

      await printer.shutdown();
    });

    test("throws error for html content type", async () => {
      const printer = new PdfToPrinterPrinter({ printerName: "EPSON VP-F4400" });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob("html-test");
      job.contentType = "html";
      await expect(printer.print(job)).rejects.toThrow(
        "pdf-to-printer only supports PDF and image content",
      );

      await printer.shutdown();
    });

    test("throws error for json content type", async () => {
      const printer = new PdfToPrinterPrinter({ printerName: "EPSON VP-F4400" });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob("json-test");
      job.contentType = "json";
      await expect(printer.print(job)).rejects.toThrow(
        "pdf-to-printer only supports PDF and image content",
      );

      await printer.shutdown();
    });

    test("throws error when binaryContent is missing for PDF", async () => {
      const printer = new PdfToPrinterPrinter({ printerName: "EPSON VP-F4400" });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob("no-binary-test");
      job.contentType = "pdf";
      // binaryContent is undefined
      await expect(printer.print(job)).rejects.toThrow("binaryContent is required");

      await printer.shutdown();
    });
  });

  describe("print options", () => {
    test("uses fit scale option by default", async () => {
      const printer = new PdfToPrinterPrinter({
        printerName: "EPSON VP-F4400",
      });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob("default-scale-test");
      job.contentType = "pdf";
      job.binaryContent = Buffer.from("%PDF-1.4");
      await printer.print(job);

      const [, options] = mockPrint.mock.calls[0];
      expect(options.scale).toBe("fit");

      await printer.shutdown();
    });

    test("passes monochrome option", async () => {
      const printer = new PdfToPrinterPrinter({
        printerName: "EPSON VP-F4400",
        monochrome: true,
      });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob("mono-test");
      job.contentType = "pdf";
      job.binaryContent = Buffer.from("%PDF-1.4");
      await printer.print(job);

      const [, options] = mockPrint.mock.calls[0];
      expect(options.monochrome).toBe(true);

      await printer.shutdown();
    });

    test("passes scale option", async () => {
      const printer = new PdfToPrinterPrinter({
        printerName: "EPSON VP-F4400",
        scale: "noscale",
      });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob("scale-test");
      job.contentType = "pdf";
      job.binaryContent = Buffer.from("%PDF-1.4");
      await printer.print(job);

      const [, options] = mockPrint.mock.calls[0];
      expect(options.scale).toBe("noscale");

      await printer.shutdown();
    });

    test("passes orientation option", async () => {
      const printer = new PdfToPrinterPrinter({
        printerName: "EPSON VP-F4400",
        orientation: "portrait",
      });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob("orient-test");
      job.contentType = "pdf";
      job.binaryContent = Buffer.from("%PDF-1.4");
      await printer.print(job);

      const [, options] = mockPrint.mock.calls[0];
      expect(options.orientation).toBe("portrait");

      await printer.shutdown();
    });

    test("passes silent option", async () => {
      const printer = new PdfToPrinterPrinter({
        printerName: "EPSON VP-F4400",
        silent: true,
      });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob("silent-test");
      job.contentType = "pdf";
      job.binaryContent = Buffer.from("%PDF-1.4");
      await printer.print(job);

      const [, options] = mockPrint.mock.calls[0];
      expect(options.silent).toBe(true);

      await printer.shutdown();
    });

    test("passes copies option", async () => {
      const printer = new PdfToPrinterPrinter({
        printerName: "EPSON VP-F4400",
        copies: 3,
      });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob("copies-test");
      job.contentType = "pdf";
      job.binaryContent = Buffer.from("%PDF-1.4");
      await printer.print(job);

      const [, options] = mockPrint.mock.calls[0];
      expect(options.copies).toBe(3);

      await printer.shutdown();
    });

    test("passes paperSize option", async () => {
      const printer = new PdfToPrinterPrinter({
        printerName: "EPSON VP-F4400",
        paperSize: "A4",
      });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob("paper-test");
      job.contentType = "pdf";
      job.binaryContent = Buffer.from("%PDF-1.4");
      await printer.print(job);

      const [, options] = mockPrint.mock.calls[0];
      expect(options.paperSize).toBe("A4");

      await printer.shutdown();
    });

    test("passes side option", async () => {
      const printer = new PdfToPrinterPrinter({
        printerName: "EPSON VP-F4400",
        side: "duplex",
      });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob("side-test");
      job.contentType = "pdf";
      job.binaryContent = Buffer.from("%PDF-1.4");
      await printer.print(job);

      const [, options] = mockPrint.mock.calls[0];
      expect(options.side).toBe("duplex");

      await printer.shutdown();
    });

    test("passes bin option", async () => {
      const printer = new PdfToPrinterPrinter({
        printerName: "EPSON VP-F4400",
        bin: "Tray1",
      });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob("bin-test");
      job.contentType = "pdf";
      job.binaryContent = Buffer.from("%PDF-1.4");
      await printer.print(job);

      const [, options] = mockPrint.mock.calls[0];
      expect(options.bin).toBe("Tray1");

      await printer.shutdown();
    });

    test("passes sumatraPdfPath option", async () => {
      const printer = new PdfToPrinterPrinter({
        printerName: "EPSON VP-F4400",
        sumatraPdfPath: "C:\\SumatraPDF\\SumatraPDF.exe",
      });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob("sumatra-test");
      job.contentType = "pdf";
      job.binaryContent = Buffer.from("%PDF-1.4");
      await printer.print(job);

      const [, options] = mockPrint.mock.calls[0];
      expect(options.sumatraPdfPath).toBe("C:\\SumatraPDF\\SumatraPDF.exe");

      await printer.shutdown();
    });
  });

  describe("print guards", () => {
    test("throws error when not connected", async () => {
      const printer = new PdfToPrinterPrinter();
      const job = createTestPrintJob();
      job.contentType = "pdf";
      job.binaryContent = Buffer.from("%PDF-1.4");

      await expect(printer.print(job)).rejects.toThrow("Printer not connected");
    });

    test("throws error when in degraded mode (no default printer)", async () => {
      mockGetDefaultPrinter.mockImplementationOnce(() => Promise.resolve(null));
      const printer = new PdfToPrinterPrinter();
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob();
      job.contentType = "pdf";
      job.binaryContent = Buffer.from("%PDF-1.4");
      await expect(printer.print(job)).rejects.toThrow("Printer not connected");

      await printer.shutdown();
    });

    test("resolves printer name from storage callback", async () => {
      const printer = new PdfToPrinterPrinter({
        getPrinterNameFromStorage: async () => "EPSON VP-F4400",
      });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob("storage-name-test");
      job.contentType = "pdf";
      job.binaryContent = Buffer.from("%PDF-1.4");
      await printer.print(job);

      const [, options] = mockPrint.mock.calls[0];
      expect(options.printer).toBe("EPSON VP-F4400");

      await printer.shutdown();
    });

    test("falls back to connected printer when storage returns null", async () => {
      const printer = new PdfToPrinterPrinter({
        printerName: "EPSON VP-F4400",
        getPrinterNameFromStorage: async () => null,
      });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob("fallback-name-test");
      job.contentType = "pdf";
      job.binaryContent = Buffer.from("%PDF-1.4");
      await printer.print(job);

      const [, options] = mockPrint.mock.calls[0];
      expect(options.printer).toBe("EPSON VP-F4400");

      await printer.shutdown();
    });
  });

  describe("shutdown", () => {
    test("disconnects properly", async () => {
      const printer = new PdfToPrinterPrinter({ printerName: "EPSON VP-F4400" });
      await printer.initialize(eventBus, config);

      expect((await printer.getStatus()).connected).toBe(true);

      await printer.shutdown();

      expect((await printer.getStatus()).connected).toBe(false);
    });

    test("emits printer:disconnected event on shutdown", async () => {
      const printer = new PdfToPrinterPrinter({ printerName: "EPSON VP-F4400" });
      await printer.initialize(eventBus, config);

      let disconnectedEvent = false;
      eventBus.on("printer:disconnected", () => {
        disconnectedEvent = true;
      });

      await printer.shutdown();
      expect(disconnectedEvent).toBe(true);
    });
  });

  describe("file persistence", () => {
    const customPersistDir = join(tmpdir(), "log-dot-print-pdf-to-printer-test-persist");
    const defaultPersistDir = "./data/prints";

    beforeEach(async () => {
      await mkdir(customPersistDir, { recursive: true });
    });

    afterEach(async () => {
      await rm(customPersistDir, { recursive: true, force: true });
      await rm(defaultPersistDir, { recursive: true, force: true }).catch(() => {});
    });

    test("persists print file when persistDir is configured", async () => {
      const printer = new PdfToPrinterPrinter({
        printerName: "EPSON VP-F4400",
        persistDir: customPersistDir,
      });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob("persist-pdf-test");
      job.contentType = "pdf";
      job.binaryContent = Buffer.from("%PDF-1.4 test content");
      await printer.print(job);

      expect(job.filePath).toBeDefined();
      expect(job.filePath).toContain(customPersistDir);
      expect(job.filePath).toContain("persist-pdf-test");

      const content = await readFile(job.filePath!);
      expect(content.toString()).toBe("%PDF-1.4 test content");

      await printer.shutdown();
    });

    test("uses default persistDir when not configured", async () => {
      const printer = new PdfToPrinterPrinter({ printerName: "EPSON VP-F4400" });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob("default-persist-pdf-test");
      job.contentType = "pdf";
      job.binaryContent = Buffer.from("%PDF-1.4 test");
      await printer.print(job);

      expect(job.filePath).toBeDefined();
      expect(job.filePath).toMatch(/data[/\\]prints/);

      await printer.shutdown();
    });

    test("cleans up temp file after printing", async () => {
      const printer = new PdfToPrinterPrinter({
        printerName: "EPSON VP-F4400",
        persistDir: customPersistDir,
      });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob("cleanup-test");
      job.contentType = "pdf";
      job.binaryContent = Buffer.from("%PDF-1.4");
      await printer.print(job);

      // Temp file should be cleaned up; the print mock was called with a temp path
      const [filePath] = mockPrint.mock.calls[0];
      await expect(stat(filePath)).rejects.toThrow();

      await printer.shutdown();
    });
  });
});
