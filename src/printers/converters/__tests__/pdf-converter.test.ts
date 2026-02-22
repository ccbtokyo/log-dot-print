import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { PdfConverter, createPdfConverter, cssUnitToPixels } from "../pdf-converter.js";

describe("PdfConverter", () => {
  describe("isAvailable", () => {
    test("should check if playwright is available", async () => {
      const available = await PdfConverter.isAvailable();
      expect(typeof available).toBe("boolean");
    });
  });

  describe("createPdfConverter", () => {
    test("should return PdfConverter if playwright is available", async () => {
      const converter = await createPdfConverter();
      if (converter) {
        expect(converter).toBeInstanceOf(PdfConverter);
        await converter.shutdown();
      } else {
        console.log("[Test] playwright not available, skipping");
      }
    });
  });

  describe("convert", () => {
    let converter: PdfConverter | null = null;

    beforeAll(async () => {
      converter = await createPdfConverter();
      if (converter) {
        await converter.initialize();
      }
    });

    afterAll(async () => {
      if (converter) {
        await converter.shutdown();
      }
    });

    test("should convert simple HTML to PDF", async () => {
      if (!converter) {
        console.log("[Test] playwright not available, skipping");
        return;
      }

      const html = `<!DOCTYPE html>
<html>
<head><title>Test</title></head>
<body><h1>Hello World</h1></body>
</html>`;

      const buffer = await converter.convert(html);

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);

      // Check PDF magic bytes: %PDF
      expect(buffer[0]).toBe(0x25); // %
      expect(buffer[1]).toBe(0x50); // P
      expect(buffer[2]).toBe(0x44); // D
      expect(buffer[3]).toBe(0x46); // F
    });

    test("should convert styled HTML with @font-face to PDF", async () => {
      if (!converter) {
        console.log("[Test] playwright not available, skipping");
        return;
      }

      const html = `<!DOCTYPE html>
<html>
<head>
  <style>
    body { background: #fff; font-family: sans-serif; }
    .message { padding: 10px; margin: 10px; background: #f0f0f0; }
  </style>
</head>
<body>
  <div class="message">Test message 1</div>
  <div class="message">Test message 2</div>
</body>
</html>`;

      const buffer = await converter.convert(html);

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);

      // Verify PDF magic bytes
      const header = buffer.subarray(0, 4).toString("ascii");
      expect(header).toBe("%PDF");
    });

    test("should respect @page CSS over default paperSize", async () => {
      if (!converter) {
        console.log("[Test] playwright not available, skipping");
        return;
      }

      // HTML with @page CSS specifying Letter size
      const html = `<!DOCTYPE html>
<html>
<head>
  <style>
    @page { size: Letter; }
  </style>
</head>
<body><p>CSS page size test</p></body>
</html>`;

      // Default paperSize is A4, but @page CSS should take priority
      const buffer = await converter.convert(html);

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);

      // Verify PDF magic bytes
      const header = buffer.subarray(0, 4).toString("ascii");
      expect(header).toBe("%PDF");
    });

    test("should respect paperSize option", async () => {
      if (!converter) {
        console.log("[Test] playwright not available, skipping");
        return;
      }

      const html = `<!DOCTYPE html>
<html>
<head><title>Test</title></head>
<body><p>Paper size test</p></body>
</html>`;

      const buffer = await converter.convert(html, { paperSize: "A4" });

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });

    test("should generate PDF with cropToContent option", async () => {
      if (!converter) {
        console.log("[Test] playwright not available, skipping");
        return;
      }

      const html = `<!DOCTYPE html>
<html>
<head>
  <style>
    @page { size: 15in 11in; margin: 10mm; }
    body { margin: 0; padding: 20px; }
  </style>
</head>
<body><p>Short content</p></body>
</html>`;

      const buffer = await converter.convert(html, {
        paperSize: "Custom.15x11in",
        cropToContent: true,
      });

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);

      // Verify PDF magic bytes
      const header = buffer.subarray(0, 4).toString("ascii");
      expect(header).toBe("%PDF");
    });

    test("cropped PDF height should match content dynamically", async () => {
      if (!converter) {
        console.log("[Test] playwright not available, skipping");
        return;
      }

      const html = `<!DOCTYPE html>
<html>
<head>
  <style>
    @page { size: 15in 11in; margin: 10mm; }
    body { margin: 0; padding: 20px; }
  </style>
</head>
<body><p>Short content</p></body>
</html>`;

      const buffer = await converter.convert(html, {
        paperSize: "Custom.15x11in",
        cropToContent: true,
      });

      // Extract MediaBox from PDF to verify page dimensions
      // MediaBox is in PDF points (1 point = 1/72 inch)
      // 15in = 1080pt
      const pdfText = buffer.toString("latin1");
      const mediaBoxMatch = pdfText.match(
        /\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/,
      );

      expect(mediaBoxMatch).not.toBeNull();
      if (mediaBoxMatch) {
        const pageWidth = parseFloat(mediaBoxMatch[3]);
        const pageHeight = parseFloat(mediaBoxMatch[4]);

        // Width should be approximately 15in = 1080pt
        expect(pageWidth).toBeCloseTo(1080, -1);

        // Height should be dynamic (less than the original 11in = 792pt for short content)
        expect(pageHeight).toBeLessThan(792);
        expect(pageHeight).toBeGreaterThan(0);
      }
    });

    test("should generate content-fit PDF with dynamic height", async () => {
      if (!converter) {
        console.log("[Test] playwright not available, skipping");
        return;
      }

      const html = `<!DOCTYPE html>
<html>
<head>
  <style>
    @page { size: 15in 11in; margin: 0; }
    body { margin: 0; padding: 20px; }
  </style>
</head>
<body><p>Short content for content-fit</p></body>
</html>`;

      const buffer = await converter.convert(html, {
        contentFit: { widthIn: 15, maxHeightIn: 11 },
      });

      expect(buffer).toBeInstanceOf(Buffer);
      const header = buffer.subarray(0, 4).toString("ascii");
      expect(header).toBe("%PDF");

      // Extract MediaBox to verify dynamic height
      const pdfText = buffer.toString("latin1");
      const mediaBoxMatch = pdfText.match(
        /\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/,
      );

      expect(mediaBoxMatch).not.toBeNull();
      if (mediaBoxMatch) {
        const pageWidth = parseFloat(mediaBoxMatch[3]);
        const pageHeight = parseFloat(mediaBoxMatch[4]);

        // Width: 15in = 1080pt
        expect(pageWidth).toBeCloseTo(1080, -1);

        // Height should be dynamic (less than 11in = 792pt for short content)
        expect(pageHeight).toBeLessThan(792);
        expect(pageHeight).toBeGreaterThan(0);
      }
    });

    test("content-fit PDF height should be clamped to maxHeightIn", async () => {
      if (!converter) {
        console.log("[Test] playwright not available, skipping");
        return;
      }

      // Generate tall content that would exceed maxHeightIn
      const tallContent = Array.from({ length: 200 }, (_, i) => `<p>Line ${i + 1}</p>`).join("\n");
      const html = `<!DOCTYPE html>
<html>
<head>
  <style>
    @page { size: 15in 11in; margin: 0; }
    body { margin: 0; padding: 20px; font-size: 16px; }
  </style>
</head>
<body>${tallContent}</body>
</html>`;

      const maxHeightIn = 5;
      const buffer = await converter.convert(html, {
        contentFit: { widthIn: 15, maxHeightIn },
      });

      expect(buffer).toBeInstanceOf(Buffer);

      const pdfText = buffer.toString("latin1");
      const mediaBoxMatch = pdfText.match(
        /\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/,
      );

      expect(mediaBoxMatch).not.toBeNull();
      if (mediaBoxMatch) {
        const pageHeight = parseFloat(mediaBoxMatch[4]);
        // Height should be clamped to maxHeightIn (5in = 360pt)
        expect(pageHeight).toBeCloseTo(360, -1);
      }
    });
  });

  describe("cssUnitToPixels", () => {
    test("converts inches to pixels at 96 DPI", () => {
      expect(cssUnitToPixels(1, "in")).toBe(96);
      expect(cssUnitToPixels(15, "in")).toBe(1440);
    });

    test("converts mm to pixels at 96 DPI", () => {
      expect(cssUnitToPixels(25.4, "mm")).toBeCloseTo(96, 5);
      expect(cssUnitToPixels(210, "mm")).toBeCloseTo(793.7, 0);
    });

    test("returns 0 for zero input", () => {
      expect(cssUnitToPixels(0, "in")).toBe(0);
      expect(cssUnitToPixels(0, "mm")).toBe(0);
    });
  });

  describe("default options", () => {
    test("should use default paper size of A4", () => {
      const converter = new PdfConverter();
      const options = (converter as any).options;
      expect(options.paperSize).toBe("A4");
    });

    test("should allow overriding paper size", () => {
      const converter = new PdfConverter({ paperSize: "Letter" });
      const options = (converter as any).options;
      expect(options.paperSize).toBe("Letter");
    });
  });
});
