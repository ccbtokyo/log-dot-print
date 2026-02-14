import { describe, test, expect, mock, beforeEach } from "bun:test";
import { WebSocketReceiver } from "../websocket-server";
import { TypedEventEmitter } from "../../core/events";
import type { SystemConfig, LogEntry, LogSubmitResult } from "../../core/types";

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

interface MockWebSocket {
  data: { path: string; remoteAddress: string };
  readyState: number;
  send: ReturnType<typeof mock>;
  close: ReturnType<typeof mock>;
}

const createMockWs = (remoteAddress = "127.0.0.1"): MockWebSocket => ({
  data: { path: "/ws", remoteAddress },
  readyState: 1,
  send: mock(() => {}),
  close: mock(() => {}),
});

describe("WebSocketReceiver", () => {
  let receiver: WebSocketReceiver;
  let eventBus: TypedEventEmitter;

  beforeEach(async () => {
    receiver = new WebSocketReceiver();
    eventBus = new TypedEventEmitter();
    await receiver.initialize(eventBus, makeConfig());
  });

  describe("lifecycle", () => {
    test("initializes without error", async () => {
      const r = new WebSocketReceiver();
      await expect(r.initialize(eventBus, makeConfig())).resolves.toBeUndefined();
    });

    test("starts without error", async () => {
      await expect(receiver.start()).resolves.toBeUndefined();
    });

    test("stops and clears clients", async () => {
      const ws = createMockWs();
      receiver.onOpen(ws as never);
      expect(receiver.clientCount).toBe(1);

      await receiver.stop();
      expect(receiver.clientCount).toBe(0);
      expect(ws.close).toHaveBeenCalledTimes(1);
    });

    test("shutdown calls stop", async () => {
      const ws = createMockWs();
      receiver.onOpen(ws as never);

      await receiver.shutdown();
      expect(receiver.clientCount).toBe(0);
    });
  });

  describe("onOpen", () => {
    test("adds client and sends welcome message", () => {
      const ws = createMockWs();
      receiver.onOpen(ws as never);

      expect(receiver.clientCount).toBe(1);
      expect(ws.send).toHaveBeenCalledTimes(1);

      const message = JSON.parse(ws.send.mock.calls[0][0] as string);
      expect(message.type).toBe("connected");
      expect(message.message).toBe("Log receiver ready");
    });
  });

  describe("onMessage", () => {
    test("handles log type with ack", async () => {
      const ws = createMockWs();
      receiver.onOpen(ws as never);
      ws.send.mockClear();

      // Register a handler that accepts the log
      eventBus.on(
        "log:received",
        (entry: LogEntry, respond?: (result: LogSubmitResult) => void) => {
          respond?.({ accepted: true, id: entry.id });
        },
      );

      receiver.onMessage(
        ws as never,
        JSON.stringify({ type: "log", payload: { message: "test" } }),
      );

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(ws.send).toHaveBeenCalled();
      const response = JSON.parse(ws.send.mock.calls[0][0] as string);
      expect(response.type).toBe("ack");
    });

    test("handles batch type", async () => {
      const ws = createMockWs();
      receiver.onOpen(ws as never);
      ws.send.mockClear();

      eventBus.on(
        "log:received",
        (entry: LogEntry, respond?: (result: LogSubmitResult) => void) => {
          respond?.({ accepted: true, id: entry.id });
        },
      );

      receiver.onMessage(
        ws as never,
        JSON.stringify({
          type: "batch",
          payload: [{ message: "log1" }, { message: "log2" }],
        }),
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(ws.send).toHaveBeenCalled();
      const response = JSON.parse(ws.send.mock.calls[0][0] as string);
      expect(response.type).toBe("batch_ack");
      expect(response.ids).toHaveLength(2);
    });

    test("handles ping/pong", async () => {
      const ws = createMockWs();
      receiver.onOpen(ws as never);
      ws.send.mockClear();

      receiver.onMessage(ws as never, JSON.stringify({ type: "ping" }));

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(ws.send).toHaveBeenCalled();
      const response = JSON.parse(ws.send.mock.calls[0][0] as string);
      expect(response.type).toBe("pong");
    });

    test("handles invalid JSON with error response", async () => {
      const ws = createMockWs();
      receiver.onOpen(ws as never);
      ws.send.mockClear();

      receiver.onMessage(ws as never, "not valid json{{{");

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(ws.send).toHaveBeenCalled();
      const response = JSON.parse(ws.send.mock.calls[0][0] as string);
      expect(response.type).toBe("error");
      expect(response.message).toBe("Invalid JSON");
    });

    test("handles direct log entry (no type field)", async () => {
      const ws = createMockWs();
      receiver.onOpen(ws as never);
      ws.send.mockClear();

      eventBus.on(
        "log:received",
        (entry: LogEntry, respond?: (result: LogSubmitResult) => void) => {
          respond?.({ accepted: true, id: entry.id });
        },
      );

      receiver.onMessage(ws as never, JSON.stringify({ message: "direct log" }));

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(ws.send).toHaveBeenCalled();
      const response = JSON.parse(ws.send.mock.calls[0][0] as string);
      expect(response.type).toBe("ack");
    });

    test("returns no_handler when no log:received listener", async () => {
      const ws = createMockWs();
      receiver.onOpen(ws as never);
      ws.send.mockClear();

      receiver.onMessage(
        ws as never,
        JSON.stringify({ type: "log", payload: { message: "test" } }),
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(ws.send).toHaveBeenCalled();
      const response = JSON.parse(ws.send.mock.calls[0][0] as string);
      expect(response.type).toBe("error");
      expect(response.code).toBe("no_handler");
    });
  });

  describe("onClose", () => {
    test("removes client on close", () => {
      const ws = createMockWs();
      receiver.onOpen(ws as never);
      expect(receiver.clientCount).toBe(1);

      receiver.onClose(ws as never, 1000, "normal");
      expect(receiver.clientCount).toBe(0);
    });
  });

  describe("broadcast", () => {
    test("sends message to all connected clients", () => {
      const ws1 = createMockWs("10.0.0.1");
      const ws2 = createMockWs("10.0.0.2");
      receiver.onOpen(ws1 as never);
      receiver.onOpen(ws2 as never);
      ws1.send.mockClear();
      ws2.send.mockClear();

      receiver.broadcast({ type: "update", data: "test" });

      expect(ws1.send).toHaveBeenCalledTimes(1);
      expect(ws2.send).toHaveBeenCalledTimes(1);
      const msg1 = JSON.parse(ws1.send.mock.calls[0][0] as string);
      expect(msg1.type).toBe("update");
    });

    test("skips clients with closed readyState", () => {
      const wsOpen = createMockWs();
      const wsClosed = createMockWs();
      wsClosed.readyState = 3; // CLOSED

      receiver.onOpen(wsOpen as never);
      receiver.onOpen(wsClosed as never);
      wsOpen.send.mockClear();
      wsClosed.send.mockClear();

      receiver.broadcast({ type: "test" });

      expect(wsOpen.send).toHaveBeenCalledTimes(1);
      expect(wsClosed.send).toHaveBeenCalledTimes(0);
    });
  });

  describe("getHandler", () => {
    test("returns self", () => {
      expect(receiver.getHandler()).toBe(receiver);
    });
  });
});
