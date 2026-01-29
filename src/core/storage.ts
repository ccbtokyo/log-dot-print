import type { LogEntry, PrintJob, PrintJobStatus } from "./types.js";

/**
 * Query options for print jobs
 */
export interface PrintJobQueryOptions {
  /** Filter by status (single or multiple) */
  status?: PrintJobStatus | PrintJobStatus[];
  /** Start timestamp (ISO 8601) */
  from?: string;
  /** End timestamp (ISO 8601) */
  to?: string;
  /** Limit results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Order by created_at */
  order?: "asc" | "desc";
}

/**
 * Storage plugin interface for log persistence
 */
export interface StoragePlugin {
  /** Plugin name */
  readonly name: string;
  /** Initialize the storage */
  initialize(): Promise<void>;
  /** Shutdown the storage */
  shutdown(): Promise<void>;
  /** Save a log entry */
  save(entry: LogEntry): Promise<void>;
  /** Save multiple log entries */
  saveBatch(entries: LogEntry[]): Promise<void>;
  /** Mark a log entry as printed */
  markPrinted(id: string): Promise<boolean>;
  /** Get log entries with optional filters */
  query(options: StorageQueryOptions): Promise<LogEntry[]>;
  /** Get total count */
  count(options?: StorageQueryOptions): Promise<number>;
}

export interface StorageQueryOptions {
  /** Filter by source */
  source?: string;
  /** Filter by level */
  level?: string;
  /** Start timestamp (ISO 8601) */
  from?: string;
  /** End timestamp (ISO 8601) */
  to?: string;
  /** Limit results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Order by timestamp */
  order?: "asc" | "desc";
}

/**
 * Print status record for history tracking
 */
export interface PrintStatusRecord {
  status: PrintJobStatus;
  retryCount: number;
  error?: string;
  createdAt: string;
}

/**
 * Queue persistence plugin interface for print job tracking
 */
export interface QueuePersistencePlugin {
  /** Save a new print job */
  savePrintJob(job: PrintJob): Promise<void>;
  /** Update print job status and record history */
  updatePrintJobStatus(
    jobId: string,
    status: PrintJobStatus,
    retryCount: number,
    error?: string,
  ): Promise<void>;
  /** Get pending jobs for queue restoration */
  getPendingJobs(): Promise<PrintJob[]>;
  /** Get status history for a specific job */
  getJobStatusHistory(jobId: string): Promise<PrintStatusRecord[]>;
  /** Query print jobs with filters */
  queryPrintJobs(options: PrintJobQueryOptions): Promise<PrintJob[]>;
  /** Count print jobs with filters */
  countPrintJobs(options?: PrintJobQueryOptions): Promise<number>;
}
