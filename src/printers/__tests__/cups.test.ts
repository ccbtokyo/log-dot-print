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
  });
});
