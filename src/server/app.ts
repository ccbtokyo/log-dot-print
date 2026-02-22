import { resolve } from "path";
import type { Server } from "bun";
import type {
  SystemConfig,
  PrinterPlugin,
  LogEntry,
  PrintJob,
  LogSubmitResult,
  StoragePlugin,
  QueuePersistencePlugin,
} from "../core/index.js";
import { TypedEventEmitter, createPrintJob } from "../core/index.js";
import {
  PrintQueue,
  DefaultFormatter,
  HtmlFormatter,
  ReplayFormatter,
  printerRegistry,
  tryRegisterSerialPrinter,
  tryRegisterEscposPrinter,
  tryRegisterNativePrinter,
  createImageConverter,
  createPdfConverter,
} from "../printers/index.js";
import type { ImageConverter, PdfConverter } from "../printers/index.js";
import type { LogFormatterPlugin, PrintContentType } from "../core/index.js";
import { SqliteStorage, QueuePersistenceHandler } from "../storage/index.js";
import { HttpReceiver } from "./http-server.js";
import { WebSocketReceiver } from "./websocket-server.js";
import { FileStorage } from "../storage/file-storage.js";
import { QueueController, UIWebSocketHandler, StaticMiddleware } from "./ui/index.js";
import { createBunServer } from "./bun-server.js";
import type { WebSocketHandler } from "./websocket-types.js";

// Import printer plugins to register them

/**
 * Extended configuration with storage and UI
 */
