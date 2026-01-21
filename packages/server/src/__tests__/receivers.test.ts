import { describe, test, expect } from "bun:test";
import type { AddressInfo } from "net";
import { TypedEventEmitter } from "../../../core/src/events";
import { HttpReceiver } from "../http-server";
import { WebSocketReceiver } from "../websocket-server";
import type { SystemConfig } from "../../../core/src/types";

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
  test("HTTP /log returns 503 when queue is full", async () => {
    const eventBus = new TypedEventEmitter();
    const receiver = new HttpReceiver();
    const config = createConfig();

    await receiver.initialize(eventBus, config);

    eventBus.on("log:received", (entry, respond) => {
      respond?.({
        accepted: false,
        id: entry.id,
        code: "queue_full",
        message: "Queue is full",
        queueSize: 1,
      });
    });

    await receiver.start();
    const port = (
      (
        receiver as unknown as { server: { address(): AddressInfo } }
      ).server.address() as AddressInfo
    ).port;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/log`, {
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

  test("HTTP /logs returns 503 if any entry is rejected", async () => {
    const eventBus = new TypedEventEmitter();
    const receiver = new HttpReceiver();
    const config = createConfig();

    await receiver.initialize(eventBus, config);

    eventBus.on("log:received", (entry, respond) => {
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

    await receiver.start();
    const port = (
      (
        receiver as unknown as { server: { address(): AddressInfo } }
      ).server.address() as AddressInfo
    ).port;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/logs`, {
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

    eventBus.on("log:received", (entry, respond) => {
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
