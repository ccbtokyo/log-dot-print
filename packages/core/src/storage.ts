import type { LogEntry } from "./types.js";

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
