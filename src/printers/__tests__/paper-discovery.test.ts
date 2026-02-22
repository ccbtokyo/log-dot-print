import { describe, test, expect, beforeEach } from "bun:test";
import { getAvailablePaperSizes, FALLBACK_PAPER_SIZES } from "../paper-discovery.js";
import type { PaperSizeInfo } from "../../core/types.js";

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

  describe("parseWindowsPaperSizesOutput", () => {
    let parseWindowsPaperSizesOutput: (output: string) => PaperSizeInfo[];

    beforeEach(async () => {
      const mod = await import("../paper-discovery.js");
      parseWindowsPaperSizesOutput = mod.parseWindowsPaperSizesOutput;
    });

    test("parses JSON array with PaperName and RawKind", () => {
      const output = JSON.stringify([
        { PaperName: "A4", RawKind: 9 },
        { PaperName: "Letter", RawKind: 1 },
        { PaperName: "15x11", RawKind: 261 },
      ]);
      const result = parseWindowsPaperSizesOutput(output);
      expect(result).toEqual([
        { name: "A4", rawKind: 9 },
        { name: "Letter", rawKind: 1 },
        { name: "15x11", rawKind: 261 },
      ]);
    });

    test("parses single object (non-array) when only one paper size", () => {
      const output = JSON.stringify({ PaperName: "A4", RawKind: 9 });
      const result = parseWindowsPaperSizesOutput(output);
      expect(result).toEqual([{ name: "A4", rawKind: 9 }]);
    });

    test("handles missing RawKind as null", () => {
      const output = JSON.stringify([{ PaperName: "Custom" }]);
      const result = parseWindowsPaperSizesOutput(output);
      expect(result).toEqual([{ name: "Custom", rawKind: null }]);
    });

    test("handles missing PaperName as empty string", () => {
      const output = JSON.stringify([{ RawKind: 9 }]);
      const result = parseWindowsPaperSizesOutput(output);
      expect(result).toEqual([{ name: "", rawKind: 9 }]);
    });

    test("handles non-numeric RawKind as null", () => {
      const output = JSON.stringify([{ PaperName: "A4", RawKind: "invalid" }]);
      const result = parseWindowsPaperSizesOutput(output);
      expect(result).toEqual([{ name: "A4", rawKind: null }]);
    });

    test("returns empty array for invalid JSON", () => {
      const result = parseWindowsPaperSizesOutput("not json");
      expect(result).toEqual([]);
    });

    test("returns empty array for empty string", () => {
      const result = parseWindowsPaperSizesOutput("");
      expect(result).toEqual([]);
    });

    test("returns empty array for empty JSON array", () => {
      const result = parseWindowsPaperSizesOutput("[]");
      expect(result).toEqual([]);
    });

    test("filters entries with invalid PaperName type", () => {
      const output = JSON.stringify([
        { PaperName: "A4", RawKind: 9 },
        { PaperName: 123, RawKind: 5 },
      ]);
      const result = parseWindowsPaperSizesOutput(output);
      // Non-string PaperName converted to empty string
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ name: "A4", rawKind: 9 });
      expect(result[1]).toEqual({ name: "", rawKind: 5 });
    });
  });

  describe("getAvailablePaperSizes - paperSizeDetails", () => {
    test("returns paperSizeDetails in result", async () => {
      const result = await getAvailablePaperSizes(null);
      expect(result.paperSizeDetails).toBeDefined();
      expect(Array.isArray(result.paperSizeDetails)).toBe(true);
      expect(result.paperSizeDetails.length).toBe(result.paperSizes.length);
    });

    test("paperSizeDetails names match paperSizes", async () => {
      const result = await getAvailablePaperSizes(null);
      const detailNames = result.paperSizeDetails.map((d) => d.name);
      expect(detailNames).toEqual(result.paperSizes);
    });

    test("fallback paperSizeDetails have rawKind null", async () => {
      // On non-Windows, if fallback is used, rawKind should be null
      const result = await getAvailablePaperSizes("NonExistentPrinter12345");
      if (result.source === "fallback") {
        for (const detail of result.paperSizeDetails) {
          expect(detail.rawKind).toBeNull();
        }
      }
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
