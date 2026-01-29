import { createServer, IncomingMessage, ServerResponse } from "http";
import { createServer as createNetServer } from "net";
import type { AddressInfo } from "net";
import type {
  LogReceiverPlugin,
  LogEntry,
  LogSubmitResult,
  SystemConfig,
  TypedEventEmitter,
} from "../core/index.js";
import { parseLogEntry } from "../core/index.js";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { resolveRequestSource } from "./request-source.js";

const LogSubmitPayloadSchema = z
  .object({
    success: z.boolean(),
    id: z.string(),
    error: z.string().optional(),
    code: z.string().optional(),
    queueSize: z.number().optional(),
  })
  .openapi("LogSubmitPayload");

const ErrorResponseSchema = z
  .object({
    error: z.string(),
  })
  .openapi("ErrorResponse");

const HealthResponseSchema = z
  .object({
    status: z.literal("ok"),
  })
  .openapi("HealthResponse");

const LogRequestSchema = z.unknown().openapi({
  description: "Any JSON value. The server will serialize and accept it as a log payload.",
});

const BatchLogRequestSchema = z.array(z.unknown()).openapi({
  description: "Array of JSON values. Each entry is treated as a log payload.",
});

const BatchLogResponseSchema = z
  .object({
    results: z.array(LogSubmitPayloadSchema),
  })
  .openapi("BatchLogResponse");

/**
 * HTTP server for receiving log entries via REST API
 */
export class HttpReceiver implements LogReceiverPlugin {
  readonly name = "http-receiver";
  readonly version = "1.0.0";

  private server: ReturnType<typeof createServer> | null = null;
  private eventBus: TypedEventEmitter | null = null;
  private config: SystemConfig | null = null;
  private app: OpenAPIHono;

  constructor() {
    this.app = new OpenAPIHono();
    this.configureMiddleware();
    this.configureRoutes();
    this.configureOpenApi();
  }

  async initialize(eventBus: TypedEventEmitter, config: SystemConfig): Promise<void> {
    this.eventBus = eventBus;
    this.config = config;
  }

  async shutdown(): Promise<void> {
    await this.stop();
  }

  /**
   * Get the Hono app instance for Bun.serve() integration
   */
  getApp(): OpenAPIHono {
    return this.app;
  }

