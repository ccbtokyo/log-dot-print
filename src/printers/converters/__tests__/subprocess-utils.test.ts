import { describe, test, expect } from "bun:test";
import { sep, dirname } from "node:path";
import { isWindows, getHelperScriptPath, isNodeAvailable } from "../subprocess-utils.js";

describe("subprocess-utils", () => {
  describe("isWindows", () => {
    test("should return a boolean", () => {
      expect(typeof isWindows()).toBe("boolean");
    });

    test("should return true only on win32 platform", () => {
      expect(isWindows()).toBe(process.platform === "win32");
    });
  });

  describe("getHelperScriptPath", () => {
    test("should return path for image helper", () => {
      const path = getHelperScriptPath("image");
      expect(path).toContain(`scripts${sep}playwright-render.cjs`);
      // Should be an absolute path
      expect(path).toMatch(sep === "\\" ? /^[A-Z]:\\/ : /^\//);
    });

    test("should return path for pdf helper", () => {
      const path = getHelperScriptPath("pdf");
      expect(path).toContain(`scripts${sep}playwright-render-pdf.cjs`);
      expect(path).toMatch(sep === "\\" ? /^[A-Z]:\\/ : /^\//);
    });

    test("image and pdf paths should share the same scripts directory", () => {
      const imagePath = getHelperScriptPath("image");
      const pdfPath = getHelperScriptPath("pdf");
      expect(dirname(imagePath)).toBe(dirname(pdfPath));
    });
  });

  describe("isNodeAvailable", () => {
    test("should return a boolean", async () => {
      const result = await isNodeAvailable();
      expect(typeof result).toBe("boolean");
    });

    test("should return true when node is installed", async () => {
      // In CI / dev environments, Node.js should be available
      const result = await isNodeAvailable();
      expect(result).toBe(true);
    });
  });
});
