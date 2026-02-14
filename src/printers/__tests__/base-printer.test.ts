import { describe, test, expect, mock, beforeEach } from "bun:test";
import { BasePrinter } from "../base-printer";
import { TypedEventEmitter } from "../../core/events";
import type { PrintJob, PrinterStatus, PrinterType, SystemConfig } from "../../core/types";

class TestPrinter extends BasePrinter {
  readonly name = "test-printer";
  readonly version = "1.0.0";
  protected readonly printerType: PrinterType = "mock";

  connectMock = mock(() => Promise.resolve());
  disconnectMock = mock(() => Promise.resolve());
  printMock = mock(() => Promise.resolve());

  protected connect(): Promise<void> {
    return this.connectMock();
  }

  protected disconnect(): Promise<void> {
    return this.disconnectMock();
  }

  async print(job: PrintJob): Promise<void> {
    return this.printMock(job);
  }
}

const makeConfig = (): SystemConfig => ({
  server: { port: 3000, host: "localhost" },
  printer: { type: "mock", options: {} },
  queue: { maxSize: 100, retryAttempts: 3, retryDelayMs: 1000 },
  format: {
    outputFormat: "text",
    maxLineWidth: 80,
    includeTimestamp: true,
    includeSource: true,
    includeLevel: true,
  },
});

describe("BasePrinter", () => {
  let printer: TestPrinter;
  let eventBus: TypedEventEmitter;
  let config: SystemConfig;

  beforeEach(() => {
    printer = new TestPrinter();
    eventBus = new TypedEventEmitter();
    config = makeConfig();
  });

  describe("initialize", () => {
    test("calls connect and sets connected to true", async () => {
      await printer.initialize(eventBus, config);

      expect(printer.connectMock).toHaveBeenCalledTimes(1);
      const status = await printer.getStatus();
      expect(status.connected).toBe(true);
    });

    test("emits printer:connected event", async () => {
      const listener = mock(() => {});
      eventBus.on("printer:connected", listener);

      await printer.initialize(eventBus, config);

      expect(listener).toHaveBeenCalledTimes(1);
      const status = listener.mock.calls[0][0] as PrinterStatus;
      expect(status.connected).toBe(true);
      expect(status.name).toBe("test-printer");
      expect(status.type).toBe("mock");
    });

    test("emits printer:error and rethrows on connect failure", async () => {
      const connectError = new Error("connection failed");
      printer.connectMock.mockImplementation(() => Promise.reject(connectError));

      const listener = mock(() => {});
      eventBus.on("printer:error", listener);

      await expect(printer.initialize(eventBus, config)).rejects.toThrow("connection failed");

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0]).toBe(connectError);
    });

    test("wraps non-Error thrown values", async () => {
      printer.connectMock.mockImplementation(() => Promise.reject("string error"));

      const listener = mock(() => {});
      eventBus.on("printer:error", listener);

      await expect(printer.initialize(eventBus, config)).rejects.toThrow("string error");

      const emittedError = listener.mock.calls[0][0] as Error;
      expect(emittedError).toBeInstanceOf(Error);
      expect(emittedError.message).toBe("string error");
    });
  });

  describe("shutdown", () => {
    test("calls disconnect and sets connected to false", async () => {
      await printer.initialize(eventBus, config);
      await printer.shutdown();

      expect(printer.disconnectMock).toHaveBeenCalledTimes(1);
      const status = await printer.getStatus();
      expect(status.connected).toBe(false);
    });

    test("emits printer:disconnected event", async () => {
      const listener = mock(() => {});
      eventBus.on("printer:disconnected", listener);

      await printer.initialize(eventBus, config);
      await printer.shutdown();

      expect(listener).toHaveBeenCalledTimes(1);
      const status = listener.mock.calls[0][0] as PrinterStatus;
      expect(status.name).toBe("test-printer");
    });
  });

  describe("getStatus", () => {
    test("returns correct status before initialize", async () => {
      const status = await printer.getStatus();
      expect(status).toEqual({
        connected: false,
        name: "test-printer",
        type: "mock",
        ready: false,
      });
    });

    test("returns correct status after initialize", async () => {
      await printer.initialize(eventBus, config);
      const status = await printer.getStatus();
      expect(status).toEqual({
        connected: true,
        name: "test-printer",
        type: "mock",
        ready: true,
      });
    });
  });

  describe("testConnection", () => {
    test("returns true on successful connect/disconnect", async () => {
      const result = await printer.testConnection();
      expect(result).toBe(true);
      expect(printer.connectMock).toHaveBeenCalledTimes(1);
      expect(printer.disconnectMock).toHaveBeenCalledTimes(1);
    });

    test("returns false on connect failure", async () => {
      printer.connectMock.mockImplementation(() => Promise.reject(new Error("fail")));

      const result = await printer.testConnection();
      expect(result).toBe(false);
    });
  });

  describe("emitStatusUpdate", () => {
    test("emits printer:status event", async () => {
      const listener = mock(() => {});
      eventBus.on("printer:status", listener);

      await printer.initialize(eventBus, config);
      // Access protected method via cast
      await (printer as unknown as { emitStatusUpdate: () => Promise<void> }).emitStatusUpdate();

      expect(listener).toHaveBeenCalledTimes(1);
      const status = listener.mock.calls[0][0] as PrinterStatus;
      expect(status.connected).toBe(true);
    });

    test("does nothing when eventBus is not set", async () => {
      // No initialize called, so eventBus is null
      await expect(
        (printer as unknown as { emitStatusUpdate: () => Promise<void> }).emitStatusUpdate(),
      ).resolves.toBeUndefined();
    });
  });
});
