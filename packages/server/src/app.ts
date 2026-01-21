import { createServer } from "http";
import { connect } from "net";
import type {
  SystemConfig,
  PrinterPlugin,
  LogEntry,
  PrintJob,
  LogSubmitResult,
  StoragePlugin,
} from "@log-dot-print/core";
import { TypedEventEmitter, createPrintJob } from "@log-dot-print/core";
import { PrintQueue, DefaultFormatter, printerRegistry } from "@log-dot-print/printer-core";
import { HttpReceiver } from "./http-server.js";
import { WebSocketReceiver } from "./websocket-server.js";
import { FileStorage } from "./storage/file-storage.js";

// Import printer plugins to register them
import "@log-dot-print/printer-cups";
import "@log-dot-print/printer-escpos";
import "@log-dot-print/printer-mock";
import "@log-dot-print/printer-serial";

/**
 * Extended configuration with storage
 */
export interface AppConfig extends SystemConfig {
  storage?: {
    enabled: boolean;
    type: "file";
    path: string;
    flushIntervalMs?: number;
  };
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Record<string, unknown> ? DeepPartial<T[K]> : T[K];
};

/**
 * Default configuration
 */
export const defaultConfig: AppConfig = {
  server: {
    port: 3000,
    host: "0.0.0.0",
  },
  printer: {
    type: "mock",
    options: {
      logToConsole: true,
    },
  },
  queue: {
    maxSize: 1000,
    retryAttempts: 3,
    retryDelayMs: 1000,
  },
  format: {
    maxLineWidth: 80,
    includeTimestamp: true,
    includeSource: true,
    includeLevel: false,
  },
  storage: {
    enabled: true,
    type: "file",
    path: "./logs/ai-logs.jsonl",
    flushIntervalMs: 1000,
  },
};

/**
 * Main application class
 */
export class LogPrintApp {
  private eventBus: TypedEventEmitter;
  private config: AppConfig;
  private httpReceiver: HttpReceiver;
  private wsReceiver: WebSocketReceiver;
  private printQueue: PrintQueue;
  private formatter: DefaultFormatter;
  private printer: PrinterPlugin | null = null;
  private storage: StoragePlugin | null = null;
  private httpServer: ReturnType<typeof createServer> | null = null;

  constructor(config: DeepPartial<AppConfig> = {}) {
    this.config = this.mergeConfig(defaultConfig, config);
    this.eventBus = new TypedEventEmitter();
    this.httpReceiver = new HttpReceiver();
    this.wsReceiver = new WebSocketReceiver();
    this.printQueue = new PrintQueue(this.config.queue);
    this.formatter = new DefaultFormatter();
  }

  /**
   * Start the application
   */
  async start(): Promise<void> {
    console.log("[App] Starting Log-Dot-Print...");

    // Initialize storage if enabled
    if (this.config.storage?.enabled) {
      this.storage = new FileStorage(this.config.storage.path, {
        flushIntervalMs: this.config.storage.flushIntervalMs,
      });
      await this.storage.initialize();
      console.log(`[App] Storage enabled: ${this.config.storage.path}`);
    }

    // Initialize formatter
    await this.formatter.initialize(this.eventBus, this.config);

    // Initialize printer
    this.printer = printerRegistry.create(this.config.printer.type, this.config.printer.options);
    await this.printer.initialize(this.eventBus, this.config);

    // Initialize print queue
    this.printQueue.initialize(this.printer, this.eventBus);

    // Setup event handlers
    this.setupEventHandlers();

    // Initialize receivers
    await this.httpReceiver.initialize(this.eventBus, this.config);
    await this.wsReceiver.initialize(this.eventBus, this.config);

    // Create HTTP server
    const { port, host } = this.config.server;
    this.httpServer = createServer((req, res) => {
      // @ts-expect-error - accessing private method for integration
      this.httpReceiver.handleRequest(req, res);
    });

    // Start listening (auto-increment port if needed)
    const actualPort = await this.listenWithPortFallback(this.httpServer, host, port);
    this.config.server.port = actualPort;

    // Attach WebSocket after HTTP server is listening
    this.wsReceiver.attachToServer(this.httpServer);

    console.log(`[App] Server running on http://${host}:${actualPort}`);
    console.log(`[App] WebSocket available at ws://${host}:${actualPort}/ws`);

    this.eventBus.emit("system:ready");
    console.log("[App] System ready");
  }

  /**
   * Stop the application
   */
  async stop(): Promise<void> {
    console.log("[App] Shutting down...");

    this.eventBus.emit("system:shutdown");

    // Stop receivers
    await this.wsReceiver.shutdown();
    await this.httpReceiver.shutdown();

    // Stop print queue
    await this.printQueue.shutdown();

    // Stop printer
    if (this.printer) {
      await this.printer.shutdown();
    }

    // Stop storage
    if (this.storage) {
      await this.storage.shutdown();
    }

    // Close HTTP server
    await new Promise<void>((resolve) => {
      if (this.httpServer) {
        this.httpServer.close(() => resolve());
      } else {
        resolve();
      }
    });

    console.log("[App] Shutdown complete");
  }

  /**
   * Get the event bus for external event handling
   */
  getEventBus(): TypedEventEmitter {
    return this.eventBus;
  }

  /**
   * Get the storage instance
   */
  getStorage(): StoragePlugin | null {
    return this.storage;
  }

  /**
   * Get print queue stats
   */
  getStats() {
    return {
      queueSize: this.printQueue.size,
      isProcessing: this.printQueue.isProcessing,
      wsClients: this.wsReceiver.clientCount,
    };
  }

