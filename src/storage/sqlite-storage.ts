/**
 * SQLite storage implementation
 * @see docs/architecture.md for design details
 * @related packages/core/src/storage.ts - StoragePlugin interface
 * @related packages/server/src/storage/file-storage.ts - FileStorage implementation
 */

import { Database } from "bun:sqlite";
import { mkdir } from "fs/promises";
import { dirname } from "path";
import type {
  LogEntry,
  PrintJob,
  PrintJobStatus,
  StoragePlugin,
  StorageQueryOptions,
  QueuePersistencePlugin,
  PrintStatusRecord,
} from "../core/index.js";
import {
  CREATE_TABLES_SQL,
  INSERT_LOG_ENTRY_SQL,
  UPDATE_LOG_ENTRY_PRINTED_SQL,
  INSERT_PRINT_JOB_SQL,
  UPDATE_PRINT_JOB_STATUS_SQL,
  INSERT_STATUS_HISTORY_SQL,
  GET_PENDING_JOBS_SQL,
  GET_STATUS_HISTORY_SQL,
  QUERY_LOG_ENTRIES_SQL,
  COUNT_LOG_ENTRIES_SQL,
} from "./schema.js";

interface LogEntryRow {
  id: string;
  timestamp: string;
  level: string;
  source: string;
  message: string;
  printed: number;
  metadata: string | null;
  created_at: string;
}

interface PendingJobRow {
  id: string;
  log_entry_id: string;
  formatted_content: string;
  created_at: string;
  status: string;
  retry_count: number;
  error: string | null;
  le_id: string;
  le_timestamp: string;
  le_level: string;
  le_source: string;
  le_message: string;
  le_printed: number;
  le_metadata: string | null;
}

interface StatusHistoryRow {
  status: string;
  retry_count: number;
  error: string | null;
  created_at: string;
}

interface CountRow {
  count: number;
}

/**
 * SQLite-based storage implementation
 * Implements both StoragePlugin and QueuePersistencePlugin interfaces
 */
export class SqliteStorage implements StoragePlugin, QueuePersistencePlugin {
  readonly name = "sqlite-storage";
  private db: Database | null = null;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    await mkdir(dirname(this.dbPath), { recursive: true });
    this.db = new Database(this.dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(CREATE_TABLES_SQL);
    console.log(`[SqliteStorage] Initialized at ${this.dbPath}`);
  }

  async shutdown(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    console.log("[SqliteStorage] Shutdown complete");
  }

  async save(entry: LogEntry): Promise<void> {
    this.ensureDb();
    const stmt = this.db!.prepare(INSERT_LOG_ENTRY_SQL);
    stmt.run(
      entry.id,
      entry.timestamp,
      entry.level,
      entry.source,
      entry.message,
      entry.printed ? 1 : 0,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
      new Date().toISOString(),
    );
  }

  async saveBatch(entries: LogEntry[]): Promise<void> {
    this.ensureDb();
    const stmt = this.db!.prepare(INSERT_LOG_ENTRY_SQL);
    const insertAll = this.db!.transaction(() => {
      for (const entry of entries) {
        stmt.run(
          entry.id,
          entry.timestamp,
          entry.level,
          entry.source,
          entry.message,
          entry.printed ? 1 : 0,
          entry.metadata ? JSON.stringify(entry.metadata) : null,
          new Date().toISOString(),
        );
      }
    });
    insertAll();
  }

  async markPrinted(id: string): Promise<boolean> {
    this.ensureDb();
    const stmt = this.db!.prepare(UPDATE_LOG_ENTRY_PRINTED_SQL);
    const result = stmt.run(1, id);
    return result.changes > 0;
  }

  async query(options: StorageQueryOptions): Promise<LogEntry[]> {
    this.ensureDb();
    let sql = QUERY_LOG_ENTRIES_SQL;
    const params: (string | number)[] = [];

    if (options.source) {
      sql += " AND source = ?";
      params.push(options.source);
    }
    if (options.level) {
      sql += " AND level = ?";
      params.push(options.level);
    }
    if (options.from) {
      sql += " AND timestamp >= ?";
      params.push(options.from);
    }
    if (options.to) {
      sql += " AND timestamp <= ?";
      params.push(options.to);
    }

    sql += ` ORDER BY timestamp ${options.order === "desc" ? "DESC" : "ASC"}`;

    if (options.limit !== undefined) {
      sql += " LIMIT ?";
      params.push(options.limit);
    }
    if (options.offset !== undefined) {
      sql += " OFFSET ?";
      params.push(options.offset);
    }

    const stmt = this.db!.prepare(sql);
    const rows = stmt.all(...params) as LogEntryRow[];
    return rows.map((row) => this.rowToLogEntry(row));
  }

