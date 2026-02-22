/**
 * Main entry point for the UI application
 */

import { html, render, nothing } from "lit-html";
import { store, type AppState } from "./state/store.js";
import { WSClient } from "./services/ws-client.js";
import { ApiClient } from "./services/api-client.js";
import { renderStatusBar, type StatusBarCallbacks } from "./components/status-bar.js";
import { renderControls, type ControlsHandlers } from "./components/controls.js";
import { renderQueueList } from "./components/queue-list.js";
import { renderJobPreview, type PreviewState } from "./components/job-preview.js";
import { renderTabs, type TabsHandlers } from "./components/tabs.js";
import { renderHistoryTable } from "./components/history-table.js";
import { renderPagination, type PaginationHandlers } from "./components/pagination.js";
import type { ServerMessage, TabType } from "./types.js";

// Initialize clients
const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const wsUrl = `${wsProtocol}//${window.location.host}/ws/ui`;
const wsClient = new WSClient({ url: wsUrl });
const apiClient = new ApiClient();

// Preview state
let previewState: PreviewState = {
  isLoading: false,
  preview: null,
  error: null,
};

// Request IDs for race condition prevention
let previewRequestId = 0;
let historyRequestId = 0;
let paperSettingsRequestId = 0;
let paperSettingsAbortController: AbortController | null = null;

// Helper function for DOM element retrieval with null check
function getElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Required DOM element not found: #${id}`);
  }
  return element;
}

// Get DOM elements
const statusBarEl = getElement("status-bar");
const tabsEl = getElement("tabs");
const controlsEl = getElement("controls");
const errorBannerEl = getElement("error-banner");
const queueViewEl = getElement("queue-view");
const queueListEl = getElement("queue-list");
const historyViewEl = getElement("history-view");
const historyTableEl = getElement("history-table");
const paginationEl = getElement("pagination");
const previewModalEl = getElement("preview-modal");

// Tab handlers
const tabHandlers: TabsHandlers = {
  onTabChange: (tab: TabType) => {
    store.setActiveTab(tab);
    if (tab === "history") {
      loadHistory(1);
    }
  },
};

// Control handlers
const controlHandlers: ControlsHandlers = {
  onPause: () => wsClient.pause(),
  onResume: () => wsClient.resume(),
  onClear: () => {
    if (window.confirm("Are you sure you want to clear all jobs from the queue?")) {
      wsClient.clear();
    }
  },
};

// Job card handlers
const jobCardHandlers = {
  onSkip: (id: string) => {
    if (window.confirm("Are you sure you want to skip this job?")) {
      wsClient.skip(id);
    }
  },
  onPrioritize: (id: string) => wsClient.prioritize(id),
  onSelect: (id: string) => {
    const currentSelected = store.getState().selectedJobId;
    if (currentSelected === id) {
      store.setSelectedJob(null);
    } else {
      store.setSelectedJob(id);
      loadPreview(id);
    }
  },
};

// Preview handlers
const previewHandlers = {
  onClose: () => {
    store.setSelectedJob(null);
    previewState = { isLoading: false, preview: null, error: null };
    renderPreview();
  },
  onSkip: (id: string) => {
    if (window.confirm("Are you sure you want to skip this job?")) {
      wsClient.skip(id);
      store.setSelectedJob(null);
    }
  },
  onPrioritize: (id: string) => {
    wsClient.prioritize(id);
  },
};

// Pagination handlers
const paginationHandlers: PaginationHandlers = {
  onPageChange: (page: number) => {
    loadHistory(page);
  },
};

// Status bar handlers (for printer and paper selectors)
const statusBarCallbacks: StatusBarCallbacks = {
  onPrinterChange: async (printerName: string | null) => {
    store.setPrinterLoading(true);
    try {
      await apiClient.updatePrinterSettings(printerName);
      store.setCurrentPrinter(printerName);
      store.setPrinterLoading(false);
      console.log("[App] Printer changed to:", printerName ?? "(default)");
      loadPaperSettings();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update printer";
      store.setPrinterError(message);
      console.error("[App] Failed to change printer:", error);
    }
  },
  onPaperSizeChange: async (paperSize: string | null) => {
    store.setPaperLoading(true);
    try {
      await apiClient.updatePaperSettings(paperSize);
      store.setCurrentPaperSize(paperSize);
      store.setPaperLoading(false);
      console.log("[App] Paper size changed to:", paperSize ?? "(default)");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update paper size";
      store.setPaperError(message);
      console.error("[App] Failed to change paper size:", error);
    }
  },
};

// Load printer settings
async function loadPrinterSettings(): Promise<void> {
  store.setPrinterLoading(true);
  try {
    const settings = await apiClient.getPrinterSettings();
    store.setPrinterSettings(settings);
    console.log("[App] Printer settings loaded:", settings);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load printer settings";
    store.setPrinterError(message);
    console.error("[App] Failed to load printer settings:", error);
  }
}

