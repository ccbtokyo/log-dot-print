import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { ImageConverter, createImageConverter } from "../image-converter.js";

describe("ImageConverter", () => {
  describe("isAvailable", () => {
    test("should check if playwright is available", async () => {
      const available = await ImageConverter.isAvailable();
      // Will be true if playwright is installed, false otherwise
      expect(typeof available).toBe("boolean");
    });
  });

  describe("createImageConverter", () => {
    test("should return ImageConverter if playwright is available", async () => {
      const converter = await createImageConverter();
      if (converter) {
        expect(converter).toBeInstanceOf(ImageConverter);
        await converter.shutdown();
      } else {
        // playwright not available - skip
        console.log("[Test] playwright not available, skipping");
      }
    });

    test("should apply custom options", async () => {
      const converter = await createImageConverter({
        width: 1000,
        format: "png",
        grayscale: true,
      });
      if (converter) {
        expect(converter).toBeInstanceOf(ImageConverter);
        await converter.shutdown();
      }
    });
  });

  describe("convert", () => {
    let converter: ImageConverter | null = null;

    beforeAll(async () => {
      converter = await createImageConverter({ width: 800 });
      if (converter) {
        await converter.initialize();
      }
    });

    afterAll(async () => {
      if (converter) {
        await converter.shutdown();
      }
    });

    test("should convert simple HTML to PNG", async () => {
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

      // Check PNG magic bytes
      expect(buffer[0]).toBe(0x89);
      expect(buffer[1]).toBe(0x50); // P
      expect(buffer[2]).toBe(0x4e); // N
      expect(buffer[3]).toBe(0x47); // G
    });

    test("should convert styled HTML to PNG", async () => {
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
    });

    test("should use custom width option per conversion", async () => {
      if (!converter) {
        console.log("[Test] playwright not available, skipping");
        return;
      }

      const html = `<!DOCTYPE html>
<html>
<head><title>Test</title></head>
<body><p>Narrow content</p></body>
</html>`;

      const buffer = await converter.convert(html, { width: 400 });

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });
  });

  describe("default options", () => {
    test('should use default width of 2835px (15" paper)', async () => {
      const converter = new ImageConverter();
      // Access private options via any cast for testing
      const options = (converter as any).options;
      expect(options.width).toBe(2835);
      expect(options.format).toBe("png");
      expect(options.grayscale).toBe(false);
    });

    test("should allow overriding default options", async () => {
      const converter = new ImageConverter({
        width: 1000,
        format: "bmp",
        grayscale: true,
      });
      const options = (converter as any).options;
      expect(options.width).toBe(1000);
      expect(options.format).toBe("bmp");
      expect(options.grayscale).toBe(true);
    });
  });
});
