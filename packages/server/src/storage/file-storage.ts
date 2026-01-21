import { appendFile, readFile, mkdir, stat, writeFile } from "fs/promises";
import { dirname } from "path";
import type { LogEntry, StoragePlugin, StorageQueryOptions } from "@log-dot-print/core";

/**
 * File-based storage using JSONL (JSON Lines) format
 * Each line is a complete JSON object
 */
export class FileStorage implements StoragePlugin {
  readonly name = "file-storage";
  private filePath: string;
  private writeBuffer: LogEntry[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private flushIntervalMs: number;
  private flushQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string, options?: { flushIntervalMs?: number }) {
    this.filePath = filePath;
    this.flushIntervalMs = options?.flushIntervalMs ?? 1000;
  }

  async initialize(): Promise<void> {
    // Ensure directory exists
    await mkdir(dirname(this.filePath), { recursive: true });

    // Start flush interval
    if (this.flushIntervalMs > 0) {
      this.flushInterval = setInterval(() => {
        this.enqueueFlush().catch(console.error);
      }, this.flushIntervalMs);
    }

    console.log(`[FileStorage] Initialized at ${this.filePath}`);
  }

  async shutdown(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    await this.enqueueFlush();
    console.log("[FileStorage] Shutdown complete");
  }

  async save(entry: LogEntry): Promise<void> {
    if (typeof entry.printed !== "boolean") {
      entry.printed = false;
    }
    this.writeBuffer.push(entry);
  }

  async saveBatch(entries: LogEntry[]): Promise<void> {
    for (const entry of entries) {
      if (typeof entry.printed !== "boolean") {
        entry.printed = false;
      }
    }
    this.writeBuffer.push(...entries);
  }

  async markPrinted(id: string): Promise<boolean> {
    const task = async (): Promise<boolean> => {
      let updated = false;

      for (const entry of this.writeBuffer) {
        if (entry.id === id) {
          entry.printed = true;
          updated = true;
        }
      }

      if (updated) {
        await this.flush();
        return true;
      }

      await this.flush();

      let content = "";
      try {
        content = await readFile(this.filePath, "utf-8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return false;
        }
        throw error;
      }

      const lines = content.trim().split("\n").filter(Boolean);
      if (lines.length === 0) {
        return false;
      }

      const updatedLines: string[] = [];
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as LogEntry;
          if (entry.id === id) {
            entry.printed = true;
            updated = true;
          } else if (typeof entry.printed !== "boolean") {
            entry.printed = false;
          }
          updatedLines.push(JSON.stringify(entry));
        } catch {
          updatedLines.push(line);
        }
      }

      if (updated) {
        await writeFile(this.filePath, updatedLines.join("\n") + "\n", "utf-8");
      }

      return updated;
    };

    const next = this.flushQueue.then(() => task());
    this.flushQueue = next.then(() => {}).catch(() => {});
    return next;
  }

  private enqueueFlush(): Promise<void> {
    const next = this.flushQueue.then(() => this.flush());
    this.flushQueue = next.catch(() => {});
    return next;
  }

  private async flush(): Promise<void> {
    if (this.writeBuffer.length === 0) return;

    const toWrite = this.writeBuffer.splice(0, this.writeBuffer.length);
    const lines = toWrite.map((entry) => JSON.stringify(entry)).join("\n") + "\n";

    await appendFile(this.filePath, lines, "utf-8");
  }

  async query(options: StorageQueryOptions): Promise<LogEntry[]> {
    // Flush pending writes first
    await this.enqueueFlush();

    let entries: LogEntry[] = [];

    try {
      const content = await readFile(this.filePath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);

      entries = lines
        .map((line) => {
          try {
            const entry = JSON.parse(line) as LogEntry;
            if (typeof entry.printed !== "boolean") {
              entry.printed = false;
            }
            return entry;
          } catch {
            return null;
          }
        })
        .filter((e): e is LogEntry => e !== null);
    } catch (error) {
      // File may not exist yet
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
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
      return options.order === "desc" ? -comp : comp;
    });

    // Pagination
    const offset = options.offset ?? 0;
    const limit = options.limit ?? entries.length;
    entries = entries.slice(offset, offset + limit);

    return entries;
  }

  async count(options?: StorageQueryOptions): Promise<number> {
    await this.enqueueFlush();
    if (!options || Object.keys(options).length === 0) {
      // Fast count without loading all entries
      try {
        const content = await readFile(this.filePath, "utf-8");
        return content.trim().split("\n").filter(Boolean).length;
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
