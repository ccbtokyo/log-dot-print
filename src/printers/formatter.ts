import type {
  LogEntry,
  LogFormatterPlugin,
  SystemConfig,
  TypedEventEmitter,
} from "../core/index.js";
import { formatTimestamp, wordWrap } from "../core/index.js";

type OutputFormat = "text" | "json";

interface FormatterConfig {
  outputFormat: OutputFormat;
  maxLineWidth: number;
  includeTimestamp: boolean;
  includeSource: boolean;
  includeLevel: boolean;
}

/**
 * Default log formatter for printing
 */
export class DefaultFormatter implements LogFormatterPlugin {
  readonly name = "default-formatter";
  readonly version = "1.0.0";

  private config: FormatterConfig = {
    outputFormat: "text",
    maxLineWidth: 80,
    includeTimestamp: true,
    includeSource: true,
    includeLevel: false,
  };

  async initialize(eventBus: TypedEventEmitter, config: SystemConfig): Promise<void> {
    this.config = {
      outputFormat: config.format?.outputFormat ?? "text",
      maxLineWidth: config.format?.maxLineWidth ?? 80,
      includeTimestamp: config.format?.includeTimestamp ?? true,
      includeSource: config.format?.includeSource ?? true,
      includeLevel: config.format?.includeLevel ?? false,
    };
  }

  async shutdown(): Promise<void> {
    // Nothing to clean up
  }

  /**
   * Format a log entry for printing
   */
  format(entry: LogEntry): string {
    if (this.config.outputFormat === "json") {
      return this.formatAsJson(entry);
    }
    return this.formatAsText(entry);
  }

  /**
   * Format as pretty-printed JSON
   * entry.message contains the original data as a JSON string
   */
  private formatAsJson(entry: LogEntry): string {
    const { maxLineWidth } = this.config;

    // Parse the original data from entry.message (which is JSON-stringified)
    let originalData: unknown;
    try {
      originalData = JSON.parse(entry.message);
    } catch {
      // If parsing fails, use the message as-is
      originalData = entry.message;
    }

    // Pretty print with indentation
    const jsonStr = JSON.stringify(originalData, null, 2);
    const lines = jsonStr.split("\n");

    // Wrap long lines if needed
    const wrappedLines: string[] = [];
    for (const line of lines) {
      if (line.length > maxLineWidth) {
        // For JSON, we just truncate long string values with indication
        wrappedLines.push(line.slice(0, maxLineWidth - 3) + "...");
      } else {
        wrappedLines.push(line);
      }
    }

    return wrappedLines.join("\n") + "\n";
  }

  /**
   * Format as human-readable text
   */
  private formatAsText(entry: LogEntry): string {
    const lines: string[] = [];
    const { maxLineWidth, includeTimestamp, includeSource, includeLevel } = this.config;

    // Build header line
    const headerParts: string[] = [];

    if (includeTimestamp) {
      headerParts.push(`[${formatTimestamp(entry.timestamp)}]`);
    }

    if (includeSource) {
      headerParts.push(`<${entry.source}>`);
    }

    if (includeLevel) {
      headerParts.push(`(${entry.level.toUpperCase()})`);
    }

    if (headerParts.length > 0) {
      const header = headerParts.join(" ");
      lines.push(header);
      lines.push("-".repeat(Math.min(header.length, maxLineWidth)));
    }

    // Wrap and add message
    const messageLines = wordWrap(entry.message, maxLineWidth);
    lines.push(...messageLines);

    // Add metadata if present
    if (entry.metadata && Object.keys(entry.metadata).length > 0) {
      lines.push("");
      lines.push("metadata:");
      for (const [key, value] of Object.entries(entry.metadata)) {
        const metaLine = `  ${key}: ${JSON.stringify(value)}`;
        const wrappedMeta = wordWrap(metaLine, maxLineWidth);
        lines.push(...wrappedMeta);
      }
    }

    // Add separator
    lines.push("");
    lines.push("=".repeat(maxLineWidth));
    lines.push("");

    return lines.join("\n");
  }
}
