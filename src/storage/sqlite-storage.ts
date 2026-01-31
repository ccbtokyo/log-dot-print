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
  PrintJobQueryOptions,
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
  QUERY_PRINT_JOBS_SQL,
  COUNT_PRINT_JOBS_SQL,
  UPDATE_PRINT_JOB_FILE_PATH_SQL,
  GET_PRINT_JOB_BY_ID_SQL,
  MIGRATE_V1_TO_V2_SQL,
  MIGRATE_V2_TO_V3_SQL,
  GET_SETTING_SQL,
  SET_SETTING_SQL,
  DELETE_SETTING_SQL,
  GET_ALL_SETTINGS_SQL,
  SCHEMA_VERSION,
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
  file_path: string | null;
  le_id: string;
  le_timestamp: string;
  le_level: string;
  le_source: string;
  le_message: string;
  le_printed: number;
  le_metadata: string | null;
}

interface PrintJobRow extends PendingJobRow {
  updated_at: string;
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
    this.migrateSchema();
    console.log(`[SqliteStorage] Initialized at ${this.dbPath} (schema v${SCHEMA_VERSION})`);
  }

  private migrateSchema(): void {
    // Check if file_path column exists in print_jobs table
    const tableInfo = this.db!.prepare("PRAGMA table_info(print_jobs)").all() as Array<{
      name: string;
    }>;
    const hasFilePath = tableInfo.some((col) => col.name === "file_path");

    if (!hasFilePath) {
      console.log("[SqliteStorage] Migrating schema to v2 (adding file_path column)");
      this.db!.exec(MIGRATE_V1_TO_V2_SQL);
    }

    // Check if settings table exists
    const tables = this.db!.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='settings'",
    ).all() as Array<{ name: string }>;
    const hasSettingsTable = tables.length > 0;

    if (!hasSettingsTable) {
      console.log("[SqliteStorage] Migrating schema to v3 (adding settings table)");
      this.db!.exec(MIGRATE_V2_TO_V3_SQL);
    }
  }

  async shutdown(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    console.log("[SqliteStorage] Shutdown complete");
  }

  // ==================== Settings Methods ====================

  /**
   * Get a setting value by key
   * @returns The setting value, or null if not found
   */
  async getSetting(key: string): Promise<string | null> {
    this.ensureDb();
    const row = this.db!.prepare(GET_SETTING_SQL).get(key) as { value: string } | null;
    return row?.value ?? null;
  }

  /**
   * Set a setting value (insert or update)
   */
  async setSetting(key: string, value: string): Promise<void> {
    this.ensureDb();
    this.db!.prepare(SET_SETTING_SQL).run(key, value);
  }

  /**
   * Delete a setting by key
   */
  async deleteSetting(key: string): Promise<void> {
    this.ensureDb();
    this.db!.prepare(DELETE_SETTING_SQL).run(key);
  }

  /**
   * Get all settings as a key-value object
   */
  async getAllSettings(): Promise<Record<string, string>> {
    this.ensureDb();
    const rows = this.db!.prepare(GET_ALL_SETTINGS_SQL).all() as Array<{
      key: string;
      value: string;
    }>;
    const settings: Record<string, string> = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    return settings;
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
        job.filePath ?? null,
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

  async queryPrintJobs(options: PrintJobQueryOptions): Promise<PrintJob[]> {
    this.ensureDb();
    let sql = QUERY_PRINT_JOBS_SQL;
    const params: (string | number)[] = [];

    if (options.status !== undefined) {
      const statuses = Array.isArray(options.status) ? options.status : [options.status];
      const placeholders = statuses.map(() => "?").join(", ");
      sql += ` AND pj.status IN (${placeholders})`;
      params.push(...statuses);
    }
    if (options.from) {
      sql += " AND pj.created_at >= ?";
      params.push(options.from);
    }
    if (options.to) {
      sql += " AND pj.created_at <= ?";
      params.push(options.to);
    }

    sql += ` ORDER BY pj.created_at ${options.order === "asc" ? "ASC" : "DESC"}`;

    if (options.limit !== undefined) {
      sql += " LIMIT ?";
      params.push(options.limit);
    }
    if (options.offset !== undefined) {
      sql += " OFFSET ?";
      params.push(options.offset);
    }

    const stmt = this.db!.prepare(sql);
    const rows = stmt.all(...params) as PrintJobRow[];
    return rows.map((row) => this.rowToPrintJob(row));
  }

  async countPrintJobs(options?: PrintJobQueryOptions): Promise<number> {
    this.ensureDb();
    let sql = COUNT_PRINT_JOBS_SQL;
    const params: (string | number)[] = [];

    if (options) {
      if (options.status !== undefined) {
        const statuses = Array.isArray(options.status) ? options.status : [options.status];
        const placeholders = statuses.map(() => "?").join(", ");
        sql += ` AND status IN (${placeholders})`;
        params.push(...statuses);
      }
      if (options.from) {
        sql += " AND created_at >= ?";
        params.push(options.from);
      }
      if (options.to) {
        sql += " AND created_at <= ?";
        params.push(options.to);
      }
    }

    const stmt = this.db!.prepare(sql);
    const row = stmt.get(...params) as CountRow;
    return row.count;
  }

  async updatePrintJobFilePath(jobId: string, filePath: string): Promise<void> {
    this.ensureDb();
    const now = new Date().toISOString();
    const stmt = this.db!.prepare(UPDATE_PRINT_JOB_FILE_PATH_SQL);
    stmt.run(filePath, now, jobId);
  }

  async getPrintJobById(jobId: string): Promise<PrintJob | null> {
    this.ensureDb();
    const stmt = this.db!.prepare(GET_PRINT_JOB_BY_ID_SQL);
    const row = stmt.get(jobId) as PrintJobRow | undefined;
    if (!row) {
      return null;
    }
    return this.rowToPrintJob(row);
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
      filePath: row.file_path ?? undefined,
    };
  }
}
