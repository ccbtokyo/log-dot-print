/**
 * Shared mock for @printers/printers module
 * This file should be imported FIRST in test files that need to mock the printers library
 */
import { mock } from "bun:test";

// Define mock printer type
export interface MockPrinter {
  name: string;
  state: string;
  description?: string;
  printFile: ReturnType<typeof mock>;
}

// Mock printer objects
export const mockDefaultPrinter: MockPrinter = {
  name: "Default_Printer",
  state: "idle",
  printFile: mock(() => Promise.resolve(12345)),
};

export const mockNamedPrinter: MockPrinter = {
  name: "EPSON_PX1VL",
  state: "idle",
  printFile: mock(() => Promise.resolve(12346)),
};

export const mockPrinters: MockPrinter[] = [
  { name: "EPSON_PX1VL", state: "idle", printFile: mock(() => Promise.resolve(1)) },
  { name: "PDF_Printer", state: "idle", printFile: mock(() => Promise.resolve(2)) },
  { name: "Broken_Printer", state: "error", printFile: mock(() => Promise.resolve(3)) },
];

// Default implementations
const defaultGetAllPrinters = () => Promise.resolve(mockPrinters);
const defaultGetDefaultPrinter = () => Promise.resolve(mockDefaultPrinter as MockPrinter | null);
const defaultPrinterExists = (name: string) =>
  Promise.resolve(
    mockPrinters.some((p) => p.name === name) ||
      name === "Default_Printer" ||
      name === "EPSON_PX1VL",
  );
const defaultGetPrinterByName = (name: string) => {
  if (name === "EPSON_PX1VL") return mockNamedPrinter;
  if (name === "Default_Printer") return mockDefaultPrinter;
  const found = mockPrinters.find((p) => p.name === name);
  return found ?? null;
};

// Create mock functions
export const mockGetAllPrinters = mock(defaultGetAllPrinters);
export const mockGetDefaultPrinter = mock(defaultGetDefaultPrinter);
export const mockPrinterExists = mock(defaultPrinterExists);
export const mockGetPrinterByName = mock(defaultGetPrinterByName);

// Apply the module mock
mock.module("@printers/printers", () => ({
  getAllPrinters: mockGetAllPrinters,
  getDefaultPrinter: mockGetDefaultPrinter,
  printerExists: mockPrinterExists,
  getPrinterByName: mockGetPrinterByName,
}));

// Helper to reset all mocks to default behavior
export function resetPrinterMocks() {
  // Reset mock state
  mockGetAllPrinters.mockClear();
  mockGetDefaultPrinter.mockClear();
  mockPrinterExists.mockClear();
  mockGetPrinterByName.mockClear();
  mockDefaultPrinter.printFile.mockClear();
  mockNamedPrinter.printFile.mockClear();

  // Reset implementations to default
  mockGetAllPrinters.mockImplementation(defaultGetAllPrinters);
  mockGetDefaultPrinter.mockImplementation(defaultGetDefaultPrinter);
  mockPrinterExists.mockImplementation(defaultPrinterExists);
  mockGetPrinterByName.mockImplementation(defaultGetPrinterByName);
}
