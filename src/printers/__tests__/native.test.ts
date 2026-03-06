// Import shared mock FIRST - this sets up the module mock
import {
  mockNamedPrinter,
  mockGetDefaultPrinter,
  mockGetPrinterByName,
  resetPrinterMocks,
} from "./printers-mock.js";

import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stat, rm, mkdir, readFile } from "node:fs/promises";

import { NativePrinter, buildSumatraSettings } from "../native.js";
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

/**
 * Mock SumatraPDF printing on a NativePrinter instance.
 * Returns an array that captures [filePath, printerName, options, rawPaperSize] for each call.
 */
function mockSumatraPrint(
  printer: NativePrinter,
): Array<[string, string, unknown, string | undefined]> {
  const calls: Array<[string, string, unknown, string | undefined]> = [];
  // biome-ignore lint/suspicious/noExplicitAny: test-only override of protected method
  (printer as any).printPdfViaSumatraPDF = mock(
    async (filePath: string, printerName: string, options: unknown, rawPaperSize?: string) => {
      calls.push([filePath, printerName, options, rawPaperSize]);
    },
  );
  return calls;
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

  describe("buildSumatraSettings", () => {
    function defaultOptions(): Parameters<typeof buildSumatraSettings>[0] {
      return {
        printerName: "EPSON_PX1VL",
        copies: 1,
        duplex: false,
        color: false,
        landscape: false,
        fitToPage: false,
        quality: "normal",
        simulate: false,
        persistDir: "./data/prints",
      };
    }

    test("includes disable-auto-rotation by default", () => {
      const s = buildSumatraSettings(defaultOptions());
      expect(s).toContain("disable-auto-rotation");
    });

    test("does not include landscape when landscape is false", () => {
      const s = buildSumatraSettings(defaultOptions());
      expect(s).not.toContain("landscape");
    });

    test("includes landscape when landscape is true", () => {
      const s = buildSumatraSettings({ ...defaultOptions(), landscape: true });
      expect(s).toContain("landscape");
      // Both must be present (sumatrapdfreader/sumatrapdf#2353)
      expect(s).toContain("disable-auto-rotation");
    });

    test("includes noscale when fitToPage is false", () => {
      const s = buildSumatraSettings(defaultOptions());
      expect(s).toContain("noscale");
      expect(s).not.toContain("fit");
    });

    test("includes fit when fitToPage is true", () => {
      const s = buildSumatraSettings({ ...defaultOptions(), fitToPage: true });
      expect(s).toContain("fit");
      expect(s).not.toContain("noscale");
    });

    test("does not include color or monochrome", () => {
      const s = buildSumatraSettings(defaultOptions());
      expect(s).not.toContain("color");
      expect(s).not.toContain("monochrome");
    });

    test("does not include color even when color option is true", () => {
      const s = buildSumatraSettings({ ...defaultOptions(), color: true });
      expect(s).not.toContain("color");
      expect(s).not.toContain("monochrome");
    });

    test("includes copies", () => {
      const s = buildSumatraSettings({ ...defaultOptions(), copies: 3 });
      expect(s).toContain("3x");
    });

    test("defaults to 1x copies", () => {
      const s = buildSumatraSettings(defaultOptions());
      expect(s).toContain("1x");
    });

    test("includes duplex when enabled", () => {
      const s = buildSumatraSettings({ ...defaultOptions(), duplex: true });
      expect(s).toContain("duplex");
    });

    test("does not include duplex when disabled", () => {
      const s = buildSumatraSettings(defaultOptions());
      expect(s).not.toContain("duplex");
    });

    test("includes bin when configured", () => {
      const s = buildSumatraSettings({ ...defaultOptions(), bin: "1" });
      expect(s).toContain("bin=1");
    });

    test("does not include bin when not configured", () => {
      const s = buildSumatraSettings(defaultOptions());
      expect(s).not.toContain("bin=");
    });

    test("includes paperkind when configured", () => {
      const s = buildSumatraSettings({ ...defaultOptions(), paperKind: 261 });
      expect(s).toContain("paperkind=261");
    });

    test("does not include paperkind when not configured", () => {
      const s = buildSumatraSettings(defaultOptions());
      expect(s).not.toContain("paperkind=");
    });

    test("includes paper= from rawPaperSize when no paperKind", () => {
      const s = buildSumatraSettings(defaultOptions(), "15x11");
      expect(s).toContain("paper=15x11");
    });

    test("paperkind takes precedence over rawPaperSize", () => {
      const s = buildSumatraSettings({ ...defaultOptions(), paperKind: 120 }, "15x11");
      expect(s).toContain("paperkind=120");
      expect(s).not.toContain("paper=");
    });

    test("skips Custom.* CUPS format paper name", () => {
      const s = buildSumatraSettings(defaultOptions(), "Custom.11x15.5in");
      expect(s).not.toContain("paper=");
      expect(s).not.toContain("Custom");
    });

    test("full default settings string", () => {
      const s = buildSumatraSettings(defaultOptions());
      expect(s).toBe("disable-auto-rotation,noscale,1x");
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

    test("uses SumatraPDF when Windows and PDF", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        persistDir: customPersistDir,
      });
      await printer.initialize(eventBus, config);
      enableWindowsPlatform(printer);
      const calls = mockSumatraPrint(printer);

      const job = createPdfPrintJob();
      await printer.print(job);

      expect(calls).toHaveLength(1);
      expect(mockNamedPrinter.printFile).not.toHaveBeenCalled();

      await printer.shutdown();
    });

    test("passes correct printer name to SumatraPDF", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        persistDir: customPersistDir,
      });
      await printer.initialize(eventBus, config);
      enableWindowsPlatform(printer);
      const calls = mockSumatraPrint(printer);

      const job = createPdfPrintJob();
      await printer.print(job);

      const [, printerName] = calls[0];
      expect(printerName).toBe("EPSON_PX1VL");

      await printer.shutdown();
    });

    test("uses @printers/printers for Windows text content", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        persistDir: customPersistDir,
      });
      await printer.initialize(eventBus, config);
      enableWindowsPlatform(printer);
      const calls = mockSumatraPrint(printer);

      const job = createTestPrintJob();
      await printer.print(job);

      expect(mockNamedPrinter.printFile).toHaveBeenCalledTimes(1);
      expect(calls).toHaveLength(0);

      await printer.shutdown();
    });

    test("uses @printers/printers for Windows image content", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        persistDir: customPersistDir,
      });
      await printer.initialize(eventBus, config);
      enableWindowsPlatform(printer);
      const calls = mockSumatraPrint(printer);

      const job = createTestPrintJob("image-test");
      job.contentType = "image";
      job.binaryContent = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      await printer.print(job);

      expect(mockNamedPrinter.printFile).toHaveBeenCalledTimes(1);
      expect(calls).toHaveLength(0);

      await printer.shutdown();
    });

    test("uses @printers/printers for non-Windows PDF", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        persistDir: customPersistDir,
      });
      disableWindowsPlatform(printer);
      await printer.initialize(eventBus, config);
      const calls = mockSumatraPrint(printer);

      const job = createPdfPrintJob();
      await printer.print(job);

      expect(mockNamedPrinter.printFile).toHaveBeenCalledTimes(1);
      expect(calls).toHaveLength(0);

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
      await printer.initialize(eventBus, config);
      enableWindowsPlatform(printer);
      const calls = mockSumatraPrint(printer);

      const job = createPdfPrintJob();
      await printer.print(job);

      const [, printerName] = calls[0];
      expect(printerName).toBe("Storage_Printer");

      await printer.shutdown();
    });

    test("persists file for Windows PDF print", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        persistDir: customPersistDir,
      });
      await printer.initialize(eventBus, config);
      enableWindowsPlatform(printer);
      mockSumatraPrint(printer);

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

    test("passes rawPaperSize to SumatraPDF", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        paperSize: "15x11",
        persistDir: customPersistDir,
      });
      await printer.initialize(eventBus, config);
      enableWindowsPlatform(printer);
      const calls = mockSumatraPrint(printer);

      const job = createPdfPrintJob();
      await printer.print(job);

      const [, , , rawPaperSize] = calls[0];
      expect(rawPaperSize).toBe("15x11");

      await printer.shutdown();
    });

    test("passes paperKind in options to SumatraPDF", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        paperKind: 261,
        persistDir: customPersistDir,
      });
      await printer.initialize(eventBus, config);
      enableWindowsPlatform(printer);
      const calls = mockSumatraPrint(printer);

      const job = createPdfPrintJob();
      await printer.print(job);

      // biome-ignore lint/suspicious/noExplicitAny: test assertion on internal options
      const options = calls[0][2] as any;
      expect(options.paperKind).toBe(261);

      await printer.shutdown();
    });

    test("uses getPaperKindFromStorage value over constructor paperKind", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        paperKind: 9,
        persistDir: customPersistDir,
        getPaperKindFromStorage: async () => 261,
      });
      await printer.initialize(eventBus, config);
      enableWindowsPlatform(printer);
      const calls = mockSumatraPrint(printer);

      const job = createPdfPrintJob();
      await printer.print(job);

      // biome-ignore lint/suspicious/noExplicitAny: test assertion on internal options
      const options = calls[0][2] as any;
      expect(options.paperKind).toBe(261);

      await printer.shutdown();
    });

    test("falls back to constructor paperKind when storage returns null", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        paperKind: 9,
        persistDir: customPersistDir,
        getPaperKindFromStorage: async () => null,
      });
      await printer.initialize(eventBus, config);
      enableWindowsPlatform(printer);
      const calls = mockSumatraPrint(printer);

      const job = createPdfPrintJob();
      await printer.print(job);

      // biome-ignore lint/suspicious/noExplicitAny: test assertion on internal options
      const options = calls[0][2] as any;
      expect(options.paperKind).toBe(9);

      await printer.shutdown();
    });

    test("does not set paperKind when both storage and constructor are unset", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        persistDir: customPersistDir,
        getPaperKindFromStorage: async () => null,
      });
      await printer.initialize(eventBus, config);
      enableWindowsPlatform(printer);
      const calls = mockSumatraPrint(printer);

      const job = createPdfPrintJob();
      await printer.print(job);

      // biome-ignore lint/suspicious/noExplicitAny: test assertion on internal options
      const options = calls[0][2] as any;
      expect(options.paperKind).toBeUndefined();

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

  describe("simulate mode", () => {
    const customPersistDir = join(tmpdir(), "log-dot-print-test-simulate");

    beforeEach(async () => {
      await mkdir(customPersistDir, { recursive: true });
    });

    afterEach(async () => {
      await rm(customPersistDir, { recursive: true, force: true });
      delete process.env.PRINTERS_JS_SIMULATE;
    });

    test("skips printing but persists file when simulate is true (config)", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        persistDir: customPersistDir,
        simulate: true,
      });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob("simulate-config-test");
      await printer.print(job);

      // Should NOT call actual printer
      expect(mockNamedPrinter.printFile).not.toHaveBeenCalled();

      // Should persist the file
      expect(job.filePath).toBeDefined();
      expect(job.filePath).toContain(customPersistDir);
      const content = await readFile(job.filePath!, "utf8");
      expect(content).toBe(job.formattedContent);

      await printer.shutdown();
    });

    test("skips SumatraPDF printing but persists file when simulate is true (Windows PDF)", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        persistDir: customPersistDir,
        simulate: true,
      });
      await printer.initialize(eventBus, config);
      enableWindowsPlatform(printer);
      const sumatraCalls = mockSumatraPrint(printer);

      const job: PrintJob = {
        id: "simulate-pdf-test",
        logEntry: {
          id: "simulate-pdf-test",
          timestamp: new Date().toISOString(),
          level: "info",
          source: "test",
          message: "Test",
          printed: false,
        },
        formattedContent: "",
        createdAt: new Date(),
        status: "pending",
        retryCount: 0,
        contentType: "pdf",
        binaryContent: Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]),
      };
      await printer.print(job);

      // Should NOT call SumatraPDF
      expect(sumatraCalls).toHaveLength(0);

      // Should persist the file
      expect(job.filePath).toBeDefined();
      expect(job.filePath).toContain(".pdf");

      await printer.shutdown();
    });

    test("respects PRINTERS_JS_SIMULATE env var", async () => {
      process.env.PRINTERS_JS_SIMULATE = "true";

      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        persistDir: customPersistDir,
      });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob("simulate-env-test");
      await printer.print(job);

      // Should NOT call actual printer
      expect(mockNamedPrinter.printFile).not.toHaveBeenCalled();

      // Should persist the file
      expect(job.filePath).toBeDefined();

      await printer.shutdown();
    });

    test("env var overrides config simulate=false", async () => {
      process.env.PRINTERS_JS_SIMULATE = "true";

      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        persistDir: customPersistDir,
        simulate: false,
      });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob("simulate-env-override-test");
      await printer.print(job);

      expect(mockNamedPrinter.printFile).not.toHaveBeenCalled();
      expect(job.filePath).toBeDefined();

      await printer.shutdown();
    });

    test("prints normally when simulate is false and env not set", async () => {
      const printer = new NativePrinter({
        printerName: "EPSON_PX1VL",
        persistDir: customPersistDir,
        simulate: false,
      });
      await printer.initialize(eventBus, config);

      const job = createTestPrintJob("no-simulate-test");
      await printer.print(job);

      expect(mockNamedPrinter.printFile).toHaveBeenCalledTimes(1);

      await printer.shutdown();
    });
  });
});
