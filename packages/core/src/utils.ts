import { randomUUID } from "crypto";
import type { LogEntry, PrintJob } from "./types.js";

/**
 * Generate a unique ID
 */
export function generateId(): string {
  return randomUUID();
}

/**
 * Create a print job from a log entry
 */
export function createPrintJob(entry: LogEntry, formattedContent: string): PrintJob {
  return {
    id: generateId(),
    logEntry: entry,
    formattedContent,
    createdAt: new Date(),
    status: "pending",
    retryCount: 0,
  };
}

/**
 * Validate a log entry
 */
export function validateLogEntry(data: unknown): data is LogEntry {
  if (typeof data !== "object" || data === null) {
    return false;
  }

  const entry = data as Record<string, unknown>;

  return (
    typeof entry.id === "string" &&
    typeof entry.timestamp === "string" &&
    typeof entry.level === "string" &&
    typeof entry.source === "string" &&
    typeof entry.message === "string" &&
    typeof entry.printed === "boolean"
  );
}

/**
 * Parse a log entry from JSON, assigning ID if missing
 */
export interface ParseLogEntryOptions {
  source?: string;
  level?: string;
}

export function parseLogEntry(data: unknown, options: ParseLogEntryOptions = {}): LogEntry | null {
  if (typeof data === "undefined") {
    return null;
  }

  const message = normalizeLogMessage(data);
  if (message === null) {
    return null;
  }

  const source = options.source?.trim() ? options.source.trim() : "unknown";
  const level = options.level?.trim() ? options.level.trim() : "info";

  return {
    id: generateId(),
    timestamp: new Date().toISOString(),
    level,
    source,
    message,
    printed: false,
  };
}

function normalizeLogMessage(message: unknown): string | null {
  if (typeof message === "undefined") {
    return null;
  }

  try {
    const serialized = JSON.stringify(message);
    return typeof serialized === "string" ? serialized : null;
  } catch {
    return null;
  }
}

/**
 * Format timestamp for display
 */
export function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/**
 * Truncate text to max width
 */
export function truncate(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) {
    return text;
  }
  return text.slice(0, maxWidth - 3) + "...";
}

/**
 * Word wrap text to max width
 */
export function wordWrap(text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  const words = text.split(/\s+/);
  let currentLine = "";

  for (const word of words) {
    if (currentLine.length + word.length + 1 <= maxWidth) {
      currentLine += (currentLine ? " " : "") + word;
    } else {
      if (currentLine) {
        lines.push(currentLine);
      }
      // Handle words longer than maxWidth
      if (word.length > maxWidth) {
        let remaining = word;
        while (remaining.length > maxWidth) {
          lines.push(remaining.slice(0, maxWidth));
          remaining = remaining.slice(maxWidth);
        }
        currentLine = remaining;
      } else {
        currentLine = word;
      }
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}
