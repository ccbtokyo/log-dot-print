import { EventEmitter } from "events";
import type { LogEntry, LogSubmitResult, PrintJob, PrinterStatus } from "./types.js";

/**
 * Event types for the log-dot-print system
 */
export interface SystemEvents {
  // Log events
  "log:received": (entry: LogEntry, respond?: (result: LogSubmitResult) => void) => void;
  "log:queued": (job: PrintJob) => void;
  "log:formatted": (job: PrintJob) => void;

  // Print events
  "print:started": (job: PrintJob) => void;
  "print:completed": (job: PrintJob) => void;
  "print:failed": (job: PrintJob, error: Error) => void;
  "print:retry": (job: PrintJob, attempt: number) => void;

  // Printer events
  "printer:connected": (status: PrinterStatus) => void;
  "printer:disconnected": (status: PrinterStatus) => void;
  "printer:status": (status: PrinterStatus) => void;
  "printer:error": (error: Error) => void;

  // System events
  "system:ready": () => void;
  "system:shutdown": () => void;
  "system:error": (error: Error) => void;

  // Queue events
  "queue:full": (size: number) => void;
  "queue:drained": () => void;
}

/**
 * Type-safe event emitter for the system
 */
export class TypedEventEmitter extends EventEmitter {
  emit<K extends keyof SystemEvents>(event: K, ...args: Parameters<SystemEvents[K]>): boolean {
    return super.emit(event, ...args);
  }

  on<K extends keyof SystemEvents>(event: K, listener: SystemEvents[K]): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  once<K extends keyof SystemEvents>(event: K, listener: SystemEvents[K]): this {
    return super.once(event, listener as (...args: unknown[]) => void);
  }

  off<K extends keyof SystemEvents>(event: K, listener: SystemEvents[K]): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }
}

/**
 * Global event bus for the system
 * Use this for cross-component communication
 */
export const eventBus = new TypedEventEmitter();
