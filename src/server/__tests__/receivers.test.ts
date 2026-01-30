import { describe, test, expect } from "bun:test";
import { TypedEventEmitter } from "../../core/index.js";
import type { SystemConfig, LogEntry, LogSubmitResult } from "../../core/index.js";
import { HttpReceiver } from "../http-server.js";
import { WebSocketReceiver } from "../websocket-server.js";

type LogResponse = {
  success?: boolean;
  code?: string;
  id?: string;
  results?: Array<{
    success?: boolean;
    code?: string;
    id?: string;
  }>;
};

const createConfig = (): SystemConfig => ({
  server: {
    port: 0,
    host: "127.0.0.1",
  },
  printer: {
    type: "mock",
    options: {},
  },
  queue: {
    maxSize: 1,
    retryAttempts: 1,
    retryDelayMs: 1,
  },
  format: {
    maxLineWidth: 80,
    includeTimestamp: true,
    includeSource: true,
    includeLevel: false,
  },
});

describe("Receivers queue-full handling", () => {
  test("HTTP /api/log returns 503 when queue is full", async () => {
    const eventBus = new TypedEventEmitter();
    const receiver = new HttpReceiver();
    const config = createConfig();

    await receiver.initialize(eventBus, config);

    eventBus.on("log:received", (entry: LogEntry, respond?: (result: LogSubmitResult) => void) => {
      respond?.({
        accepted: false,
        id: entry.id,
        code: "queue_full",
        message: "Queue is full",
        queueSize: 1,
      });
    });

    try {
      const response = await receiver.getApp().request("http://localhost/api/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello" }),
      });

      const payload = (await response.json()) as LogResponse;

      expect(response.status).toBe(503);
      expect(payload.success).toBe(false);
      expect(payload.code).toBe("queue_full");
      expect(typeof payload.id).toBe("string");
    } finally {
      await receiver.stop();
    }
  });

  test("HTTP /api/logs returns 503 if any entry is rejected", async () => {
    const eventBus = new TypedEventEmitter();
    const receiver = new HttpReceiver();
    const config = createConfig();

    await receiver.initialize(eventBus, config);

    eventBus.on("log:received", (entry: LogEntry, respond?: (result: LogSubmitResult) => void) => {
      if (entry.message === "reject" || entry.message === '"reject"') {
        respond?.({
          accepted: false,
          id: entry.id,
          code: "queue_full",
          message: "Queue is full",
          queueSize: 1,
        });
        return;
      }

      respond?.({
        accepted: true,
        id: entry.id,
        queueSize: 0,
      });
    });

    try {
      const response = await receiver.getApp().request("http://localhost/api/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(["ok", "reject"]),
      });

      const payload = (await response.json()) as LogResponse;

      const results = payload.results ?? [];

      expect(response.status).toBe(503);
      expect(results.length).toBe(2);
      expect(results[0]?.success).toBe(true);
      expect(results[1]?.success).toBe(false);
      expect(results[1]?.code).toBe("queue_full");
    } finally {
      await receiver.stop();
    }
  });

  test("WebSocket handler returns error when queue is full", async () => {
    const eventBus = new TypedEventEmitter();
    const receiver = new WebSocketReceiver();
    const config = createConfig();

    await receiver.initialize(eventBus, config);

    eventBus.on("log:received", (entry: LogEntry, respond?: (result: LogSubmitResult) => void) => {
      respond?.({
        accepted: false,
        id: entry.id,
        code: "queue_full",
        message: "Queue is full",
        queueSize: 1,
      });
    });

    const sent: Array<Record<string, unknown>> = [];
    const wsStub = {
      send: (data: string) => {
        sent.push(JSON.parse(data));
      },
    };

    await (
      receiver as unknown as { handleMessage: (ws: unknown, message: string) => Promise<void> }
    ).handleMessage(wsStub, JSON.stringify({ type: "log", payload: { message: "hello" } }));

    const response = sent.find((message) => message.type === "error" || message.type === "ack");
    expect(response?.type).toBe("error");
    expect(response?.code).toBe("queue_full");
    expect(typeof response?.id).toBe("string");
  });
});