  async count(options?: StorageQueryOptions): Promise<number> {
    this.ensureDb();
    let sql = COUNT_LOG_ENTRIES_SQL;
    const params: (string | number)[] = [];

    if (options) {
      if (options.source) {
        sql += " AND source = ?";
        params.push(options.source);
      }
      if (options.level) {
        sql += " AND level = ?";
        params.push(options.level);
      }
      if (options.from) {
        sql += " AND timestamp >= ?";
        params.push(options.from);
      }
      if (options.to) {
        sql += " AND timestamp <= ?";
        params.push(options.to);
      }
    }

    const stmt = this.db!.prepare(sql);
    const row = stmt.get(...params) as CountRow;
    return row.count;
  }

  async savePrintJob(job: PrintJob): Promise<void> {
    this.ensureDb();
    const now = new Date().toISOString();

    const saveTransaction = this.db!.transaction(() => {
      const insertJobStmt = this.db!.prepare(INSERT_PRINT_JOB_SQL);
      insertJobStmt.run(
        job.id,
        job.logEntry.id,
        job.formattedContent,
        job.createdAt.toISOString(),
        job.status,
        job.retryCount,
        job.error ?? null,
        now,
      );

      const insertHistoryStmt = this.db!.prepare(INSERT_STATUS_HISTORY_SQL);
      insertHistoryStmt.run(job.id, job.status, job.retryCount, job.error ?? null, now);
    });
    saveTransaction();
  }

  async updatePrintJobStatus(
    jobId: string,
    status: PrintJobStatus,
    retryCount: number,
    error?: string,
  ): Promise<void> {
    this.ensureDb();
    const now = new Date().toISOString();

    const updateTransaction = this.db!.transaction(() => {
      const updateStmt = this.db!.prepare(UPDATE_PRINT_JOB_STATUS_SQL);
      updateStmt.run(status, retryCount, error ?? null, now, jobId);

      const insertHistoryStmt = this.db!.prepare(INSERT_STATUS_HISTORY_SQL);
      insertHistoryStmt.run(jobId, status, retryCount, error ?? null, now);
    });
    updateTransaction();
  }

  async getPendingJobs(): Promise<PrintJob[]> {
    this.ensureDb();
    const stmt = this.db!.prepare(GET_PENDING_JOBS_SQL);
    const rows = stmt.all() as PendingJobRow[];
    return rows.map((row) => this.rowToPrintJob(row));
  }

  async getJobStatusHistory(jobId: string): Promise<PrintStatusRecord[]> {
    this.ensureDb();
    const stmt = this.db!.prepare(GET_STATUS_HISTORY_SQL);
    const rows = stmt.all(jobId) as StatusHistoryRow[];
    return rows.map((row) => ({
      status: row.status as PrintJobStatus,
      retryCount: row.retry_count,
      error: row.error ?? undefined,
      createdAt: row.created_at,
    }));
  }

  private ensureDb(): void {
    if (!this.db) {
      throw new Error("SqliteStorage not initialized");
    }
  }

  private rowToLogEntry(row: LogEntryRow): LogEntry {
    return {
      id: row.id,
      timestamp: row.timestamp,
      level: row.level,
      source: row.source,
      message: row.message,
      printed: row.printed === 1,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

  private rowToPrintJob(row: PendingJobRow): PrintJob {
    return {
      id: row.id,
      logEntry: {
        id: row.le_id,
        timestamp: row.le_timestamp,
        level: row.le_level,
        source: row.le_source,
        message: row.le_message,
        printed: row.le_printed === 1,
        metadata: row.le_metadata ? JSON.parse(row.le_metadata) : undefined,
      },
      formattedContent: row.formatted_content,
      createdAt: new Date(row.created_at),
      status: row.status as PrintJobStatus,
      retryCount: row.retry_count,
      error: row.error ?? undefined,
    };
  }
}