  private setupEventHandlers(): void {
    // Log received -> save, format and queue
    this.eventBus.on(
      "log:received",
      (entry: LogEntry, respond?: (result: LogSubmitResult) => void) => {
        void this.handleLogReceived(entry)
          .then((result) => {
            respond?.(result);
          })
          .catch((error) => {
            const err = error instanceof Error ? error : new Error(String(error));
            console.error("[App] Failed to process log:", err);
            respond?.({
              accepted: false,
              id: entry.id,
              code: "internal_error",
              message: err.message,
              queueSize: this.printQueue.size,
            });
          });
      },
    );

    // Print events logging
    this.eventBus.on("print:started", (job: PrintJob) => {
      console.log(`[App] Printing job ${job.id}`);
    });

    this.eventBus.on("print:completed", (job: PrintJob) => {
      console.log(`[App] Completed job ${job.id}`);
      this.markJobPrinted(job);
    });

    this.eventBus.on("print:failed", (job: PrintJob, error: Error) => {
      console.error(`[App] Failed job ${job.id}:`, error.message);
    });

    this.eventBus.on("print:retry", (job: PrintJob, attempt: number) => {
      console.log(`[App] Retrying job ${job.id} (attempt ${attempt})`);
    });

    // Error handling
    this.eventBus.on("system:error", (error: Error) => {
      console.error("[App] System error:", error);
    });

    this.eventBus.on("printer:error", (error: Error) => {
      console.error("[App] Printer error:", error);
    });
  }

  private async handleLogReceived(entry: LogEntry): Promise<LogSubmitResult> {
    // Save to storage
    if (this.storage) {
      try {
        await this.storage.save(entry);
      } catch (error) {
        console.error("[App] Failed to save log:", error);
      }
    }

    // Format and print
    const formattedContent = this.formatter.format(entry);
    const job = createPrintJob(entry, formattedContent);
    this.eventBus.emit("log:formatted", job);
    const enqueued = this.printQueue.enqueue(job);

    if (!enqueued) {
      return {
        accepted: false,
        id: entry.id,
        code: "queue_full",
        message: "Queue is full",
        queueSize: this.printQueue.size,
      };
    }

    return {
      accepted: true,
      id: entry.id,
      queueSize: this.printQueue.size,
    };
  }

  private markJobPrinted(job: PrintJob): void {
    job.logEntry.printed = true;
    if (!this.storage) {
      return;
    }
    void this.storage.markPrinted(job.logEntry.id).catch((error) => {
      console.error("[App] Failed to update printed status:", error);
    });
  }

  private mergeConfig(defaults: AppConfig, overrides: DeepPartial<AppConfig>): AppConfig {
    return {
      server: { ...defaults.server, ...overrides.server },
      printer: { ...defaults.printer, ...overrides.printer },
      queue: { ...defaults.queue, ...overrides.queue },
      format: { ...defaults.format, ...overrides.format },
      storage: overrides.storage ? { ...defaults.storage, ...overrides.storage } : defaults.storage,
    };
  }

  private async listenWithPortFallback(
    server: ReturnType<typeof createServer>,
    host: string,
    port: number,
  ): Promise<number> {
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error(`Invalid port: ${port}`);
    }

    const startPort = port;
    const maxPort = 65535;

    if (startPort === 0) {
      await this.listenOnce(server, host, startPort);
      return this.getListeningPort(server, startPort);
    }

    for (let current = startPort; current <= maxPort; current++) {
      if (await this.isPortInUse(host, current)) {
        const next = current + 1;
        if (next > maxPort) {
          break;
        }
        console.warn(`[App] Port ${current} is in use, trying ${next}...`);
        continue;
      }

      try {
        await this.listenOnce(server, host, current);
        if (current !== startPort) {
          console.warn(`[App] Port ${startPort} is in use. Using ${current} instead.`);
        }
        return this.getListeningPort(server, current);
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code === "EADDRINUSE") {
          const next = current + 1;
          if (next > maxPort) {
            break;
          }
          console.warn(`[App] Port ${current} is in use, trying ${next}...`);
          continue;
        }
        throw error;
      }
    }

    throw new Error(`No available ports starting from ${startPort}`);
  }

  private listenOnce(
    server: ReturnType<typeof createServer>,
    host: string,
    port: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onListening = () => {
        cleanup();
        resolve();
      };
      const cleanup = () => {
        server.off("error", onError);
        server.off("listening", onListening);
      };

      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, host);
    });
  }

  private getListeningPort(server: ReturnType<typeof createServer>, fallback: number): number {
    const address = server.address();
    if (address && typeof address === "object") {
      return address.port;
    }
    return fallback;
  }

  private async isPortInUse(host: string, port: number): Promise<boolean> {
    if (port === 0) {
      return false;
    }

    const targets = this.getProbeHosts(host);
    for (const target of targets) {
      const inUse = await this.canConnect(target, port);
      if (inUse) {
        return true;
      }
    }
    return false;
  }

  private getProbeHosts(host: string): string[] {
    if (host === "0.0.0.0" || host === "::" || host.trim() === "") {
      return ["127.0.0.1", "::1"];
    }
    return [host];
  }

  private canConnect(host: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = connect({ host, port });
      const finish = (inUse: boolean) => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(inUse);
      };

      socket.setTimeout(200);
      socket.once("connect", () => finish(true));
      socket.once("timeout", () => finish(false));
      socket.once("error", () => finish(false));
    });
  }
}