export interface AppConfig extends SystemConfig {
  storage?: {
    enabled: boolean;
    type: "file" | "sqlite";
    path: string;
    flushIntervalMs?: number;
  };
  ui?: {
    enabled: boolean;
    staticPath?: string;
    wsPath?: string;
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
    outputFormat: "text",
    maxLineWidth: 80,
    includeTimestamp: true,
    includeSource: true,
    includeLevel: false,
  },
  storage: {
    enabled: true,
    type: "sqlite",
    path: "./data/logs.db",
  },
  ui: {
    enabled: true,
    wsPath: "/ws/ui",
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
  private formatter: LogFormatterPlugin & { getContentType?: () => PrintContentType };
  private printer: PrinterPlugin | null = null;
  private storage: StoragePlugin | null = null;
  private queueStorage: QueuePersistencePlugin | null = null;
  private queuePersistenceHandler: QueuePersistenceHandler | null = null;
  private bunServer: Server<import("./bun-server.js").WebSocketData> | null = null;
  private queueController: QueueController | null = null;
  private uiWebSocketHandler: UIWebSocketHandler | null = null;
  private staticMiddleware: StaticMiddleware | null = null;
  private imageConverter: ImageConverter | null = null;
  private pdfConverter: PdfConverter | null = null;

  constructor(config: DeepPartial<AppConfig> = {}) {
    this.config = this.mergeConfig(defaultConfig, config);
    this.eventBus = new TypedEventEmitter();
    this.httpReceiver = new HttpReceiver();
    this.wsReceiver = new WebSocketReceiver();
    this.printQueue = new PrintQueue(this.config.queue);
    this.formatter = this.createFormatter();
  }

  /**
   * Create the appropriate formatter based on config
   */
  private createFormatter(): LogFormatterPlugin & { getContentType?: () => PrintContentType } {
    if (this.config.format?.outputFormat === "html") {
      return new HtmlFormatter();
    }
    if (this.config.format?.outputFormat === "replay") {
      return new ReplayFormatter();
    }
    return new DefaultFormatter();
  }

  /**
   * Start the application
   */
  async start(): Promise<void> {
    console.log("[App] Starting Log-Dot-Print...");
    console.log(
      "[App] Config:",
      JSON.stringify(
        {
          printer: this.config.printer,
          format: this.config.format,
          server: this.config.server,
        },
        null,
        2,
      ),
    );

    // Try to register optional printers (native module dependencies)
    // These may fail in bundled environments (e.g., Windows EXE) where
    // native modules cannot be included
    await Promise.all([
      tryRegisterSerialPrinter().catch(() => {}),
      tryRegisterEscposPrinter().catch(() => {}),
      tryRegisterNativePrinter().catch(() => {}),
    ]);

    // Initialize storage if enabled
    if (this.config.storage?.enabled) {
      if (this.config.storage.type === "sqlite") {
        const sqliteStorage = new SqliteStorage(this.config.storage.path);
        await sqliteStorage.initialize();
        this.storage = sqliteStorage;
        this.queueStorage = sqliteStorage;

        // Setup queue persistence handler
        this.queuePersistenceHandler = new QueuePersistenceHandler(sqliteStorage, this.eventBus);
        this.queuePersistenceHandler.initialize();
      } else {
        this.storage = new FileStorage(this.config.storage.path, {
          flushIntervalMs: this.config.storage.flushIntervalMs,
        });
        await this.storage.initialize();
      }
      console.log(
        `[App] Storage enabled (${this.config.storage.type}): ${this.config.storage.path}`,
      );
    }

    // Initialize image/PDF converter if enabled
    console.log("[App] Checking conversion config...");
    if (this.config.conversion?.enabled) {
      const conversionConfig = this.config.conversion;
      if (conversionConfig.format === "pdf") {
        console.log("[App] PDF converter enabled, initializing...");
        this.pdfConverter = await createPdfConverter();
        if (this.pdfConverter) {
          await this.pdfConverter.initialize();
          console.log("[App] PDF conversion enabled");
        }
      } else {
        console.log("[App] Image converter enabled, initializing...");
        this.imageConverter = await createImageConverter({
          format: conversionConfig.format,
          width: conversionConfig.width,
          grayscale: conversionConfig.grayscale,
        });
        if (this.imageConverter) {
          await this.imageConverter.initialize();
          console.log("[App] Image conversion enabled");
        }
      }
    } else {
      console.log("[App] Conversion not enabled, skipping");
    }

    // Initialize formatter — inject stored paper size if not explicitly set in config
    console.log("[App] Initializing formatter...");
    let configForFormatter = this.config;
    const fmt = this.config.format;
    if (
      (fmt.outputFormat === "html" || fmt.outputFormat === "replay") &&
      !fmt.pdfPaperSize &&
      this.queueStorage
    ) {
      const sqliteStorage = this.queueStorage as SqliteStorage | undefined;
      const storedPaperSize = sqliteStorage?.getSetting
        ? await sqliteStorage.getSetting("printer.paperSize")
        : null;
      if (storedPaperSize) {
        configForFormatter = {
          ...this.config,
          format: { ...fmt, pdfPaperSize: storedPaperSize },
        };
      }
    }
    await this.formatter.initialize(this.eventBus, configForFormatter);
    console.log("[App] Formatter initialized");

    // Initialize printer
    console.log("[App] Creating printer...");
    const printerOptions = {
      ...this.config.printer.options,
      getPrinterNameFromStorage: async () => {
        const sqliteStorage = this.queueStorage as SqliteStorage | undefined;
        return sqliteStorage?.getSetting ? await sqliteStorage.getSetting("printer.name") : null;
      },
      getPaperSizeFromStorage: async () => {
        const sqliteStorage = this.queueStorage as SqliteStorage | undefined;
        return sqliteStorage?.getSetting
          ? await sqliteStorage.getSetting("printer.paperSize")
          : null;
      },
    };
    this.printer = printerRegistry.create(this.config.printer.type, printerOptions);
    console.log("[App] Printer created, initializing...");
    await this.printer.initialize(this.eventBus, this.config);
    console.log("[App] Printer initialized");

    // Initialize print queue
    this.printQueue.initialize(this.printer, this.eventBus);

    // Restore pending jobs from storage (if using SQLite)
    if (this.queuePersistenceHandler) {
      const pendingJobs = await this.queuePersistenceHandler.getPendingJobs();
      for (const job of pendingJobs) {
        // Reset status to pending for crashed jobs
        job.status = "pending";
        this.printQueue.enqueue(job);
      }
      if (pendingJobs.length > 0) {
        console.log(`[App] Restored ${pendingJobs.length} pending jobs from storage`);
      }
    }

    // Setup event handlers
    this.setupEventHandlers();

    // Initialize UI components if enabled
    if (this.config.ui?.enabled) {
      this.queueController = new QueueController(
        this.printQueue,
        this.eventBus,
        this.formatter,
        this.queueStorage ?? undefined,
      );
      this.uiWebSocketHandler = new UIWebSocketHandler(this.printQueue, this.eventBus);
      this.uiWebSocketHandler.initialize();
      // Default static path is relative to project root (packages/ui/dist)
      const staticDir = this.config.ui.staticPath ?? resolve(process.cwd(), "dist/ui");
      this.staticMiddleware = new StaticMiddleware({
        basePath: "/ui",
        staticDir,
      });
      console.log("[App] UI enabled at /ui");
    }

    // Initialize receivers
    await this.httpReceiver.initialize(this.eventBus, this.config);
    await this.wsReceiver.initialize(this.eventBus, this.config);

    // Build WebSocket handlers map
    const wsHandlers = new Map<string, WebSocketHandler>();
    wsHandlers.set("/ws", this.wsReceiver.getHandler());
    if (this.uiWebSocketHandler) {
      wsHandlers.set(this.config.ui?.wsPath ?? "/ws/ui", this.uiWebSocketHandler.getHandler());
    }

    // Start listening (auto-increment port if needed)
    const { port, host } = this.config.server;
    const actualPort = await this.listenWithPortFallback(host, port, wsHandlers);
    this.config.server.port = actualPort;

    console.log(`[App] Server running on http://${host}:${actualPort}`);
    console.log(`[App] WebSocket available at ws://${host}:${actualPort}/ws`);
    if (this.config.ui?.enabled) {
      console.log(`[App] UI available at http://${host}:${actualPort}/ui`);
      console.log(
        `[App] UI WebSocket at ws://${host}:${actualPort}${this.config.ui.wsPath ?? "/ws/ui"}`,
      );
    }

    this.eventBus.emit("system:ready");
    console.log("[App] System ready");
  }

  /**
   * Stop the application
   */
  async stop(): Promise<void> {
    console.log("[App] Shutting down...");

    this.eventBus.emit("system:shutdown");

    // Stop UI WebSocket handler
    if (this.uiWebSocketHandler) {
      await this.uiWebSocketHandler.shutdown();
    }

    // Stop receivers
    await this.wsReceiver.shutdown();
    await this.httpReceiver.shutdown();

    // Stop print queue
    await this.printQueue.shutdown();

    // Stop printer
    if (this.printer) {
      await this.printer.shutdown();
    }

    // Stop queue persistence handler
    if (this.queuePersistenceHandler) {
      this.queuePersistenceHandler.shutdown();
    }

    // Stop storage
    if (this.storage) {
      await this.storage.shutdown();
    }

    // Stop converters
    if (this.imageConverter) {
      await this.imageConverter.shutdown();
    }
    if (this.pdfConverter) {
      await this.pdfConverter.shutdown();
    }

    // Stop Bun server
    if (this.bunServer) {
      this.bunServer.stop();
      console.log("[App] Server stopped");
    }

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
      uiWsClients: this.uiWebSocketHandler?.clientCount ?? 0,
    };
  }

