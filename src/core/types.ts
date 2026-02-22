/**
 * Log entry received from UE
 */
export interface LogEntry {
  /** Unique identifier for this log entry */
  id: string;
  /** Timestamp when the log was created (ISO 8601) */
  timestamp: string;
  /** Log level/category */
  level: LogLevel;
  /** AI character or system that generated the log */
  source: string;
  /** Serialized payload to print */
  message: string;
  /** Whether the log has been printed */
  printed: boolean;
  /** Optional structured data */
  metadata?: Record<string, unknown>;
}

/**
 * Result of submitting a log entry for printing
 */
export interface LogSubmitResult {
  /** Whether the log entry was accepted into the print queue */
  accepted: boolean;
  /** Log entry identifier */
  id: string;
  /** Machine-readable error code when rejected */
  code?: string;
  /** Human-readable message when rejected */
  message?: string;
  /** Queue size at the time of submission */
  queueSize?: number;
}

export type LogLevel = string;

/**
 * Content type for print jobs
 */
export type PrintContentType = "text" | "json" | "html" | "image" | "pdf";

/**
 * Print job representing a formatted log ready for printing
 */
export interface PrintJob {
  /** Unique job identifier */
  id: string;
  /** Original log entry */
  logEntry: LogEntry;
  /** Formatted content ready for printing */
  formattedContent: string;
  /** Binary content for image printing */
  binaryContent?: Buffer;
  /** Content type (text, html, or image). Defaults to "text" for backward compatibility */
  contentType?: PrintContentType;
  /** Job creation timestamp */
  createdAt: Date;
  /** Job status */
  status: PrintJobStatus;
  /** Number of retry attempts */
  retryCount: number;
  /** Error message if failed */
  error?: string;
  /** Path to persisted print file (if enabled) */
  filePath?: string;
}

export type PrintJobStatus = "pending" | "printing" | "completed" | "failed";

/**
 * Queue state information for UI
 */
export interface QueueState {
  /** List of jobs in the queue */
  jobs: QueueJobInfo[];
  /** Whether queue processing is paused */
  isPaused: boolean;
  /** Whether the queue is currently processing */
  isProcessing: boolean;
  /** Total number of jobs in queue */
  totalSize: number;
}

/**
 * Job information for queue display
 */
export interface QueueJobInfo {
  /** Unique job identifier */
  id: string;
  /** Original log entry identifier */
  logEntryId: string;
  /** Source of the log entry */
  source: string;
  /** Truncated message preview (max 100 chars) */
  messagePreview: string;
  /** Job status */
  status: PrintJobStatus;
  /** Job creation timestamp (ISO 8601) */
  createdAt: string;
  /** Number of retry attempts */
  retryCount: number;
  /** Position in queue (0-indexed) */
  position: number;
}

/**
 * Printer status information
 */
export interface PrinterStatus {
  /** Whether the printer is connected */
  connected: boolean;
  /** Printer name/identifier */
  name: string;
  /** Printer type */
  type: PrinterType;
  /** Whether the printer is ready to accept jobs */
  ready: boolean;
  /** Additional status info */
  info?: string;
}

export type PrinterType = "cups" | "escpos" | "serial" | "mock" | "native" | "custom";

/**
 * Output format for log formatting
 */
export type OutputFormat = "text" | "json" | "html" | "replay";

/**
 * HTML format configuration
 */
export interface HtmlFormatConfig {
  outputFormat: "html";
  /** Custom HTML template path (optional) */
  template?: string;
  /** Custom CSS path (optional) */
  css?: string;
  /** Font family name to use */
  fontFamily?: string;
  /** Path to custom font file (.ttf, .otf, .woff, .woff2) */
  fontPath?: string;
  /** Base font size in pixels */
  fontSize?: number;
  /** Page width in mm (for PDF conversion) */
  pageWidth?: number;
  /** PDF paper size name (e.g. "A4", "Letter", "Custom.11x15in"). Overrides pageWidth when set. */
  pdfPaperSize?: string;
  /** Whether to include timestamp in output */
  includeTimestamp?: boolean;
  /** Whether to include source in output */
  includeSource?: boolean;
  /** Whether to include log level in output */
  includeLevel?: boolean;
  /** Max line width for text wrapping */
  maxLineWidth?: number;
}

/**
 * Replay format configuration for chat history formatting
 */
/** NPC 情報 */
export interface GameplayNpcInfo {
  replay_id: string;
  nickname: string;
}

