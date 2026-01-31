/**
 * SQLite schema definitions for log-dot-print
 * @see docs/architecture.md for design details
 */

export const SCHEMA_VERSION = 3;

/**
 * SQL statements for creating tables
 */
export const CREATE_TABLES_SQL = `
-- LogEntry table
CREATE TABLE IF NOT EXISTS log_entries (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  level TEXT NOT NULL,
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  printed INTEGER NOT NULL DEFAULT 0,
  metadata TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- PrintJob table
CREATE TABLE IF NOT EXISTS print_jobs (
  id TEXT PRIMARY KEY,
  log_entry_id TEXT NOT NULL,
  formatted_content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  file_path TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (log_entry_id) REFERENCES log_entries(id)
);

-- PrintStatusHistory table (records all status transitions)
CREATE TABLE IF NOT EXISTS print_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  print_job_id TEXT NOT NULL,
  status TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (print_job_id) REFERENCES print_jobs(id)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_log_entries_timestamp ON log_entries(timestamp);
CREATE INDEX IF NOT EXISTS idx_log_entries_source ON log_entries(source);
CREATE INDEX IF NOT EXISTS idx_log_entries_printed ON log_entries(printed);
CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs(status);
CREATE INDEX IF NOT EXISTS idx_print_jobs_log_entry_id ON print_jobs(log_entry_id);
CREATE INDEX IF NOT EXISTS idx_status_history_job ON print_status_history(print_job_id);

-- Settings table (key-value store for application settings)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`;

/**
 * SQL for inserting a log entry
 */
export const INSERT_LOG_ENTRY_SQL = `
INSERT INTO log_entries (id, timestamp, level, source, message, printed, metadata, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`;

/**
 * SQL for updating log entry printed status
 */
export const UPDATE_LOG_ENTRY_PRINTED_SQL = `
UPDATE log_entries SET printed = ? WHERE id = ?
`;

/**
 * SQL for inserting a print job
 */
export const INSERT_PRINT_JOB_SQL = `
INSERT INTO print_jobs (id, log_entry_id, formatted_content, created_at, status, retry_count, error, file_path, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

/**
 * SQL for updating print job status
 */
export const UPDATE_PRINT_JOB_STATUS_SQL = `
UPDATE print_jobs SET status = ?, retry_count = ?, error = ?, updated_at = ? WHERE id = ?
`;

/**
 * SQL for inserting status history record
 */
export const INSERT_STATUS_HISTORY_SQL = `
INSERT INTO print_status_history (print_job_id, status, retry_count, error, created_at)
VALUES (?, ?, ?, ?, ?)
`;

/**
 * SQL for getting pending jobs (for queue restoration)
 */
export const GET_PENDING_JOBS_SQL = `
SELECT
  pj.id,
  pj.log_entry_id,
  pj.formatted_content,
  pj.created_at,
  pj.status,
  pj.retry_count,
  pj.error,
  pj.file_path,
  le.id as le_id,
  le.timestamp as le_timestamp,
  le.level as le_level,
  le.source as le_source,
  le.message as le_message,
  le.printed as le_printed,
  le.metadata as le_metadata
FROM print_jobs pj
JOIN log_entries le ON pj.log_entry_id = le.id
WHERE pj.status IN ('pending', 'printing')
ORDER BY pj.created_at ASC
`;

/**
 * SQL for getting status history of a job
 */
export const GET_STATUS_HISTORY_SQL = `
SELECT status, retry_count, error, created_at
FROM print_status_history
WHERE print_job_id = ?
ORDER BY created_at ASC
`;

/**
 * SQL for querying log entries with filters
 */
export const QUERY_LOG_ENTRIES_SQL = `
SELECT id, timestamp, level, source, message, printed, metadata, created_at
FROM log_entries
WHERE 1=1
`;

/**
 * SQL for counting log entries
 */
export const COUNT_LOG_ENTRIES_SQL = `
SELECT COUNT(*) as count FROM log_entries WHERE 1=1
`;

/**
 * SQL for querying print jobs with filters (base query)
 */
export const QUERY_PRINT_JOBS_SQL = `
SELECT
  pj.id,
  pj.log_entry_id,
  pj.formatted_content,
  pj.created_at,
  pj.status,
  pj.retry_count,
  pj.error,
  pj.file_path,
  pj.updated_at,
  le.id as le_id,
  le.timestamp as le_timestamp,
  le.level as le_level,
  le.source as le_source,
  le.message as le_message,
  le.printed as le_printed,
  le.metadata as le_metadata
FROM print_jobs pj
JOIN log_entries le ON pj.log_entry_id = le.id
WHERE 1=1
`;

/**
 * SQL for counting print jobs with filters (base query)
 */
export const COUNT_PRINT_JOBS_SQL = `
SELECT COUNT(*) as count FROM print_jobs WHERE 1=1
`;

/**
 * SQL for updating print job file path
 */
export const UPDATE_PRINT_JOB_FILE_PATH_SQL = `
UPDATE print_jobs SET file_path = ?, updated_at = ? WHERE id = ?
`;

/**
 * SQL for getting a single print job by ID
 */
export const GET_PRINT_JOB_BY_ID_SQL = `
SELECT
  pj.id,
  pj.log_entry_id,
  pj.formatted_content,
  pj.created_at,
  pj.status,
  pj.retry_count,
  pj.error,
  pj.file_path,
  pj.updated_at,
  le.id as le_id,
  le.timestamp as le_timestamp,
  le.level as le_level,
  le.source as le_source,
  le.message as le_message,
  le.printed as le_printed,
  le.metadata as le_metadata
FROM print_jobs pj
JOIN log_entries le ON pj.log_entry_id = le.id
WHERE pj.id = ?
`;

/**
 * Migration SQL for schema version 2 (add file_path column)
 */
export const MIGRATE_V1_TO_V2_SQL = `
ALTER TABLE print_jobs ADD COLUMN file_path TEXT
`;

/**
 * Migration SQL for schema version 3 (add settings table)
 */
export const MIGRATE_V2_TO_V3_SQL = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
)
`;

/**
 * SQL for getting a setting by key
 */
export const GET_SETTING_SQL = `
SELECT value FROM settings WHERE key = ?
`;

/**
 * SQL for setting/updating a setting (upsert)
 */
export const SET_SETTING_SQL = `
INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
`;

/**
 * SQL for deleting a setting
 */
export const DELETE_SETTING_SQL = `
DELETE FROM settings WHERE key = ?
`;

/**
 * SQL for getting all settings
 */
export const GET_ALL_SETTINGS_SQL = `
SELECT key, value FROM settings ORDER BY key
`;