  /** Routes handled by HttpReceiver under /api/ */
  private static readonly HTTP_RECEIVER_ROUTES = [
    "/api/log",
    "/api/logs",
    "/api/health",
    "/api/openapi.json",
  ];

  /**
   * Handle HTTP requests, routing to appropriate handlers
   */
  private async handleHttpRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    console.log(`[App] HTTP ${request.method} ${pathname}`);

    // Try static middleware first (for /ui paths)
    if (this.staticMiddleware && pathname.startsWith("/ui")) {
      const response = await this.staticMiddleware.handleBun(request);
      if (response) return response;
    }

    // Route specific /api/* paths to HttpReceiver
    if (LogPrintApp.HTTP_RECEIVER_ROUTES.includes(pathname)) {
      return this.httpReceiver.getApp().fetch(request);
    }

    // Route other /api/* paths to QueueController
    if (this.queueController && pathname.startsWith("/api/")) {
      console.log(`[App] Routing to QueueController: ${pathname}`);
      const response = await this.queueController.getApp().fetch(request);
      console.log(`[App] QueueController response: ${response.status}`);
      return response;
    }

    // Fall through to HTTP receiver for non-/api routes
    return this.httpReceiver.getApp().fetch(request);
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
    let contentType = this.formatter.getContentType?.() ?? "text";
    console.log(
      `[App] contentType=${contentType}, outputFormat=${this.config.format?.outputFormat}`,
    );
    const job = createPrintJob(entry, formattedContent, contentType);

