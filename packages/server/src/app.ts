import { createServer } from 'http';
import type {
  SystemConfig,
  PrinterPlugin,
  LogEntry,
  PrintJob,
  StoragePlugin,
} from '@log-dot-print/core';
import { TypedEventEmitter, createPrintJob } from '@log-dot-print/core';
import {
  PrintQueue,
  DefaultFormatter,
  printerRegistry,
} from '@log-dot-print/printer-core';
import { HttpReceiver } from './http-server.js';
import { WebSocketReceiver } from './websocket-server.js';
import { FileStorage } from './storage/file-storage.js';

// Import printer plugins to register them
import '@log-dot-print/printer-mock';

/**
 * Extended configuration with storage
 */
export interface AppConfig extends SystemConfig {
  storage?: {
    enabled: boolean;
    type: 'file';
    path: string;
    flushIntervalMs?: number;
  };
}

/**
 * Default configuration
 */
export const defaultConfig: AppConfig = {
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  printer: {
    type: 'mock',
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
  },
  storage: {
    enabled: true,
    type: 'file',
    path: './logs/ai-logs.jsonl',
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

  constructor(config: Partial<AppConfig> = {}) {
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
    console.log('[App] Starting Log-Dot-Print...');

    // Initialize storage if enabled
    if (this.config.storage?.enabled) {
      this.storage = new FileStorage(
        this.config.storage.path,
        { flushIntervalMs: this.config.storage.flushIntervalMs }
      );
      await this.storage.initialize();
      console.log(`[App] Storage enabled: ${this.config.storage.path}`);
    }

    // Initialize formatter
    await this.formatter.initialize(this.eventBus, this.config);

    // Initialize printer
    this.printer = printerRegistry.create(
      this.config.printer.type,
      this.config.printer.options
    );
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

    // Attach WebSocket
    this.wsReceiver.attachToServer(this.httpServer);

    // Start listening
    await new Promise<void>((resolve) => {
      this.httpServer!.listen(port, host, () => {
        console.log(`[App] Server running on http://${host}:${port}`);
        console.log(`[App] WebSocket available at ws://${host}:${port}/ws`);
        resolve();
      });
    });

    this.eventBus.emit('system:ready');
    console.log('[App] System ready');
  }

  /**
   * Stop the application
   */
  async stop(): Promise<void> {
    console.log('[App] Shutting down...');

    this.eventBus.emit('system:shutdown');

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

    console.log('[App] Shutdown complete');
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
    this.eventBus.on('log:received', async (entry: LogEntry) => {
      // Save to storage
      if (this.storage) {
        try {
          await this.storage.save(entry);
        } catch (error) {
          console.error('[App] Failed to save log:', error);
        }
      }

      // Format and print
      const formattedContent = this.formatter.format(entry);
      const job = createPrintJob(entry, formattedContent);
      this.eventBus.emit('log:formatted', job);
      this.printQueue.enqueue(job);
    });

    // Print events logging
    this.eventBus.on('print:started', (job: PrintJob) => {
      console.log(`[App] Printing job ${job.id}`);
    });

    this.eventBus.on('print:completed', (job: PrintJob) => {
      console.log(`[App] Completed job ${job.id}`);
    });

    this.eventBus.on('print:failed', (job: PrintJob, error: Error) => {
      console.error(`[App] Failed job ${job.id}:`, error.message);
    });

    this.eventBus.on('print:retry', (job: PrintJob, attempt: number) => {
      console.log(`[App] Retrying job ${job.id} (attempt ${attempt})`);
    });

    // Error handling
    this.eventBus.on('system:error', (error: Error) => {
      console.error('[App] System error:', error);
    });

    this.eventBus.on('printer:error', (error: Error) => {
      console.error('[App] Printer error:', error);
    });
  }

  private mergeConfig(
    defaults: AppConfig,
    overrides: Partial<AppConfig>
  ): AppConfig {
    return {
      server: { ...defaults.server, ...overrides.server },
      printer: { ...defaults.printer, ...overrides.printer },
      queue: { ...defaults.queue, ...overrides.queue },
      format: { ...defaults.format, ...overrides.format },
      storage: overrides.storage ?? defaults.storage,
    };
  }
}
