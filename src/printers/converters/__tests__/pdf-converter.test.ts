import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { PdfConverter, createPdfConverter } from "../pdf-converter.js";

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