// Load paper settings
async function loadPaperSettings(): Promise<void> {
  // Abort any in-flight paper settings reset from a previous call
  paperSettingsAbortController?.abort();
  paperSettingsAbortController = new AbortController();
  const { signal } = paperSettingsAbortController;

  const requestId = ++paperSettingsRequestId;
  store.setPaperLoading(true);
  try {
    const [settings, papers] = await Promise.all([
      apiClient.getPaperSettings(),
      apiClient.getAvailablePapers(),
    ]);
    if (requestId !== paperSettingsRequestId) return; // Stale request

    // Reset to default if current paper size is not in the dynamic available list
    const currentSize = settings.currentPaperSize;
    const isDynamic = papers.source === "dynamic";
    const isAvailable = currentSize !== null && papers.paperSizes.includes(currentSize);
    const shouldReset = isDynamic && !isAvailable && currentSize !== null;

    if (shouldReset) {
      // Guard: abort if superseded before the side-effecting write
      if (signal.aborted) return;
      try {
        await apiClient.updatePaperSettings(null);
      } catch (err) {
        if (signal.aborted) return; // Superseded during the await
        console.error("[App] Failed to reset paper size on server:", err);
        // Keep the saved value on failure to avoid UI/server divergence
        store.setPaperSettings({
          ...settings,
          availablePaperSizes: papers.paperSizes,
          source: papers.source as "dynamic" | "fallback",
        });
        return;
      }
      if (requestId !== paperSettingsRequestId) return; // Stale after await
    }

    store.setPaperSettings({
      ...settings,
      currentPaperSize: shouldReset ? null : currentSize,
      isDefault: shouldReset ? true : settings.isDefault,
      availablePaperSizes: papers.paperSizes,
      source: papers.source as "dynamic" | "fallback",
    });
    console.log("[App] Paper settings loaded:", settings, papers);
  } catch (error) {
    if (requestId !== paperSettingsRequestId) return; // Stale request
    const message = error instanceof Error ? error.message : "Failed to load paper settings";
    store.setPaperError(message);
    console.error("[App] Failed to load paper settings:", error);
  }
}

// Load history data
async function loadHistory(page: number): Promise<void> {
  const requestId = ++historyRequestId;
  store.setHistoryLoading(true);

  try {
    const response = await apiClient.getHistory({ page, limit: 20 });
    if (requestId !== historyRequestId) return; // Stale request
    store.setHistoryState({
      jobs: response.jobs,
      pagination: response.pagination,
      isLoading: false,
      error: null,
    });
  } catch (error) {
    if (requestId !== historyRequestId) return; // Stale request
    store.setHistoryError(error instanceof Error ? error.message : "Failed to load history");
  }
}

// Load preview for selected job
async function loadPreview(jobId: string): Promise<void> {
  console.log("[Preview] Loading preview for job:", jobId);
  const requestId = ++previewRequestId;
  previewState = { isLoading: true, preview: null, error: null };
  renderPreview();

  try {
    const preview = await apiClient.getJobPreview(jobId);
    if (requestId !== previewRequestId) {
      console.log("[Preview] Stale request ignored:", requestId);
      return;
    }
    console.log("[Preview] Preview loaded successfully:", preview);
    previewState = { isLoading: false, preview, error: null };
  } catch (error) {
    if (requestId !== previewRequestId) {
      console.log("[Preview] Stale request ignored:", requestId);
      return;
    }
    const errorMessage = error instanceof Error ? error.message : "Failed to load preview";
    console.error("[Preview] Failed to load preview:", errorMessage, error);
    previewState = {
      isLoading: false,
      preview: null,
      error: errorMessage,
    };
  }

  renderPreview();
}

// Render error banner
function renderErrorBanner(error: string | null): void {
  if (!error) {
    render(nothing, errorBannerEl);
    return;
  }

  const template = html`
    <div class="error-banner">
      <span>${error}</span>
      <button @click=${() => store.clearError()}>Dismiss</button>
    </div>
  `;

  render(template, errorBannerEl);
}

// Render preview modal
function renderPreview(): void {
  const selectedJob = store.getSelectedJob();
  renderJobPreview(previewModalEl, selectedJob, previewState, previewHandlers);
}

// Main render function
function renderApp(state: AppState): void {
  renderStatusBar(statusBarEl, state, statusBarCallbacks);
  renderTabs(tabsEl, state.activeTab, tabHandlers);
  renderErrorBanner(state.error);

  // Switch views based on active tab
  if (state.activeTab === "queue") {
    queueViewEl.style.display = "";
    historyViewEl.style.display = "none";
    renderControls(controlsEl, state, controlHandlers);
    renderQueueList(queueListEl, state, jobCardHandlers);
  } else {
    queueViewEl.style.display = "none";
    historyViewEl.style.display = "";
    render(nothing, controlsEl);
    renderHistoryTable(historyTableEl, state.history);
    renderPagination(paginationEl, state.history.pagination, paginationHandlers);
  }

  renderPreview();
}

// Handle WebSocket messages
function handleMessage(message: ServerMessage): void {
  switch (message.type) {
    case "connected":
      console.log("[App] WebSocket connected:", message.message);
      break;

    case "queue:state":
      store.setQueueState(message.payload);
      break;

    case "queue:paused":
      store.setQueueState({
        ...store.getState().queue,
        isPaused: true,
      });
      break;

    case "queue:resumed":
      store.setQueueState({
        ...store.getState().queue,
        isPaused: false,
      });
      break;

    case "job:started":
    case "job:completed":
    case "job:failed":
    case "job:skipped":
    case "job:prioritized":
      // State will be updated via queue:state message
      break;

    case "pong":
      // Ignore pong responses
      break;

    case "error":
      store.setError(message.message);
      break;
  }
}

// Initialize
function init(): void {
  // Subscribe to store changes
  store.subscribe(renderApp);

  // Setup WebSocket handlers
  wsClient.onMessage(handleMessage);
  wsClient.onConnectionChange((state) => {
    store.setConnectionState(state);
  });

  // Connect WebSocket
  wsClient.connect();

  // Load printer and paper settings on init
  loadPrinterSettings();
  loadPaperSettings();

  console.log("[App] Initialized");
}

// Start the app
init();
