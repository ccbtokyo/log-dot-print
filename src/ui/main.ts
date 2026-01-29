/**
 * Main entry point for the UI application
 */

import { html, render, nothing } from "lit-html";
import { store, type AppState } from "./state/store.js";
import { WSClient } from "./services/ws-client.js";
import { ApiClient } from "./services/api-client.js";
import { renderStatusBar } from "./components/status-bar.js";
import { renderControls, type ControlsHandlers } from "./components/controls.js";
import { renderQueueList } from "./components/queue-list.js";
import { renderJobPreview, type PreviewState } from "./components/job-preview.js";
import type { ServerMessage } from "./types.js";

// Initialize clients
const wsUrl = `ws://${window.location.host}/ws/ui`;
const wsClient = new WSClient({ url: wsUrl });
const apiClient = new ApiClient();

// Preview state
let previewState: PreviewState = {
  isLoading: false,
  preview: null,
  error: null,
};

// Get DOM elements
const statusBarEl = document.getElementById("status-bar")!;
const controlsEl = document.getElementById("controls")!;
const errorBannerEl = document.getElementById("error-banner")!;
const queueListEl = document.getElementById("queue-list")!;
const previewModalEl = document.getElementById("preview-modal")!;

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

// Load preview for selected job
async function loadPreview(jobId: string): Promise<void> {
  previewState = { isLoading: true, preview: null, error: null };
  renderPreview();

  try {
    const preview = await apiClient.getJobPreview(jobId);
    previewState = { isLoading: false, preview, error: null };
  } catch (error) {
    previewState = {
      isLoading: false,
      preview: null,
      error: error instanceof Error ? error.message : "Failed to load preview",
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
  renderStatusBar(statusBarEl, state);
  renderControls(controlsEl, state, controlHandlers);
  renderErrorBanner(state.error);
  renderQueueList(queueListEl, state, jobCardHandlers);
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

  console.log("[App] Initialized");
}

// Start the app
init();
