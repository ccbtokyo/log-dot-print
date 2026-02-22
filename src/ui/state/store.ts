/**
 * Simple reactive store for UI state
 */

import type {
  QueueState,
  QueueJobInfo,
  TabType,
  HistoryState,
  PaginationInfo,
  PrinterSettingsState,
  PaperSettingsState,
} from "../types.js";
import type { ConnectionState } from "../services/ws-client.js";

export interface AppState {
  queue: QueueState;
  connection: ConnectionState;
  selectedJobId: string | null;
  error: string | null;
  activeTab: TabType;
  history: HistoryState;
  printerSettings: PrinterSettingsState;
  paperSettings: PaperSettingsState;
}

export type StateListener = (state: AppState) => void;

const initialQueueState: QueueState = {
  jobs: [],
  isPaused: false,
  isProcessing: false,
  totalSize: 0,
};

const initialHistoryState: HistoryState = {
  jobs: [],
  pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
  isLoading: false,
  error: null,
};

const initialPrinterSettings: PrinterSettingsState = {
  currentPrinter: null,
  availablePrinters: [],
  isDefault: true,
  isLoading: false,
  error: null,
};

const initialPaperSettings: PaperSettingsState = {
  currentPaperSize: null,
  availablePaperSizes: [],
  source: "fallback",
  isDefault: true,
  isLoading: false,
  error: null,
};

export class Store {
  private state: AppState = {
    queue: initialQueueState,
    connection: "disconnected",
    selectedJobId: null,
    error: null,
    activeTab: "queue",
    history: initialHistoryState,
    printerSettings: initialPrinterSettings,
    paperSettings: initialPaperSettings,
  };

  private listeners = new Set<StateListener>();

  getState(): AppState {
    return this.state;
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    // Immediately call with current state
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  setQueueState(queue: QueueState): void {
    this.state = { ...this.state, queue };
    this.notify();
  }

  setConnectionState(connection: ConnectionState): void {
    this.state = { ...this.state, connection };
    this.notify();
  }

  setSelectedJob(jobId: string | null): void {
    this.state = { ...this.state, selectedJobId: jobId };
    this.notify();
  }

  setError(error: string | null): void {
    this.state = { ...this.state, error };
    this.notify();
  }

  clearError(): void {
    this.setError(null);
  }

  setActiveTab(tab: TabType): void {
    this.state = { ...this.state, activeTab: tab };
    this.notify();
  }

  setHistoryState(history: HistoryState): void {
    this.state = { ...this.state, history };
    this.notify();
  }

  setHistoryLoading(isLoading: boolean): void {
    this.state = {
      ...this.state,
      history: { ...this.state.history, isLoading },
    };
    this.notify();
  }

  setHistoryError(error: string | null): void {
    this.state = {
      ...this.state,
      history: { ...this.state.history, error, isLoading: false },
    };
    this.notify();
  }

  updateHistoryPagination(pagination: PaginationInfo): void {
    this.state = {
      ...this.state,
      history: { ...this.state.history, pagination },
    };
    this.notify();
  }

  getSelectedJob(): QueueJobInfo | null {
    if (!this.state.selectedJobId) {
      return null;
    }
    return this.state.queue.jobs.find((job) => job.id === this.state.selectedJobId) ?? null;
  }

  setPrinterSettings(printerSettings: PrinterSettingsState): void {
    this.state = { ...this.state, printerSettings };
    this.notify();
  }

  setPrinterLoading(isLoading: boolean): void {
    this.state = {
      ...this.state,
      printerSettings: { ...this.state.printerSettings, isLoading },
    };
    this.notify();
  }

  setPrinterError(error: string | null): void {
    this.state = {
      ...this.state,
      printerSettings: { ...this.state.printerSettings, error, isLoading: false },
    };
    this.notify();
  }

  setCurrentPrinter(printerName: string | null): void {
    this.state = {
      ...this.state,
      printerSettings: {
        ...this.state.printerSettings,
        currentPrinter: printerName,
        isDefault: printerName === null,
      },
    };
    this.notify();
  }

  setPaperSettings(paperSettings: PaperSettingsState): void {
    this.state = { ...this.state, paperSettings };
    this.notify();
  }

  setPaperLoading(isLoading: boolean): void {
    this.state = {
      ...this.state,
      paperSettings: { ...this.state.paperSettings, isLoading },
    };
    this.notify();
  }

  setPaperError(error: string | null): void {
    this.state = {
      ...this.state,
      paperSettings: { ...this.state.paperSettings, error, isLoading: false },
    };
    this.notify();
  }

  setCurrentPaperSize(paperSize: string | null): void {
    this.state = {
      ...this.state,
      paperSettings: {
        ...this.state.paperSettings,
        currentPaperSize: paperSize,
        isDefault: paperSize === null,
      },
    };
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch (error) {
        console.error("[Store] Listener error:", error);
      }
    }
  }
}

// Global store instance
export const store = new Store();
