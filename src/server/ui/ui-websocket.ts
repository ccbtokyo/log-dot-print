/**
 * WebSocket handler for UI real-time updates
 * @see docs/architecture.md for design details
 * @related packages/core/src/events.ts - TypedEventEmitter
 * @related packages/printer-core/src/queue.ts - PrintQueue
 */

import type { ServerWebSocket } from "bun";
import type { PrintJob, TypedEventEmitter, QueueState } from "../../core/index.js";
import type { PrintQueue } from "../../printers/index.js";
import type { WebSocketHandler } from "../websocket-types.js";
import type { WebSocketData } from "../bun-server.js";

/**
 * WebSocket message types from client to server
 */
export type ClientMessage =
  | { type: "subscribe" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "skip"; jobId: string }
  | { type: "prioritize"; jobId: string }
  | { type: "clear" }
  | { type: "ping" };

/**
 * WebSocket message types from server to client
 */
export type ServerMessage =
  | { type: "connected"; message: string }
  | { type: "queue:state"; payload: QueueState }
  | { type: "job:started"; payload: SerializedPrintJob }
  | { type: "job:completed"; payload: SerializedPrintJob }
  | { type: "job:failed"; payload: { job: SerializedPrintJob; error: string } }
  | { type: "job:skipped"; payload: SerializedPrintJob }
  | { type: "job:prioritized"; payload: { job: SerializedPrintJob; newPosition: number } }
  | { type: "queue:paused" }
  | { type: "queue:resumed" }
  | { type: "pong" }
  | { type: "error"; message: string };

interface SerializedPrintJob {
  id: string;
  logEntry: {
    id: string;
    timestamp: string;
    level: string;
    source: string;
    message: string;
    printed: boolean;
    metadata?: Record<string, unknown>;
  };
  formattedContent: string;
  createdAt: string;
  status: string;
  retryCount: number;
  error?: string;
}

/**
 * WebSocket handler for UI clients
 * Uses Bun native WebSocket API
 */
export class UIWebSocketHandler implements WebSocketHandler {
  private clients = new Set<ServerWebSocket<WebSocketData>>();
  private printQueue: PrintQueue;
  private eventBus: TypedEventEmitter;
  private initialized = false;

  constructor(printQueue: PrintQueue, eventBus: TypedEventEmitter) {
    this.printQueue = printQueue;
    this.eventBus = eventBus;
  }

  /**
   * Initialize the handler and set up event listeners
   */
  initialize(): void {
    if (this.initialized) return;
    this.setupEventListeners();
    this.initialized = true;
    console.log("[UIWebSocketHandler] Initialized");
  }

  /**
   * Get the WebSocket handler for Bun server
   */
  getHandler(): WebSocketHandler {
    return this;
  }

  /**
   * Get connected client count
   */
  get clientCount(): number {
    return this.clients.size;
  }

  /**
   * Shutdown the handler
   */
  async shutdown(): Promise<void> {
    this.removeEventListeners();

    for (const client of this.clients) {
      client.close(1000, "Server shutdown");
    }
    this.clients.clear();
    console.log("[UIWebSocketHandler] Stopped");
  }

  // WebSocketHandler implementation

  onOpen(ws: ServerWebSocket<WebSocketData>): void {
    console.log("[UIWebSocketHandler] Client connected");
    this.clients.add(ws);

    // Send welcome message
    this.send(ws, { type: "connected", message: "UI WebSocket ready" });

    // Send current queue state
    this.send(ws, { type: "queue:state", payload: this.printQueue.getState() });
  }

  onMessage(ws: ServerWebSocket<WebSocketData>, message: string): void {
    this.handleMessage(ws, message);
  }

  onClose(ws: ServerWebSocket<WebSocketData>, code: number, reason: string): void {
    if (code !== 1000 && code !== 1001) {
      console.warn(`[UIWebSocketHandler] Client disconnected with code ${code}: ${reason}`);
    } else {
      console.log("[UIWebSocketHandler] Client disconnected");
    }
    this.clients.delete(ws);
  }

  private setupEventListeners(): void {
    this.eventBus.on("queue:state", this.onQueueState);
    this.eventBus.on("queue:paused", this.onQueuePaused);
    this.eventBus.on("queue:resumed", this.onQueueResumed);
    this.eventBus.on("queue:job:skipped", this.onJobSkipped);
    this.eventBus.on("queue:job:prioritized", this.onJobPrioritized);
    this.eventBus.on("print:started", this.onPrintStarted);
    this.eventBus.on("print:completed", this.onPrintCompleted);
    this.eventBus.on("print:failed", this.onPrintFailed);
  }

