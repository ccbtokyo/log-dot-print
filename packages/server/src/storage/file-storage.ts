import { appendFile, readFile, mkdir, stat } from 'fs/promises';
import { dirname } from 'path';
import type { LogEntry, StoragePlugin, StorageQueryOptions } from '@log-dot-print/core';

/**
 * File-based storage using JSONL (JSON Lines) format
 * Each line is a complete JSON object
 */
export class FileStorage implements StoragePlugin {
  readonly name = 'file-storage';
  private filePath: string;
  private writeBuffer: LogEntry[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private flushIntervalMs: number;

  constructor(filePath: string, options?: { flushIntervalMs?: number }) {
    this.filePath = filePath;
    this.flushIntervalMs = options?.flushIntervalMs ?? 1000;
  }

  async initialize(): Promise<void> {
    // Ensure directory exists
    await mkdir(dirname(this.filePath), { recursive: true });

    // Start flush interval
    this.flushInterval = setInterval(() => {
      this.flush().catch(console.error);
    }, this.flushIntervalMs);

    console.log(`[FileStorage] Initialized at ${this.filePath}`);
  }

  async shutdown(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    await this.flush();
    console.log('[FileStorage] Shutdown complete');
  }

  async save(entry: LogEntry): Promise<void> {
    this.writeBuffer.push(entry);
  }

  async saveBatch(entries: LogEntry[]): Promise<void> {
    this.writeBuffer.push(...entries);
  }

  private async flush(): Promise<void> {
    if (this.writeBuffer.length === 0) return;

    const toWrite = this.writeBuffer.splice(0, this.writeBuffer.length);
    const lines = toWrite.map((entry) => JSON.stringify(entry)).join('\n') + '\n';

    await appendFile(this.filePath, lines, 'utf-8');
  }

  async query(options: StorageQueryOptions): Promise<LogEntry[]> {
    // Flush pending writes first
    await this.flush();

    let entries: LogEntry[] = [];

    try {
      const content = await readFile(this.filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);

      entries = lines.map((line) => {
        try {
          return JSON.parse(line) as LogEntry;
        } catch {
          return null;
        }
      }).filter((e): e is LogEntry => e !== null);
    } catch (error) {
      // File may not exist yet
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    // Apply filters
    if (options.source) {
      entries = entries.filter((e) => e.source === options.source);
    }
    if (options.level) {
      entries = entries.filter((e) => e.level === options.level);
    }
    if (options.from) {
      const fromDate = new Date(options.from);
      entries = entries.filter((e) => new Date(e.timestamp) >= fromDate);
    }
    if (options.to) {
      const toDate = new Date(options.to);
      entries = entries.filter((e) => new Date(e.timestamp) <= toDate);
    }

    // Sort
    entries.sort((a, b) => {
      const comp = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      return options.order === 'desc' ? -comp : comp;
    });

    // Pagination
    const offset = options.offset ?? 0;
    const limit = options.limit ?? entries.length;
    entries = entries.slice(offset, offset + limit);

    return entries;
  }

  async count(options?: StorageQueryOptions): Promise<number> {
    if (!options || Object.keys(options).length === 0) {
      // Fast count without loading all entries
      try {
        const content = await readFile(this.filePath, 'utf-8');
        return content.trim().split('\n').filter(Boolean).length;
      } catch {
        return 0;
      }
    }

    const entries = await this.query({ ...options, limit: undefined, offset: undefined });
    return entries.length;
  }

  /**
   * Get the storage file path
   */
  getFilePath(): string {
    return this.filePath;
  }

  /**
   * Get file size in bytes
   */
  async getFileSize(): Promise<number> {
    try {
      const stats = await stat(this.filePath);
      return stats.size;
    } catch {
      return 0;
    }
  }
}
