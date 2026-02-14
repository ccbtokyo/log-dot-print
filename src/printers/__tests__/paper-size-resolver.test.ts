import { describe, test, expect } from "bun:test";
import {
  resolvePaperSize,
  normalizePaperName,
  paperNameToCssPageSize,
} from "../paper-size-resolver.js";

describe("resolvePaperSize", () => {
  test("returns configPdfPaperSize when set", () => {
    expect(
      resolvePaperSize({
        configPdfPaperSize: "A4",
        storedPrinterPaperSize: "Letter",
      }),
    ).toBe("A4");
  });

  test("returns storedPrinterPaperSize when configPdfPaperSize is not set", () => {
    expect(
      resolvePaperSize({
        storedPrinterPaperSize: "Letter",
      }),
    ).toBe("Letter");
  });

  test("returns undefined when both are not set", () => {
    expect(resolvePaperSize({})).toBeUndefined();
  });

  test("skips null stored value and returns undefined", () => {
    expect(
      resolvePaperSize({
        storedPrinterPaperSize: null,
      }),
    ).toBeUndefined();
  });

  test("configPdfPaperSize takes priority over stored even when stored is valid", () => {
    expect(
      resolvePaperSize({
        configPdfPaperSize: "B5",
        storedPrinterPaperSize: "A4",
      }),
    ).toBe("B5");
  });
});

describe("normalizePaperName", () => {
  test("normalizes standard size names to canonical form", () => {
    expect(normalizePaperName("a4")).toBe("A4");
    expect(normalizePaperName("A4")).toBe("A4");
    expect(normalizePaperName("letter")).toBe("Letter");
    expect(normalizePaperName("LETTER")).toBe("Letter");
    expect(normalizePaperName("legal")).toBe("Legal");
    expect(normalizePaperName("a3")).toBe("A3");
    expect(normalizePaperName("a5")).toBe("A5");
    expect(normalizePaperName("b4")).toBe("B4");
    expect(normalizePaperName("b5")).toBe("B5");
    expect(normalizePaperName("tabloid")).toBe("Tabloid");
    expect(normalizePaperName("executive")).toBe("Executive");
    expect(normalizePaperName("folio")).toBe("Folio");
    expect(normalizePaperName("invoice")).toBe("Invoice");
  });

  test("passes through Custom format with inches", () => {
    expect(normalizePaperName("Custom.11x15in")).toBe("Custom.11x15in");
    expect(normalizePaperName("Custom.11x15.5in")).toBe("Custom.11x15.5in");
  });

  test("passes through Custom format with mm", () => {
    expect(normalizePaperName("Custom.210x297mm")).toBe("Custom.210x297mm");
  });

  test("returns null for empty string", () => {
    expect(normalizePaperName("")).toBeNull();
  });

  test("returns null for whitespace-only string", () => {
    expect(normalizePaperName("   ")).toBeNull();
  });

  test("normalizes extended ISO A series", () => {
    expect(normalizePaperName("a0")).toBe("A0");
    expect(normalizePaperName("a1")).toBe("A1");
    expect(normalizePaperName("a2")).toBe("A2");
    expect(normalizePaperName("a6")).toBe("A6");
    expect(normalizePaperName("a7")).toBe("A7");
    expect(normalizePaperName("a8")).toBe("A8");
    expect(normalizePaperName("a9")).toBe("A9");
    expect(normalizePaperName("a10")).toBe("A10");
  });

  test("normalizes extended ISO B series", () => {
    expect(normalizePaperName("b0")).toBe("B0");
    expect(normalizePaperName("b1")).toBe("B1");
    expect(normalizePaperName("b2")).toBe("B2");
    expect(normalizePaperName("b3")).toBe("B3");
    expect(normalizePaperName("b6")).toBe("B6");
    expect(normalizePaperName("b7")).toBe("B7");
  });

  test("normalizes ISO C series", () => {
    expect(normalizePaperName("c0")).toBe("C0");
    expect(normalizePaperName("c5")).toBe("C5");
  });

  test("accepts CUPS Custom.WIDTHxHEIGHT placeholder", () => {
    expect(normalizePaperName("Custom.WIDTHxHEIGHT")).toBe("Custom.WIDTHxHEIGHT");
  });

  test("returns null for invalid format", () => {
    expect(normalizePaperName("FooBar")).toBeNull();
    expect(normalizePaperName("Custom.abc")).toBeNull();
    expect(normalizePaperName("Custom.")).toBeNull();
  });
});

describe("paperNameToCssPageSize", () => {
  test("returns standard name as-is for CSS", () => {
    expect(paperNameToCssPageSize("A4")).toBe("A4");
    expect(paperNameToCssPageSize("Letter")).toBe("Letter");
    expect(paperNameToCssPageSize("Legal")).toBe("Legal");
    expect(paperNameToCssPageSize("Tabloid")).toBe("Tabloid");
  });

  test("converts Custom inch format to CSS dimensions", () => {
    expect(paperNameToCssPageSize("Custom.11x15in")).toBe("11in 15in");
    expect(paperNameToCssPageSize("Custom.11x15.5in")).toBe("11in 15.5in");
    expect(paperNameToCssPageSize("Custom.8.5x11in")).toBe("8.5in 11in");
  });

  test("converts Custom mm format to CSS dimensions", () => {
    expect(paperNameToCssPageSize("Custom.210x297mm")).toBe("210mm 297mm");
    expect(paperNameToCssPageSize("Custom.80x200mm")).toBe("80mm 200mm");
  });
});
