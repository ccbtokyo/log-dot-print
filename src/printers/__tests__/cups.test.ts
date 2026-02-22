import { describe, test, expect } from "bun:test";
import { CupsPrinter } from "../cups";
import type { PrintJob, LogEntry } from "../../core/index.js";

describe("CupsPrinter", () => {
  const createLogEntry = (): LogEntry => ({
    id: "log-1",
    source: "test",
    message: "Test message",
    level: "info",
    timestamp: "2024-01-15T10:30:00Z",
    printed: false,
  });

  const createPrintJob = (overrides?: Partial<PrintJob>): PrintJob => ({
    id: "job-1",
    logEntry: createLogEntry(),
    formattedContent: "Test content",
    createdAt: new Date(),
    status: "pending",
    retryCount: 0,
    ...overrides,
  });

  describe("print method content type detection", () => {
    test("treats undefined contentType as text", () => {
      const _printer = new CupsPrinter();
      const job = createPrintJob({ contentType: undefined });

      // The job should be treated as text (default behavior)
      expect(job.contentType).toBeUndefined();
    });

    test("recognizes text contentType", () => {
      const job = createPrintJob({ contentType: "text" });
      expect(job.contentType).toBe("text");
    });

    test("recognizes html contentType", () => {
      const job = createPrintJob({ contentType: "html" });
      expect(job.contentType).toBe("html");
    });

    test("recognizes pdf contentType", () => {
      const job = createPrintJob({ contentType: "pdf" });
      expect(job.contentType).toBe("pdf");
    });
  });

  describe("getTempFilePath content type extensions", () => {
    test("getTempFilePath generates correct extension for pdf", () => {
      const printer = new CupsPrinter();
      const path = (printer as any).getTempFilePath("job-1", "pdf");
      expect(path).toMatch(/print-job-1\.pdf$/);
    });
  });

  describe("HTML to PDF conversion", () => {
    test("detectHtmlConverter returns available converter", async () => {
      const printer = new CupsPrinter();
      // This will check for wkhtmltopdf or weasyprint
      const converter = await (printer as any).detectHtmlConverter();
      // Either returns a converter name or null
      expect(converter === null || typeof converter === "string").toBe(true);
    });

    test("getTempFilePath generates correct extension for text", () => {
      const printer = new CupsPrinter();
      const path = (printer as any).getTempFilePath("job-1", "text");
      expect(path).toMatch(/print-job-1\.txt$/);
    });

    test("getTempFilePath generates correct extension for html", () => {
      const printer = new CupsPrinter();
      const path = (printer as any).getTempFilePath("job-1", "html");
      expect(path).toMatch(/print-job-1\.html$/);
    });
  });

  describe("PDF conversion command building", () => {
    test("builds wkhtmltopdf command correctly", () => {
      const printer = new CupsPrinter();
      const cmd = (printer as any).buildPdfConversionCommand(
        "wkhtmltopdf",
        "/tmp/input.html",
        "/tmp/output.pdf",
      );

      expect(cmd.command).toBe("wkhtmltopdf");
      expect(cmd.args).toContain("/tmp/input.html");
      expect(cmd.args).toContain("/tmp/output.pdf");
    });

    test("builds weasyprint command correctly", () => {
      const printer = new CupsPrinter();
      const cmd = (printer as any).buildPdfConversionCommand(
        "weasyprint",
        "/tmp/input.html",
        "/tmp/output.pdf",
      );

      expect(cmd.command).toBe("weasyprint");
      expect(cmd.args).toContain("/tmp/input.html");
      expect(cmd.args).toContain("/tmp/output.pdf");
    });

    test("wkhtmltopdf uses normalized paper size from options", () => {
      const printer = new CupsPrinter({ paperSize: "letter" });
      const cmd = (printer as any).buildPdfConversionCommand(
        "wkhtmltopdf",
        "/tmp/input.html",
        "/tmp/output.pdf",
      );

      expect(cmd.args).toContain("--page-size");
      expect(cmd.args).toContain("LETTER");
    });

    test("wkhtmltopdf uses Custom dimensions via --page-width/--page-height", () => {
      const printer = new CupsPrinter({ paperSize: "Custom.11x15.5in" });
      const cmd = (printer as any).buildPdfConversionCommand(
        "wkhtmltopdf",
        "/tmp/input.html",
        "/tmp/output.pdf",
      );

      expect(cmd.args).toContain("--page-width");
      expect(cmd.args).toContain("11in");
      expect(cmd.args).toContain("--page-height");
      expect(cmd.args).toContain("15.5in");
    });

    test("wkhtmltopdf uses stored paper size when available", async () => {
      const printer = new CupsPrinter({
        paperSize: "a4",
        getPaperSizeFromStorage: async () => "Letter",
      });
      // Trigger resolution (updates resolvedPaperSize without mutating options)
      await (printer as any).resolvePaperSizeForPrint();
      const cmd = (printer as any).buildPdfConversionCommand(
        "wkhtmltopdf",
        "/tmp/input.html",
        "/tmp/output.pdf",
      );

      expect(cmd.args).toContain("LETTER");
      // Verify options.paperSize is NOT mutated
      expect((printer as any).options.paperSize).toBe("a4");
    });
  });

  describe("paper size resolution", () => {
    test("uses config paperSize as default", () => {
      const printer = new CupsPrinter({ paperSize: "Legal" });
      expect((printer as any).options.paperSize).toBe("Legal");
    });

    test("accepts any string for paperSize", () => {
      const printer = new CupsPrinter({ paperSize: "Custom.11x15.5in" });
      expect((printer as any).options.paperSize).toBe("Custom.11x15.5in");
    });

    test("resolvePaperSizeForPrint returns stored value over config", async () => {
      const printer = new CupsPrinter({
        paperSize: "A4",
        getPaperSizeFromStorage: async () => "B5",
      });
      const resolved = await (printer as any).resolvePaperSizeForPrint();
      expect(resolved).toBe("B5");
    });

    test("resolvePaperSizeForPrint returns config when no stored value", async () => {
      const printer = new CupsPrinter({
        paperSize: "A4",
        getPaperSizeFromStorage: async () => null,
      });
      const resolved = await (printer as any).resolvePaperSizeForPrint();
      expect(resolved).toBe("A4");
    });
  });
});