  async start(): Promise<void> {
    if (!this.config || !this.eventBus) {
      throw new Error("HttpReceiver not initialized");
    }

    const { port, host } = this.config.server;
    const listenPort = port === 0 ? await pickAvailablePort(host) : port;

    this.server = createServer((req, res) => {
      this.handleRequest(req, res);
    });

    return new Promise((resolve, reject) => {
      this.server!.on("error", reject);
      this.server!.listen(listenPort, host, () => {
        console.log(`[HttpReceiver] Listening on http://${host}:${listenPort}`);
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

  private configureMiddleware(): void {
    this.app.use(
      "*",
      cors({
        origin: "*",
        allowMethods: ["POST", "GET", "OPTIONS"],
        allowHeaders: ["Content-Type"],
      }),
    );

    this.app.options("*", (c) => c.body(null, 204));
  }

  private configureRoutes(): void {
    const healthRoute = createRoute({
      method: "get",
      path: "/health",
      responses: {
        200: {
          description: "Health check",
          content: {
            "application/json": {
              schema: HealthResponseSchema,
            },
          },
        },
      },
    });

    this.app.openapi(healthRoute, (c) => c.json({ status: "ok" }));

    const logSubmitRoute = createRoute({
      method: "post",
      path: "/log",
      request: {
        body: {
          content: {
            "application/json": {
              schema: LogRequestSchema,
            },
          },
          required: true,
        },
      },
      responses: {
        200: {
          description: "Log accepted",
          content: {
            "application/json": {
              schema: LogSubmitPayloadSchema,
            },
          },
        },
        400: {
          description: "Invalid JSON or log payload",
          content: {
            "application/json": {
              schema: ErrorResponseSchema,
            },
          },
        },
        503: {
          description: "Queue full or handler unavailable",
          content: {
            "application/json": {
              schema: LogSubmitPayloadSchema,
            },
          },
        },
        504: {
          description: "Submission timeout",
          content: {
            "application/json": {
              schema: LogSubmitPayloadSchema,
            },
          },
        },
        500: {
          description: "Unexpected error",
          content: {
            "application/json": {
              schema: LogSubmitPayloadSchema,
            },
          },
        },
      },
    });

    this.app.openapi(logSubmitRoute, async (c) => {
      const body = c.req.valid("json");
      const source = resolveRequestSource(c.req.raw.headers);
      const entry = parseLogEntry(body, { source });
      if (!entry) {
        return c.json({ error: "Invalid log entry" }, 400);
      }

      const result = await this.submitEntry(entry);
      const payload = this.buildHttpPayload(result);
      const status: 200 | 500 | 503 | 504 = result.accepted ? 200 : this.statusForResult(result);

      return c.json(payload, status);
    });

    const batchSubmitRoute = createRoute({
      method: "post",
      path: "/logs",
      request: {
        body: {
          content: {
            "application/json": {
              schema: BatchLogRequestSchema,
            },
          },
          required: true,
        },
      },
      responses: {
        200: {
          description: "All logs accepted",
          content: {
            "application/json": {
              schema: BatchLogResponseSchema,
            },
          },
        },
        400: {
          description: "Invalid JSON or payload format",
          content: {
            "application/json": {
              schema: ErrorResponseSchema,
            },
          },
        },
        503: {
          description: "One or more logs rejected",
          content: {
            "application/json": {
              schema: BatchLogResponseSchema,
            },
          },
        },
      },
    });

    this.app.openapi(batchSubmitRoute, async (c) => {
      const body = c.req.valid("json");
      if (!Array.isArray(body)) {
        return c.json({ error: "Expected array of log entries" }, 400);
      }

      const results: Array<{
        success: boolean;
        id: string;
        error?: string;
        code?: string;
        queueSize?: number;
      }> = [];

      const source = resolveRequestSource(c.req.raw.headers);
      for (const item of body) {
        const entry = parseLogEntry(item, { source });
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
      return c.json({ results }, allAccepted ? 200 : 503);
    });
  }

  private configureOpenApi(): void {
    this.app.doc("/openapi.json", {
      openapi: "3.1.0",
      info: {
        title: "Log-Dot-Print HTTP API",
        version: this.version,
        description: "HTTP endpoints for log ingestion and health checks.",
      },
    });
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    void this.handleRequestAsync(req, res);
  }

  private async handleRequestAsync(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const request = await this.buildRequest(req);
      const response = await this.app.fetch(request);

      res.statusCode = response.status;
      response.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });

      const body = await response.arrayBuffer();
      res.end(Buffer.from(body));
    } catch (error) {
      console.error("[HttpReceiver] Request handling failed", error);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  }

  private async buildRequest(req: IncomingMessage): Promise<Request> {
    const host = req.headers.host ?? "localhost";
    const url = new URL(req.url ?? "/", `http://${host}`);
    const headers = new Headers();

    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "undefined") continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          headers.append(key, item);
        }
      } else {
        headers.set(key, value);
      }
    }

    const remoteAddress = req.socket?.remoteAddress;
    if (remoteAddress && !headers.has("x-log-dot-print-remote-address")) {
      headers.set("x-log-dot-print-remote-address", remoteAddress);
    }

    const method = req.method ?? "GET";
    const body = await this.readRequestBody(req, method);

    return new Request(url.toString(), {
      method,
      headers,
      body,
    });
  }

  private async readRequestBody(req: IncomingMessage, method: string): Promise<Buffer | undefined> {
    if (method === "GET" || method === "HEAD") {
      return undefined;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    if (chunks.length === 0) {
      return undefined;
    }

    return Buffer.concat(chunks);
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

  private statusForResult(result: LogSubmitResult): 500 | 503 | 504 {
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

async function pickAvailablePort(host: string): Promise<number> {
  // NOTE: Bun v1.3.x on macOS cannot bind to port 0 (ephemeral). We emulate it by probing random ports.
  const minPort = 20_000;
  const maxPort = 60_000;
  const maxAttempts = 50;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = minPort + Math.floor(Math.random() * (maxPort - minPort + 1));

    const port = await new Promise<number | null>((resolve, reject) => {
      const probe = createNetServer();

      const finish = (result: number | null) => {
        probe.removeAllListeners();
        resolve(result);
      };

      probe.once("error", (error) => {
        const err = error as NodeJS.ErrnoException;
        if (err.code === "EADDRINUSE" || err.code === "EACCES") {
          finish(null);
          return;
        }
        reject(error);
      });

      probe.listen(candidate, host, () => {
        const address = probe.address() as AddressInfo;
        const actualPort = address.port;
        probe.close((closeError) => {
          if (closeError) {
            reject(closeError);
            return;
          }
          finish(actualPort);
        });
      });
    });

    if (port !== null) {
      return port;
    }
  }

  throw new Error(`Failed to pick available port on ${host} after ${maxAttempts} attempts`);
}
