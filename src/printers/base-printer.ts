import type {
  PrinterPlugin,
  PrinterStatus,
  PrintJob,
  SystemConfig,
  TypedEventEmitter,
  PrinterType,
} from "../core/index.js";

/**
 * Base class for printer plugins
 * Provides common functionality and default implementations
 */
export abstract class BasePrinter implements PrinterPlugin {
  abstract readonly name: string;
  abstract readonly version: string;
  protected abstract readonly printerType: PrinterType;

  protected eventBus: TypedEventEmitter | null = null;
  protected config: SystemConfig | null = null;
  protected connected = false;

  async initialize(eventBus: TypedEventEmitter, config: SystemConfig): Promise<void> {
    this.eventBus = eventBus;
    this.config = config;

    try {
      await this.connect();
      this.connected = true;
      this.eventBus.emit("printer:connected", await this.getStatus());
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.eventBus.emit("printer:error", err);
      throw err;
    }
  }

  async shutdown(): Promise<void> {
    const status = await this.getStatus();
    await this.disconnect();
    this.connected = false;
    this.eventBus?.emit("printer:disconnected", status);
  }

  async getStatus(): Promise<PrinterStatus> {
    return {
      connected: this.connected,
      name: this.name,
      type: this.printerType,
      ready: this.connected,
    };
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.connect();
      await this.disconnect();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Connect to the printer
   * Override in subclasses for actual connection logic
   */
  protected abstract connect(): Promise<void>;

  /**
   * Disconnect from the printer
   * Override in subclasses for actual disconnection logic
   */
  protected abstract disconnect(): Promise<void>;

  /**
   * Print a job
   * Override in subclasses for actual print logic
   */
  abstract print(job: PrintJob): Promise<void>;

  /**
   * Emit a status update
   */
  protected async emitStatusUpdate(): Promise<void> {
    const status = await this.getStatus();
    this.eventBus?.emit("printer:status", status);
  }
}
