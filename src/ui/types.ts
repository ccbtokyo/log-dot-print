/**
 * Type definitions for the UI package
 */

export type PrintJobStatus = "pending" | "printing" | "completed" | "failed";

export type TabType = "queue" | "history";

export interface QueueJobInfo {
  id: string;
  logEntryId: string;
  source: string;
  messagePreview: string;
  status: PrintJobStatus;
  createdAt: string;
  retryCount: number;
  position: number;
}

export interface QueueState {
  jobs: QueueJobInfo[];
  isPaused: boolean;
  isProcessing: boolean;
  totalSize: number;
}

export interface PrintJob {
  id: string;
  logEntry: {
    id: string;
    timestamp: string;
    level: string;
    source: string;
    message: string;
    printed: boolean;
    metadata?: Record<string, unknown>;
  };
  formattedContent: string;
  createdAt: string;
  status: PrintJobStatus;
  retryCount: number;
  error?: string;
}

export interface JobPreview {
  id: string;
  formattedContent: string;
}

export interface HistoryJobInfo {
  id: string;
  logEntryId: string;
  source: string;
  messagePreview: string;
  status: PrintJobStatus;
  createdAt: string;
  updatedAt: string;
  retryCount: number;
  error?: string;
  hasFile?: boolean;
}

export interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface HistoryResponse {
  jobs: HistoryJobInfo[];
  pagination: PaginationInfo;
}

export interface HistoryState {
  jobs: HistoryJobInfo[];
  pagination: PaginationInfo;
  isLoading: boolean;
  error: string | null;
}

/**
 * WebSocket message types
 */
export type ClientMessage =
  | { type: "subscribe" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "skip"; jobId: string }
  | { type: "prioritize"; jobId: string }
  | { type: "clear" }
  | { type: "ping" };

export type ServerMessage =
  | { type: "connected"; message: string }
  | { type: "queue:state"; payload: QueueState }
  | { type: "job:started"; payload: PrintJob }
  | { type: "job:completed"; payload: PrintJob }
  | { type: "job:failed"; payload: { job: PrintJob; error: string } }
  | { type: "job:skipped"; payload: PrintJob }
  | { type: "job:prioritized"; payload: { job: PrintJob; newPosition: number } }
  | { type: "queue:paused" }
  | { type: "queue:resumed" }
  | { type: "pong" }
  | { type: "error"; message: string };
