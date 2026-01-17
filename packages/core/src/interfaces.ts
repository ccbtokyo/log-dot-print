import type { LogEntry, PrintJob, PrinterStatus, SystemConfig } from "./types.js";
import type { TypedEventEmitter } from "./events.js";

/**
 * Plugin interface - base for all plugins
 */
export interface Plugin {
  /** Plugin name */
  readonly name: string;
  /** Plugin version */
  readonly version: string;
  /** Initialize the plugin */
  initialize(eventBus: TypedEventEmitter, config: SystemConfig): Promise<void>;
  /** Shutdown the plugin */
  shutdown(): Promise<void>;
}

/**
 * Printer plugin interface
 * Implement this to add support for different printer types
 */
export interface PrinterPlugin extends Plugin {
  /** Get current printer status */
  getStatus(): Promise<PrinterStatus>;
  /** Print a job */
  print(job: PrintJob): Promise<void>;
  /** Test printer connection */
  testConnection(): Promise<boolean>;
}

/**
 * Log receiver interface
 * Implement this to add support for different log input methods
 */
export interface LogReceiverPlugin extends Plugin {
  /** Start receiving logs */
  start(): Promise<void>;
  /** Stop receiving logs */
  stop(): Promise<void>;
}

/**
 * Log formatter interface
 * Implement this to customize log formatting for printing
 */
export interface LogFormatterPlugin extends Plugin {
  /** Format a log entry for printing */
  format(entry: LogEntry): string;
}

/**
 * Factory for creating printer plugins
 */
export interface PrinterPluginFactory {
  (options: Record<string, unknown>): PrinterPlugin;
}

/**
 * Plugin registry for managing available plugins
 */
export interface PluginRegistry {
  /** Register a printer plugin factory */
  registerPrinter(type: string, factory: PrinterPluginFactory): void;
  /** Get a printer plugin */
  getPrinter(type: string, options: Record<string, unknown>): PrinterPlugin;
  /** List available printer types */
  listPrinterTypes(): string[];
}
