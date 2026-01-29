import type {
  LogEntry,
  LogFormatterPlugin,
  SystemConfig,
  TypedEventEmitter,
} from "../core/index.js";
import { formatTimestamp, wordWrap } from "../core/index.js";

interface FormatterConfig {
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
    maxLineWidth: 80,
    includeTimestamp: true,
    includeSource: true,
    includeLevel: false,
  };

  async initialize(eventBus: TypedEventEmitter, config: SystemConfig): Promise<void> {
    this.config = {
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
