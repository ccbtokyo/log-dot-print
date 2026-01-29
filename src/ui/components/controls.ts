/**
 * Queue control buttons component
 */

import { html, render } from "lit-html";
import type { AppState } from "../state/store.js";

export interface ControlsHandlers {
  onPause: () => void;
  onResume: () => void;
  onClear: () => void;
}

export const renderControls = (
  container: HTMLElement,
  state: AppState,
  handlers: ControlsHandlers,
) => {
  const { queue, connection } = state;
  const isConnected = connection === "connected";
  const hasJobs = queue.totalSize > 0;

  const template = html`
    <div class="controls">
      ${
        queue.isPaused
          ? html`
            <button
              class="btn btn-primary"
              ?disabled=${!isConnected}
              @click=${handlers.onResume}
            >
              Resume
            </button>
          `
          : html`
            <button
              class="btn btn-warning"
              ?disabled=${!isConnected}
              @click=${handlers.onPause}
            >
              Pause
            </button>
          `
      }
      <button
        class="btn btn-danger"
        ?disabled=${!isConnected || !hasJobs}
        @click=${handlers.onClear}
      >
        Clear Queue
      </button>
    </div>
  `;

  render(template, container);
};