    // Convert HTML to PDF if PDF converter is enabled
    if (this.pdfConverter && contentType === "html") {
      try {
        const pdfBuffer = await this.pdfConverter.convert(formattedContent);
        job.binaryContent = pdfBuffer;
        job.contentType = "pdf";
        contentType = "pdf";
        console.log(`[App] HTML converted to PDF (${pdfBuffer.length} bytes)`);
      } catch (error) {
        console.error("[App] Failed to convert HTML to PDF:", error);
        // Fall back to original HTML content
      }
    }

    // Convert HTML to image if image converter is enabled
    if (this.imageConverter && contentType === "html") {
      try {
        const imageBuffer = await this.imageConverter.convert(formattedContent);
        job.binaryContent = imageBuffer;
        job.contentType = "image";
        contentType = "image";
        console.log(`[App] HTML converted to image (${imageBuffer.length} bytes)`);
      } catch (error) {
        console.error("[App] Failed to convert HTML to image:", error);
        // Fall back to original HTML content
      }
    }

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

    // Update file path if available
    if (job.filePath && this.queueStorage?.updatePrintJobFilePath) {
      void this.queueStorage.updatePrintJobFilePath(job.id, job.filePath).catch((error) => {
        console.error("[App] Failed to update file path:", error);
      });
    }
  }

  private mergeConfig(defaults: AppConfig, overrides: DeepPartial<AppConfig>): AppConfig {
    return {
      server: { ...defaults.server, ...overrides.server },
      printer: { ...defaults.printer, ...overrides.printer },
      queue: { ...defaults.queue, ...overrides.queue },
      format: { ...defaults.format, ...overrides.format },
      storage: overrides.storage ? { ...defaults.storage, ...overrides.storage } : defaults.storage,
      ui: overrides.ui !== undefined ? { ...defaults.ui, ...overrides.ui } : defaults.ui,
      conversion: overrides.conversion,
    };
  }

  private async listenWithPortFallback(
    host: string,
    port: number,
    wsHandlers: Map<string, WebSocketHandler>,
  ): Promise<number> {
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error(`Invalid port: ${port}`);
    }

    const startPort = port;
    const maxPort = 65535;

    if (startPort === 0) {
      // Bun v1.3.x on macOS cannot bind to port 0 (ephemeral). Start from a random high port instead.
      const minPort = 20_000;
      const maxRandomPort = 60_000;
      const randomStart = minPort + Math.floor(Math.random() * (maxRandomPort - minPort + 1));
      return this.listenWithPortFallback(host, randomStart, wsHandlers);
    }

    for (let current = startPort; current <= maxPort; current++) {
      try {
        this.bunServer = createBunServer({
          port: current,
          hostname: host,
          fetch: (request) => this.handleHttpRequest(request),
          wsHandlers,
        });
        if (current !== startPort) {
          console.warn(`[App] Port ${startPort} is in use. Using ${current} instead.`);
        }
        return this.bunServer.port ?? current;
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
}
