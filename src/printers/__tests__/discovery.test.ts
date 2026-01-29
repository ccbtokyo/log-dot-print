// Import shared mock FIRST - this sets up the module mock
import { mockGetDefaultPrinter, mockPrinterExists, resetPrinterMocks } from "./printers-mock.js";

import { describe, test, expect, beforeEach } from "bun:test";
import { PrinterDiscoveryService, printerDiscovery } from "../discovery.js";

describe("PrinterDiscoveryService", () => {
  beforeEach(() => {
    resetPrinterMocks();
  });

  describe("listPrinters", () => {
    test("returns all printers with correct properties", async () => {
      const service = new PrinterDiscoveryService();
      const printers = await service.listPrinters();

      expect(printers).toHaveLength(3);
      expect(printers[0]).toEqual({
        name: "EPSON_PX1VL",
        isDefault: false,
        status: "idle",
        ready: true,
        description: undefined,
      });
    });

    test("marks default printer correctly", async () => {
      const service = new PrinterDiscoveryService();
      const printers = await service.listPrinters();

      // Default printer is "Default_Printer" from mock, not in mockPrinters list
      const defaultPrinter = printers.find((p) => p.isDefault);
      expect(defaultPrinter).toBeUndefined();

      // All printers from mockPrinters are non-default
      const nonDefaultPrinters = printers.filter((p) => !p.isDefault);
      expect(nonDefaultPrinters).toHaveLength(3);
    });

    test("maps error state correctly", async () => {
      const service = new PrinterDiscoveryService();
      const printers = await service.listPrinters();

      const errorPrinter = printers.find((p) => p.name === "Broken_Printer");
      expect(errorPrinter?.status).toBe("error");
      expect(errorPrinter?.ready).toBe(false);
    });
  });

  describe("getDefaultPrinter", () => {
    test("returns the default printer", async () => {
      const service = new PrinterDiscoveryService();
      const printer = await service.getDefaultPrinter();

      expect(printer).not.toBeNull();
      expect(printer?.name).toBe("Default_Printer");
      expect(printer?.isDefault).toBe(true);
    });

    test("returns null when no default printer", async () => {
      mockGetDefaultPrinter.mockImplementationOnce(() => Promise.resolve(null));

      const service = new PrinterDiscoveryService();
      const printer = await service.getDefaultPrinter();

      expect(printer).toBeNull();
    });
  });

  describe("printerExists", () => {
    test("returns true for existing printer", async () => {
      const service = new PrinterDiscoveryService();
      const exists = await service.printerExists("EPSON_PX1VL");

      expect(exists).toBe(true);
    });

    test("returns false for non-existing printer", async () => {
      mockPrinterExists.mockImplementationOnce(() => Promise.resolve(false));

      const service = new PrinterDiscoveryService();
      const exists = await service.printerExists("NonExistent");

      expect(exists).toBe(false);
    });
  });

  describe("singleton instance", () => {
    test("printerDiscovery is an instance of PrinterDiscoveryService", () => {
      expect(printerDiscovery).toBeInstanceOf(PrinterDiscoveryService);
    });
  });
});
