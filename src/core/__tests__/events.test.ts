import { describe, test, expect, mock } from "bun:test";
import { TypedEventEmitter, eventBus } from "../events";
import type { LogEntry, PrintJob, PrinterStatus } from "../types";

const makeLogEntry = (overrides?: Partial<LogEntry>): LogEntry => ({
  id: "log-1",
  timestamp: "2025-01-01T00:00:00Z",
  source: "AI_1",
  level: "info",
  message: "test",
  printed: false,
  ...overrides,
});

const makePrintJob = (overrides?: Partial<PrintJob>): PrintJob => ({
  id: "job-1",
  logEntry: makeLogEntry(),
  formattedContent: "formatted",
  createdAt: new Date("2025-01-01T00:00:00Z"),
  status: "pending",
  retryCount: 0,
  ...overrides,
});

const makePrinterStatus = (overrides?: Partial<PrinterStatus>): PrinterStatus => ({
  connected: true,
  name: "test-printer",
  type: "mock",
  ready: true,
  ...overrides,
});

describe("TypedEventEmitter", () => {
  describe("emit / on", () => {
    test("calls listener with correct arguments", () => {
      const emitter = new TypedEventEmitter();
      const listener = mock(() => {});

      emitter.on("log:queued", listener);
      emitter.emit("log:queued", makePrintJob());

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0]).toMatchObject({ id: "job-1" });
    });

    test("calls multiple listeners", () => {
      const emitter = new TypedEventEmitter();
      const listener1 = mock(() => {});
      const listener2 = mock(() => {});

      emitter.on("system:ready", listener1);
      emitter.on("system:ready", listener2);
      emitter.emit("system:ready");

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    test("returns false when no listeners", () => {
      const emitter = new TypedEventEmitter();
      expect(emitter.emit("system:ready")).toBe(false);
    });

    test("returns true when listeners exist", () => {
      const emitter = new TypedEventEmitter();
      emitter.on("system:ready", () => {});
      expect(emitter.emit("system:ready")).toBe(true);
    });

    test("passes multiple arguments correctly", () => {
      const emitter = new TypedEventEmitter();
      const listener = mock(() => {});
      const job = makePrintJob();
      const error = new Error("fail");

      emitter.on("print:failed", listener);
      emitter.emit("print:failed", job, error);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0]).toBe(job);
      expect(listener.mock.calls[0][1]).toBe(error);
    });
  });

  describe("once", () => {
    test("fires listener only once", () => {
      const emitter = new TypedEventEmitter();
      const listener = mock(() => {});

      emitter.once("system:ready", listener);
      emitter.emit("system:ready");
      emitter.emit("system:ready");

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe("off", () => {
    test("removes listener", () => {
      const emitter = new TypedEventEmitter();
      const listener = mock(() => {});

      emitter.on("system:ready", listener);
      emitter.off("system:ready", listener);
      emitter.emit("system:ready");

      expect(listener).toHaveBeenCalledTimes(0);
    });

    test("does not affect other listeners", () => {
      const emitter = new TypedEventEmitter();
      const listener1 = mock(() => {});
      const listener2 = mock(() => {});

      emitter.on("system:ready", listener1);
      emitter.on("system:ready", listener2);
      emitter.off("system:ready", listener1);
      emitter.emit("system:ready");

      expect(listener1).toHaveBeenCalledTimes(0);
      expect(listener2).toHaveBeenCalledTimes(1);
    });
  });

  describe("printer events", () => {
    test("emits printer:connected with status", () => {
      const emitter = new TypedEventEmitter();
      const listener = mock(() => {});
      const status = makePrinterStatus();

      emitter.on("printer:connected", listener);
      emitter.emit("printer:connected", status);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0]).toEqual(status);
    });

    test("emits printer:error with Error", () => {
      const emitter = new TypedEventEmitter();
      const listener = mock(() => {});
      const error = new Error("connection failed");

      emitter.on("printer:error", listener);
      emitter.emit("printer:error", error);

      expect(listener.mock.calls[0][0]).toBe(error);
    });
  });

  describe("queue events", () => {
    test("emits queue:full with size", () => {
      const emitter = new TypedEventEmitter();
      const listener = mock(() => {});

      emitter.on("queue:full", listener);
      emitter.emit("queue:full", 100);

      expect(listener.mock.calls[0][0]).toBe(100);
    });

    test("emits queue:drained", () => {
      const emitter = new TypedEventEmitter();
      const listener = mock(() => {});

      emitter.on("queue:drained", listener);
      emitter.emit("queue:drained");

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });
});

describe("eventBus singleton", () => {
  test("is a TypedEventEmitter instance", () => {
    expect(eventBus).toBeInstanceOf(TypedEventEmitter);
  });

  test("returns the same instance on multiple imports", async () => {
    const { eventBus: eventBus2 } = await import("../events");
    expect(eventBus).toBe(eventBus2);
  });
});
