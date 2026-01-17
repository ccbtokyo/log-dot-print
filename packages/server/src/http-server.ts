import { createServer, IncomingMessage, ServerResponse } from "http";
import type {
  LogReceiverPlugin,
  LogEntry,
  LogSubmitResult,
  SystemConfig,
  TypedEventEmitter,
} from "@log-dot-print/core";
import { parseLogEntry } from "@log-dot-print/core";

/**
 * HTTP server for receiving log entries via REST API
 */
export class HttpReceiver implements LogReceiverPlugin {
  readonly name = "http-receiver";
  readonly version = "1.0.0";

  private server: ReturnType<typeof createServer> | null = null;
  private eventBus: TypedEventEmitter | null = null;
  private config: SystemConfig | null = null;

  async initialize(eventBus: TypedEventEmitter, config: SystemConfig): Promise<void> {
    this.eventBus = eventBus;
    this.config = config;
  }

  async shutdown(): Promise<void> {
    await this.stop();
  }

  async start(): Promise<void> {
    if (!this.config || !this.eventBus) {
      throw new Error("HttpReceiver not initialized");
    }

    const { port, host } = this.config.server;

    this.server = createServer((req, res) => {
      this.handleRequest(req, res);
    });

    return new Promise((resolve, reject) => {
      this.server!.on("error", reject);
      this.server!.listen(port, host, () => {
        console.log(`[HttpReceiver] Listening on http://${host}:${port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log("[HttpReceiver] Server stopped");
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    // Enable CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health check
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    // Log submission
    if (req.method === "POST" && req.url === "/log") {
      this.handleLogSubmit(req, res);
      return;
    }

    // Batch log submission
    if (req.method === "POST" && req.url === "/logs") {
      this.handleBatchLogSubmit(req, res);
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }

  private handleLogSubmit(req: IncomingMessage, res: ServerResponse): void {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk.toString();
    });

    req.on("end", async () => {
      try {
        const data = JSON.parse(body);
        const entry = parseLogEntry(data);

        if (!entry) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid log entry" }));
          return;
        }

        const result = await this.submitEntry(entry);
        const payload = this.buildHttpPayload(result);

        res.writeHead(result.accepted ? 200 : this.statusForResult(result), {
          "Content-Type": "application/json",
        });
        res.end(JSON.stringify(payload));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
  }

  private handleBatchLogSubmit(req: IncomingMessage, res: ServerResponse): void {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk.toString();
    });

    req.on("end", async () => {
      try {
        const data = JSON.parse(body);

        if (!Array.isArray(data)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Expected array of log entries" }));
          return;
        }

        const results: Array<{
          success: boolean;
          id: string;
          error?: string;
          code?: string;
          queueSize?: number;
        }> = [];

        for (const item of data) {
          const entry = parseLogEntry(item);
          if (entry) {
            const result = await this.submitEntry(entry);
            results.push(this.buildHttpPayload(result));
          } else {
            results.push({
              success: false,
              id: "",
              error: "Invalid log entry",
              code: "invalid_entry",
            });
          }
        }

        const allAccepted = results.every((result) => result.success);
        res.writeHead(allAccepted ? 200 : 503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ results }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
  }

  private buildHttpPayload(result: LogSubmitResult): {
    success: boolean;
    id: string;
    error?: string;
    code?: string;
    queueSize?: number;
  } {
    if (result.accepted) {
      return {
        success: true,
        id: result.id,
        queueSize: result.queueSize,
      };
    }

    return {
      success: false,
      id: result.id,
      error: result.message ?? "Log rejected",
      code: result.code,
      queueSize: result.queueSize,
    };
  }

  private statusForResult(result: LogSubmitResult): number {
    if (result.accepted) return 200;
    if (result.code === "queue_full") return 503;
    if (result.code === "timeout") return 504;
    if (result.code === "no_handler" || result.code === "not_ready") return 503;
    return 500;
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
}