  private removeEventListeners(): void {
    this.eventBus.off("queue:state", this.onQueueState);
    this.eventBus.off("queue:paused", this.onQueuePaused);
    this.eventBus.off("queue:resumed", this.onQueueResumed);
    this.eventBus.off("queue:job:skipped", this.onJobSkipped);
    this.eventBus.off("queue:job:prioritized", this.onJobPrioritized);
    this.eventBus.off("print:started", this.onPrintStarted);
    this.eventBus.off("print:completed", this.onPrintCompleted);
    this.eventBus.off("print:failed", this.onPrintFailed);
  }

  private handleMessage(ws: ServerWebSocket<WebSocketData>, message: string): void {
    try {
      const data = JSON.parse(message) as ClientMessage;

      switch (data.type) {
        case "subscribe":
          // Send current state
          this.send(ws, { type: "queue:state", payload: this.printQueue.getState() });
          break;

        case "pause":
          this.printQueue.pause();
          break;

        case "resume":
          this.printQueue.resume();
          break;

        case "skip":
          if (data.jobId) {
            const skipped = this.printQueue.skip(data.jobId);
            if (!skipped) {
              this.send(ws, { type: "error", message: "Job not found" });
            }
          }
          break;

        case "prioritize":
          if (data.jobId) {
            const newPos = this.printQueue.prioritize(data.jobId);
            if (newPos === -1) {
              this.send(ws, { type: "error", message: "Job not found" });
            }
          }
          break;

        case "clear":
          this.printQueue.clear();
          // Emit state after clear
          this.broadcast({ type: "queue:state", payload: this.printQueue.getState() });
          break;

        case "ping":
          this.send(ws, { type: "pong" });
          break;

        default:
          this.send(ws, { type: "error", message: "Unknown message type" });
      }
    } catch {
      this.send(ws, { type: "error", message: "Invalid JSON" });
    }
  }

  private onQueueState = (state: QueueState): void => {
    this.broadcast({ type: "queue:state", payload: state });
  };

  private onQueuePaused = (): void => {
    this.broadcast({ type: "queue:paused" });
  };

  private onQueueResumed = (): void => {
    this.broadcast({ type: "queue:resumed" });
  };

  private onJobSkipped = (job: PrintJob): void => {
    this.broadcast({ type: "job:skipped", payload: this.serializeJob(job) });
  };

  private onJobPrioritized = (job: PrintJob, newPosition: number): void => {
    this.broadcast({
      type: "job:prioritized",
      payload: { job: this.serializeJob(job), newPosition },
    });
  };

  private onPrintStarted = (job: PrintJob): void => {
    this.broadcast({ type: "job:started", payload: this.serializeJob(job) });
    // Also send updated queue state
    this.broadcast({ type: "queue:state", payload: this.printQueue.getState() });
  };

  private onPrintCompleted = (job: PrintJob): void => {
    this.broadcast({ type: "job:completed", payload: this.serializeJob(job) });
    // Also send updated queue state
    this.broadcast({ type: "queue:state", payload: this.printQueue.getState() });
  };

  private onPrintFailed = (job: PrintJob, error: Error): void => {
    this.broadcast({
      type: "job:failed",
      payload: { job: this.serializeJob(job), error: error.message },
    });
    // Also send updated queue state
    this.broadcast({ type: "queue:state", payload: this.printQueue.getState() });
  };

  private serializeJob(job: PrintJob): SerializedPrintJob {
    return {
      id: job.id,
      logEntry: job.logEntry,
      formattedContent: job.formattedContent,
      createdAt: job.createdAt.toISOString(),
      status: job.status,
      retryCount: job.retryCount,
      error: job.error,
    };
  }

  private send(ws: ServerWebSocket<WebSocketData>, message: ServerMessage): void {
    if (ws.readyState === 1) {
      // WebSocket.OPEN
      ws.send(JSON.stringify(message));
    }
  }

  private broadcast(message: ServerMessage): void {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === 1) {
        // WebSocket.OPEN
        client.send(data);
      }
    }
  }
}
