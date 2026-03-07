import type { ServerWebSocket } from "bun";
import type {
  LogReceiverPlugin,
  LogEntry,
  LogSubmitResult,
  SystemConfig,
  TypedEventEmitter,
} from "../core/index.js";
import { parseLogEntry } from "../core/index.js";
import type { WebSocketHandler } from "./websocket-types.js";
import type { WebSocketData } from "./bun-server.js";
import { submitEntry } from "./submit-entry.js";

/**
 * WebSocket server for real-time log streaming from UE
 * Uses Bun native WebSocket API
 */
export class WebSocketReceiver implements LogReceiverPlugin, WebSocketHandler {
  readonly name = "websocket-receiver";
  readonly version = "1.0.0";

  private eventBus: TypedEventEmitter | null = null;
  private clients = new Set<ServerWebSocket<WebSocketData>>();
  private clientSources = new Map<ServerWebSocket<WebSocketData>, string>();

  async initialize(eventBus: TypedEventEmitter, _config: SystemConfig): Promise<void> {
    this.eventBus = eventBus;
  }

  async shutdown(): Promise<void> {
    await this.stop();
  }

  /**
   * Get the WebSocket handler for Bun server
   */
  getHandler(): WebSocketHandler {
    return this;
  }

  async start(): Promise<void> {
    // WebSocket is managed by Bun server, nothing to start separately
  }

  async stop(): Promise<void> {
    for (const client of this.clients) {
      client.close(1000, "Server shutdown");
    }
    this.clients.clear();
    this.clientSources.clear();
    console.log("[WebSocketReceiver] Stopped");
  }

  // WebSocketHandler implementation

  onOpen(ws: ServerWebSocket<WebSocketData>): void {
    console.log("[WebSocketReceiver] Client connected");
    this.clients.add(ws);
    this.clientSources.set(ws, ws.data.remoteAddress || "unknown");

    // Send welcome message
    ws.send(JSON.stringify({ type: "connected", message: "Log receiver ready" }));
  }

  onMessage(ws: ServerWebSocket<WebSocketData>, message: string): void {
    void this.handleMessage(ws, message);
  }

  onClose(ws: ServerWebSocket<WebSocketData>, code: number, reason: string): void {
    if (code !== 1000 && code !== 1001) {
      console.warn(`[WebSocketReceiver] Client disconnected with code ${code}: ${reason}`);
    } else {
      console.log("[WebSocketReceiver] Client disconnected");
    }
    this.clients.delete(ws);
    this.clientSources.delete(ws);
  }

  private async handleMessage(ws: ServerWebSocket<WebSocketData>, message: string): Promise<void> {
    try {
      const data = JSON.parse(message);
      const source = this.clientSources.get(ws) ?? "unknown";

      // Handle different message types
      if (data.type === "log") {
        const entry = parseLogEntry(data.payload || data, { source });
        if (entry) {
          const result = await this.submitEntry(entry);
          this.sendSubmitResponse(ws, result);
        } else {
          ws.send(
            JSON.stringify({
              type: "error",
              code: "invalid_entry",
              message: "Invalid log entry",
            }),
          );
        }
      } else if (data.type === "batch") {
        const entries = Array.isArray(data.payload) ? data.payload : [];
        const ids: string[] = [];
        const rejected: Array<{
          id: string;
          code?: string;
          message?: string;
          queueSize?: number;
        }> = [];
        for (const item of entries) {
          const entry = parseLogEntry(item, { source });
          if (entry) {
            const result = await this.submitEntry(entry);
            if (result.accepted) {
              ids.push(result.id);
            } else {
              rejected.push({
                id: result.id,
                code: result.code,
                message: result.message,
                queueSize: result.queueSize,
              });
            }
          } else {
            rejected.push({
              id: "",
              code: "invalid_entry",
              message: "Invalid log entry",
            });
          }
        }
        ws.send(
          JSON.stringify({
            type: "batch_ack",
            ids,
            rejected: rejected.length > 0 ? rejected : undefined,
          }),
        );
      } else if (data.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
      } else {
        // Treat as direct log entry
        const entry = parseLogEntry(data, { source });
        if (entry) {
          const result = await this.submitEntry(entry);
          this.sendSubmitResponse(ws, result);
        } else {
          ws.send(
            JSON.stringify({
              type: "error",
              code: "invalid_entry",
              message: "Invalid log entry",
            }),
          );
        }
      }
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
    }
  }

  private sendSubmitResponse(ws: ServerWebSocket<WebSocketData>, result: LogSubmitResult): void {
    if (result.accepted) {
      ws.send(JSON.stringify({ type: "ack", id: result.id }));
      return;
    }

    ws.send(
      JSON.stringify({
        type: "error",
        id: result.id,
        code: result.code,
        message: result.message ?? "Log rejected",
        queueSize: result.queueSize,
      }),
    );
  }

  private submitEntry(entry: LogEntry): Promise<LogSubmitResult> {
    if (!this.eventBus) {
      return Promise.resolve({
        accepted: false,
        id: entry.id,
        code: "not_ready",
        message: "Receiver not initialized",
      });
    }
    return submitEntry(this.eventBus, entry);
  }

  /**
   * Broadcast a message to all connected clients
   */
  broadcast(message: object): void {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === 1) {
        // WebSocket.OPEN
        client.send(data);
      }
    }
  }

  /**
   * Get connected client count
   */
  get clientCount(): number {
    return this.clients.size;
  }
}
