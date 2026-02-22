/**
 * Paper size resolution and normalization utilities.
 * Resolves paper size from multiple sources with a defined priority order.
 *
 * @related src/printers/paper-discovery.ts - FALLBACK_PAPER_SIZES list
 * @related src/printers/html-formatter.ts - CSS @page size consumer
 * @related src/printers/replay-formatter.ts - CSS @page size consumer
 * @related src/printers/cups.ts - wkhtmltopdf/lp paper size consumer
 * @related src/printers/native.ts - native driver paper size consumer
 */

/** Canonical standard paper size names (case-sensitive). */
const STANDARD_PAPER_SIZES: readonly string[] = [
  "A4",
  "A3",
  "A5",
  "B4",
  "B5",
  "Letter",
  "Legal",
  "Tabloid",
  "Executive",
  "Folio",
  "Invoice",
];

/** Lowercase → canonical mapping for fast lookup. */
const STANDARD_PAPER_MAP = new Map<string, string>(
  STANDARD_PAPER_SIZES.map((name) => [name.toLowerCase(), name]),
);

/**
 * Regex for Custom paper size format: `Custom.<W>x<H>in` or `Custom.<W>x<H>mm`.
 * Captures: width, height, unit.
 */
const CUSTOM_RE = /^Custom\.(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(in|mm)$/;

/**
 * Resolve paper size from multiple sources with priority:
 *  1. configPdfPaperSize (explicit config, highest priority)
 *  2. storedPrinterPaperSize (saved setting)
 *  3. undefined (caller falls back to existing behavior)
 */
export function resolvePaperSize(options: {
  configPdfPaperSize?: string;
  storedPrinterPaperSize?: string | null;
}): string | undefined {
  if (options.configPdfPaperSize) {
    return options.configPdfPaperSize;
  }
  if (options.storedPrinterPaperSize) {
    return options.storedPrinterPaperSize;
  }
  return undefined;
}

/**
 * Normalize and validate a paper size name.
 * - Standard sizes: case-insensitive → canonical form ("a4" → "A4")
 * - Custom format: `Custom.<W>x<H>in` or `Custom.<W>x<H>mm` → passed through
 * - Invalid / empty → null (with console.warn)
 */
export function normalizePaperName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return null;
  }

  // Check standard sizes (case-insensitive)
  const canonical = STANDARD_PAPER_MAP.get(trimmed.toLowerCase());
  if (canonical) {
    return canonical;
  }

  // Check ISO A/B/C series (e.g. A0-A10, B0-B10, C0-C10)
  const isoMatch = /^([abc])(\d{1,2})$/i.exec(trimmed);
  if (isoMatch) {
    const [, letter, num] = isoMatch;
    return `${letter.toUpperCase()}${num}`;
  }

  // Check Custom format with dimensions
  if (CUSTOM_RE.test(trimmed)) {
    return trimmed;
  }

  // Accept CUPS Custom placeholder format (e.g. "Custom.WIDTHxHEIGHT")
  if (/^Custom\.\w+x\w+$/.test(trimmed)) {
    return trimmed;
  }

  console.warn(`[PaperSize] Invalid paper size name: "${trimmed}"`);
  return null;
}

/**
 * Parsed dimensions from a Custom paper size.
 */
export interface PaperDimensions {
  width: number;
  height: number;
  unit: "in" | "mm";
}

/**
 * Parse a Custom paper size name into width, height, and unit.
 * Returns null for standard sizes or invalid formats.
 *
 * @example parsePaperDimensions("Custom.15x11in") → { width: 15, height: 11, unit: "in" }
 */
export function parsePaperDimensions(name: string): PaperDimensions | null {
  const match = CUSTOM_RE.exec(name);
  if (!match) return null;
  const [, width, height, unit] = match;
  return {
    width: parseFloat(width),
    height: parseFloat(height),
    unit: unit as "in" | "mm",
  };
}

/**
 * Convert a paper size name for SumatraPDF's `-print-settings paper=` option.
 * SumatraPDF only accepts standard paper names (A4, Letter, etc.).
 * Custom dimensions (Custom.WxH{in|mm}) are NOT supported and return null,
 * letting the printer driver's default paper setting take effect.
 */
export function paperSizeForSumatraPDF(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("Custom.")) {
    return null;
  }
  return trimmed;
}

/**
 * Convert a paper size name to a CSS `@page { size: ... }` value.
 * - Standard names → returned as-is (browsers/weasyprint understand them)
 * - Custom.WxHin → "Win Hin" (e.g. "11in 15.5in")
 * - Custom.WxHmm → "Wmm Hmm" (e.g. "210mm 297mm")
 */
export function paperNameToCssPageSize(name: string): string {
  const match = CUSTOM_RE.exec(name);
  if (match) {
    const [, width, height, unit] = match;
    return `${width}${unit} ${height}${unit}`;
  }
  return name;
}
