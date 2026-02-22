/**
 * Shared mock for pdf-to-printer module
 * This file should be imported FIRST in test files that need to mock the pdf-to-printer library
 */
import { mock } from "bun:test";

export interface MockPdfPrinter {
  deviceId: string;
  name: string;
  paperSizes: string[];
}

export const mockDefaultPdfPrinter: MockPdfPrinter = {
  deviceId: "Default_PDF_Printer",
  name: "Default PDF Printer",
  paperSizes: ["A4", "Letter"],
};

export const mockNamedPdfPrinter: MockPdfPrinter = {
  deviceId: "EPSON_VP-F4400",
  name: "EPSON VP-F4400",
  paperSizes: ["A4", "Letter", "Custom"],
};

export const mockPdfPrinters: MockPdfPrinter[] = [
  { deviceId: "EPSON_VP-F4400", name: "EPSON VP-F4400", paperSizes: ["A4"] },
  { deviceId: "PDF_Writer", name: "PDF Writer", paperSizes: ["A4", "Letter"] },
];

const defaultGetPrinters = () => Promise.resolve(mockPdfPrinters);
const defaultGetDefaultPrinter = () =>
  Promise.resolve(mockDefaultPdfPrinter as MockPdfPrinter | null);
const defaultPrint = () => Promise.resolve();

export const mockGetPrinters = mock(defaultGetPrinters);
export const mockGetDefaultPrinter = mock(defaultGetDefaultPrinter);
export const mockPrint = mock(defaultPrint);

mock.module("pdf-to-printer", () => ({
  getPrinters: mockGetPrinters,
  getDefaultPrinter: mockGetDefaultPrinter,
  print: mockPrint,
}));

export function resetPdfToPrinterMocks() {
  mockGetPrinters.mockClear();
  mockGetDefaultPrinter.mockClear();
  mockPrint.mockClear();

  mockGetPrinters.mockImplementation(defaultGetPrinters);
  mockGetDefaultPrinter.mockImplementation(defaultGetDefaultPrinter);
  mockPrint.mockImplementation(defaultPrint);
}