/** 会話エントリ */
export interface GameplayDialogueEntry {
  role: "player" | "npc";
  text: string;
}

/** gameplay 内の NPC 会話ブロック */
export interface GameplayConversation {
  npc: GameplayNpcInfo;
  dialogue: GameplayDialogueEntry[];
}

/** respawn（プレイヤー）情報 */
export interface GameplayRespawnInfo {
  nickname: string;
  age: string;
  gender: string;
  complaint_troubles?: string;
  confession_true_feelings?: string;
  rediscovering_relief?: string;
  convai_key?: string;
  convai_backstory?: string;
}

/** gameplay ペイロード全体 */
export interface GameplayPayload {
  gameplay: GameplayConversation[];
  respawn: GameplayRespawnInfo;
}

export interface ReplayFormatConfig {
  outputFormat: "replay";
  /** Font family name to use */
  fontFamily?: string;
  /** Path to custom font file (.ttf, .otf, .woff, .woff2) */
  fontPath?: string;
  /** Base font size in pixels */
  fontSize?: number;
  /** Page width in mm (for PDF conversion) */
  pageWidth?: number;
  /** PDF paper size name (e.g. "A4", "Letter", "Custom.11x15in"). Overrides pageWidth when set. */
  pdfPaperSize?: string;
  /** Side margin in mm (for dot impact printer punch rails) */
  sideMargin?: number;
  /** Custom CSS (optional) */
  css?: string;
  /** Color for NPC messages */
  npcColor?: string;
  /** Color for Player messages */
  playerColor?: string;
}

/**
 * Discovered printer from OS printer discovery
 */
export interface DiscoveredPrinter {
  /** Printer name */
  name: string;
  /** Whether this is the default printer */
  isDefault: boolean;
  /** Printer status */
  status?: "idle" | "printing" | "paused" | "error";
  /** Whether the printer is ready to accept jobs */
  ready?: boolean;
  /** Printer description */
  description?: string;
}

/**
 * Image conversion configuration for dot impact printer support
 */
export interface ImageConversionConfig {
  /** Whether to enable HTML to image/PDF conversion */
  enabled: boolean;
  /** Output format: image (png/bmp) or pdf */
  format: "png" | "bmp" | "pdf";
  /** Image width in pixels (default: 2835px for 15" continuous paper printable area). Ignored for pdf. */
  width?: number;
  /** Whether to convert to grayscale for dot impact printers. Ignored for pdf. */
  grayscale?: boolean;
  /** Crop PDF height to fit content dynamically. Only applies when format is "pdf". */
  cropToContent?: boolean;
  /** Maximum PDF height in inches when cropToContent is enabled (default: paper height from pdfPaperSize) */
  pdfMaxHeightIn?: number;
}

/**
 * Configuration for the log printer system
 */
export interface SystemConfig {
  /** Server configuration */
  server: {
    port: number;
    host: string;
  };
  /** Printer plugin to use */
  printer: {
    type: PrinterType;
    options: Record<string, unknown>;
  };
  /** Print queue settings */
  queue: {
    maxSize: number;
    retryAttempts: number;
    retryDelayMs: number;
  };
  /** Log formatting options */
  format: TextFormatConfig | JsonFormatConfig | HtmlFormatConfig | ReplayFormatConfig;
  /** HTML to image conversion for dot impact printers */
  conversion?: ImageConversionConfig;
}

/**
 * Text format configuration
 */
export interface TextFormatConfig {
  outputFormat: "text";
  maxLineWidth: number;
  includeTimestamp: boolean;
  includeSource: boolean;
  includeLevel: boolean;
}

/**
 * JSON format configuration
 */
export interface JsonFormatConfig {
  outputFormat: "json";
  maxLineWidth: number;
  includeTimestamp?: boolean;
  includeSource?: boolean;
  includeLevel?: boolean;
}

/**
 * Printer settings for API response
 */
export interface PrinterSettings {
  /** Currently selected printer name (OS printer name) */
  currentPrinter: string | null;
  /** List of available printers discovered from OS */
  availablePrinters: DiscoveredPrinter[];
  /** Whether using the OS default printer */
  isDefault: boolean;
}

/** Response type for GET /api/papers */
export interface PaperListResponse {
  paperSizes: string[];
  source: "dynamic" | "fallback";
  printerName: string | null;
}

/** Response type for GET /api/settings/paper */
export interface PaperSettings {
  currentPaperSize: string | null;
  isDefault: boolean;
}
