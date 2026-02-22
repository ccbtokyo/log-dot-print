import { describe, test, expect, beforeEach } from "bun:test";
import { getAvailablePaperSizes, FALLBACK_PAPER_SIZES } from "../paper-discovery.js";

/**
 * Tests for paper-discovery service
 * @see plans/paper-settings.md for feature specification
 * @related src/printers/paper-discovery.ts - getAvailablePaperSizes
 */
describe("paper-discovery", () => {
  describe("getAvailablePaperSizes", () => {
    test("returns paper sizes with valid source and printerName=null", async () => {
      const result = await getAvailablePaperSizes(null);
      // source depends on OS: "dynamic" on macOS/Linux with CUPS, "fallback" otherwise
      expect(["dynamic", "fallback"]).toContain(result.source);
      expect(result.paperSizes.length).toBeGreaterThan(0);
      expect(result.printerName).toBeNull();
    });

    test("includes continuous paper sizes in fallback list", () => {
      expect(FALLBACK_PAPER_SIZES).toContain("Custom.11x15.5in");
      expect(FALLBACK_PAPER_SIZES).toContain("Custom.11x15in");
      expect(FALLBACK_PAPER_SIZES).toContain("Custom.15x11in");
    });

    test("includes standard paper sizes in fallback list", () => {
      expect(FALLBACK_PAPER_SIZES).toContain("A4");
      expect(FALLBACK_PAPER_SIZES).toContain("A3");
      expect(FALLBACK_PAPER_SIZES).toContain("Letter");
      expect(FALLBACK_PAPER_SIZES).toContain("Legal");
      expect(FALLBACK_PAPER_SIZES).toContain("Tabloid");
    });

    test("returns printerName in result when provided", async () => {
      const result = await getAvailablePaperSizes("EPSON_VP-F4400");
      expect(result.printerName).toBe("EPSON_VP-F4400");
    });

    test("returns printerName as null when not provided", async () => {
      const result = await getAvailablePaperSizes();
      expect(result.printerName).toBeNull();
    });
  });

  describe("buildSafePsWmiFilter", () => {
    let buildSafePsWmiFilter: (property: string, value: string) => string;

    beforeEach(async () => {
      const mod = await import("../paper-discovery.js");
      buildSafePsWmiFilter = mod.buildSafePsWmiFilter;
    });

    test("builds filter for simple printer name", () => {
      const result = buildSafePsWmiFilter("Name", "EPSON");
      // PowerShell single-quoted: Name=''EPSON''
      expect(result).toBe("Name=''EPSON''");
    });

    test("escapes single quotes in printer name for WMI and PowerShell", () => {
      const result = buildSafePsWmiFilter("Name", "O'Brien");
      // WMI: Name='O''Brien' → PS single-quote escape: Name=''O''''Brien''
      expect(result).toBe("Name=''O''''Brien''");
    });

    test("does not expand PowerShell variables in printer name", () => {
      const result = buildSafePsWmiFilter("Name", "Printer$(evil)");
      // The $() should be preserved as literal text (no expansion in PS single quotes)
      expect(result).toBe("Name=''Printer$(evil)''");
    });

    test("does not interpret PowerShell backtick in printer name", () => {
      const result = buildSafePsWmiFilter("Name", "Printer`nTest");
      expect(result).toBe("Name=''Printer`nTest''");
    });
  });

  describe("parsePowerShellOutput", () => {
    let parsePowerShellOutput: (output: string) => string[];

    beforeEach(async () => {
      const mod = await import("../paper-discovery.js");
      parsePowerShellOutput = mod.parsePowerShellOutput;
    });

    test("parses multiple lines of paper names", () => {
      const output = "A4\nLetter\nLegal\nB5";
      const result = parsePowerShellOutput(output);
      expect(result).toEqual(["A4", "Letter", "Legal", "B5"]);
    });

    test("filters empty lines", () => {
      const output = "A4\n\nLetter\n\n\nLegal\n";
      const result = parsePowerShellOutput(output);
      expect(result).toEqual(["A4", "Letter", "Legal"]);
    });

    test("returns empty array for empty string", () => {
      const result = parsePowerShellOutput("");
      expect(result).toEqual([]);
    });

    test("trims leading and trailing whitespace from each line", () => {
      const output = "  A4  \n  Letter \n\tLegal\t";
      const result = parsePowerShellOutput(output);
      expect(result).toEqual(["A4", "Letter", "Legal"]);
    });

    test("handles CRLF line endings", () => {
      const output = "A4\r\nLetter\r\nLegal\r\n";
      const result = parsePowerShellOutput(output);
      expect(result).toEqual(["A4", "Letter", "Legal"]);
    });
  });

  describe("parseLpoptionsOutput", () => {
    // Imported separately for unit testing the parser
    let parseLpoptionsOutput: (output: string) => string[];

    beforeEach(async () => {
      const mod = await import("../paper-discovery.js");
      parseLpoptionsOutput = mod.parseLpoptionsOutput;
    });

    test("parses PageSize line with multiple sizes", () => {
      const output =
        "PageSize/Media Size: Custom.WIDTHxHEIGHT *A4 A3 A5 B4 B5 Letter Legal Tabloid";
      const result = parseLpoptionsOutput(output);
      expect(result).toContain("A4");
      expect(result).toContain("A3");
      expect(result).toContain("Letter");
      expect(result).toContain("Custom.WIDTHxHEIGHT");
    });

    test("strips asterisk from default selection", () => {
      const output = "PageSize/Media Size: *A4 Letter Legal";
      const result = parseLpoptionsOutput(output);
      expect(result).toContain("A4");
      expect(result).not.toContain("*A4");
    });

    test("returns empty array when no PageSize line found", () => {
      const output = "Resolution/Output Resolution: 300dpi *600dpi 1200dpi";
      const result = parseLpoptionsOutput(output);
      expect(result).toEqual([]);
    });

    test("handles empty output", () => {
      const result = parseLpoptionsOutput("");
      expect(result).toEqual([]);
    });

    test("filters empty tokens", () => {
      const output = "PageSize/Media Size:  A4   Letter  ";
      const result = parseLpoptionsOutput(output);
      expect(result).toEqual(["A4", "Letter"]);
    });
  });
});
