/**
 * Log entry received from UE
 */
export interface LogEntry {
  /** Unique identifier for this log entry */
  id: string;
  /** Timestamp when the log was created (ISO 8601) */
  timestamp: string;
  /** Log level/category */
  level: LogLevel;
  /** AI character or system that generated the log */
  source: string;
  /** Serialized payload to print */
  message: string;
  /** Whether the log has been printed */
  printed: boolean;
  /** Optional structured data */
  metadata?: Record<string, unknown>;
}

/**
 * Result of submitting a log entry for printing
 */
export interface LogSubmitResult {
  /** Whether the log entry was accepted into the print queue */
  accepted: boolean;
  /** Log entry identifier */
  id: string;
  /** Machine-readable error code when rejected */
  code?: string;
  /** Human-readable message when rejected */
  message?: string;
  /** Queue size at the time of submission */
  queueSize?: number;
}

export type LogLevel = string;

/**
 * Print job representing a formatted log ready for printing
 */
export interface PrintJob {
  /** Unique job identifier */
  id: string;
  /** Original log entry */
  logEntry: LogEntry;
  /** Formatted content ready for printing */
  formattedContent: string;
  /** Job creation timestamp */
  createdAt: Date;
  /** Job status */
  status: PrintJobStatus;
  /** Number of retry attempts */
  retryCount: number;
  /** Error message if failed */
  error?: string;
}

export type PrintJobStatus = "pending" | "printing" | "completed" | "failed";

/**
 * Queue state information for UI
 */
export interface QueueState {
  /** List of jobs in the queue */
  jobs: QueueJobInfo[];
  /** Whether queue processing is paused */
  isPaused: boolean;
  /** Whether the queue is currently processing */
  isProcessing: boolean;
  /** Total number of jobs in queue */
  totalSize: number;
}

/**
 * Job information for queue display
 */
export interface QueueJobInfo {
  /** Unique job identifier */
  id: string;
  /** Original log entry identifier */
  logEntryId: string;
  /** Source of the log entry */
  source: string;
  /** Truncated message preview (max 100 chars) */
  messagePreview: string;
  /** Job status */
  status: PrintJobStatus;
  /** Job creation timestamp (ISO 8601) */
  createdAt: string;
  /** Number of retry attempts */
  retryCount: number;
  /** Position in queue (0-indexed) */
  position: number;
}

/**
 * Printer status information
 */
export interface PrinterStatus {
  /** Whether the printer is connected */
  connected: boolean;
  /** Printer name/identifier */
  name: string;
  /** Printer type */
  type: PrinterType;
  /** Whether the printer is ready to accept jobs */
  ready: boolean;
  /** Additional status info */
  info?: string;
}

export type PrinterType = "cups" | "escpos" | "serial" | "mock" | "native" | "custom";

/**
 * Discovered printer from OS printer discovery
 */
export interface DiscoveredPrinter {
  /** Printer name */
  name: string;
  /** Whether this is the default printer */
  isDefault: boolean;
  /** Printer status */
  status?: "idle" | "printing" | "paused" | "error";
  /** Whether the printer is ready to accept jobs */
  ready?: boolean;
  /** Printer description */
  description?: string;
}

/**
 * Configuration for the log printer system
 */
export interface SystemConfig {
  /** Server configuration */
  server: {
    port: number;
    host: string;
  };
  /** Printer plugin to use */
  printer: {
    type: PrinterType;
    options: Record<string, unknown>;
  };
  /** Print queue settings */
  queue: {
    maxSize: number;
    retryAttempts: number;
    retryDelayMs: number;
  };
  /** Log formatting options */
  format: {
    maxLineWidth: number;
    includeTimestamp: boolean;
    includeSource: boolean;
    includeLevel: boolean;
  };
}
