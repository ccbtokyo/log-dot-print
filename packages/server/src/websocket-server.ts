import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import type {
  LogReceiverPlugin,
  LogEntry,
  LogSubmitResult,
  SystemConfig,
  TypedEventEmitter,
} from "@log-dot-print/core";
import { parseLogEntry } from "@log-dot-print/core";
import { resolveRequestSource } from "./request-source.js";

/**
 * WebSocket server for real-time log streaming from UE
 */
export class WebSocketReceiver implements LogReceiverPlugin {
  readonly name = "websocket-receiver";
  readonly version = "1.0.0";

  private wss: WebSocketServer | null = null;
  private eventBus: TypedEventEmitter | null = null;
  private clients = new Set<WebSocket>();
  private clientSources = new Map<WebSocket, string>();

  async initialize(eventBus: TypedEventEmitter, _config: SystemConfig): Promise<void> {
    this.eventBus = eventBus;
  }

  async shutdown(): Promise<void> {
    await this.stop();
  }

  /**
   * Attach to an existing HTTP server
   */
  attachToServer(server: Server): void {
    this.wss = new WebSocketServer({ server, path: "/ws" });
    this.setupWebSocket();
    console.log("[WebSocketReceiver] Attached to HTTP server on /ws");
  }

  async start(): Promise<void> {
    // WebSocket is attached to HTTP server, nothing to start separately
  }

  async stop(): Promise<void> {
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();

    return new Promise((resolve) => {
      if (this.wss) {
        this.wss.close(() => {
          console.log("[WebSocketReceiver] Server stopped");
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private setupWebSocket(): void {
    if (!this.wss) return;

    this.wss.on("error", (error) => {
      console.error("[WebSocketReceiver] Server error:", error);
      this.eventBus?.emit("system:error", error);
    });

    this.wss.on("connection", (ws, req) => {
      console.log("[WebSocketReceiver] Client connected");
      this.clients.add(ws);
      const source = resolveRequestSource(req.headers, req.socket?.remoteAddress);
      this.clientSources.set(ws, source);

      ws.on("message", (data) => {
        void this.handleMessage(ws, data.toString());
      });

      ws.on("close", () => {
        console.log("[WebSocketReceiver] Client disconnected");
        this.clients.delete(ws);
        this.clientSources.delete(ws);
      });

      ws.on("error", (error) => {
        console.error("[WebSocketReceiver] Client error:", error);
        this.clients.delete(ws);
        this.clientSources.delete(ws);
      });

      // Send welcome message
      ws.send(JSON.stringify({ type: "connected", message: "Log receiver ready" }));
    });
  }

  private async handleMessage(ws: WebSocket, message: string): Promise<void> {
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

  private sendSubmitResponse(ws: WebSocket, result: LogSubmitResult): void {
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
    const eventBus = this.eventBus;
    if (!eventBus) {
      return Promise.resolve({
        accepted: false,
        id: entry.id,
        code: "not_ready",
        message: "Receiver not initialized",
      });
    }

    return new Promise((resolve) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({
          accepted: false,
          id: entry.id,
          code: "timeout",
          message: "Submission timed out",
        });
      }, 5000);

      const handled = eventBus.emit("log:received", entry, (result: LogSubmitResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(result);
      });

      if (!handled) {
        settled = true;
        clearTimeout(timeout);
        resolve({
          accepted: false,
          id: entry.id,
          code: "no_handler",
          message: "No log handler registered",
        });
      }
    });
  }

  /**
   * Broadcast a message to all connected clients
   */
  broadcast(message: object): void {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
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
