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
    typeof entry.message === "string"
  );
}

/**
 * Parse a log entry from JSON, assigning ID if missing
 */
export function parseLogEntry(data: unknown): LogEntry | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const raw = data as Record<string, unknown>;

  // Required fields
  if (typeof raw.message !== "string") {
    return null;
  }

  return {
    id: typeof raw.id === "string" ? raw.id : generateId(),
    timestamp: typeof raw.timestamp === "string" ? raw.timestamp : new Date().toISOString(),
    level: isValidLogLevel(raw.level) ? raw.level : "info",
    source: typeof raw.source === "string" ? raw.source : "unknown",
    message: raw.message,
    metadata:
      typeof raw.metadata === "object" ? (raw.metadata as Record<string, unknown>) : undefined,
  };
}

function isValidLogLevel(level: unknown): level is LogEntry["level"] {
  return (
    level === "debug" ||
    level === "info" ||
    level === "action" ||
    level === "thought" ||
    level === "emotion" ||
    level === "error"
  );
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
