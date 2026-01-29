/**
 * Individual job card component
 */

import { html, nothing } from "lit-html";
import type { QueueJobInfo } from "../types.js";

const getStatusIcon = (status: string): string => {
  switch (status) {
    case "pending":
      return "\u23F3";
    case "printing":
      return "\uD83D\uDDA8\uFE0F";
    case "completed":
      return "\u2705";
    case "failed":
      return "\u274C";
    default:
      return "\u2753";
  }
};

const getStatusClass = (status: string): string => {
  switch (status) {
    case "pending":
      return "status-pending";
    case "printing":
      return "status-printing";
    case "completed":
      return "status-completed";
    case "failed":
      return "status-failed";
    default:
      return "";
  }
};

export interface JobCardHandlers {
  onSkip: (id: string) => void;
  onPrioritize: (id: string) => void;
  onSelect: (id: string) => void;
}

export const renderJobCard = (
  job: QueueJobInfo,
  isSelected: boolean,
  handlers: JobCardHandlers,
) => {
  const canPrioritize = job.position > 0 && job.status === "pending";
  const canSkip = job.status === "pending" || job.status === "printing";

  const formatDate = (isoString: string): string => {
    const date = new Date(isoString);
    return date.toLocaleTimeString();
  };

  return html`
    <div
      class="job-card ${getStatusClass(job.status)} ${isSelected ? "selected" : ""}"
      @click=${() => handlers.onSelect(job.id)}
    >
      <div class="job-header">
        <span class="job-position">#${job.position + 1}</span>
        <span class="job-status">
          ${getStatusIcon(job.status)} ${job.status}
        </span>
        <span class="job-source">${job.source}</span>
      </div>
      <div class="job-message">${job.messagePreview}</div>
      <div class="job-footer">
        <span class="job-time">${formatDate(job.createdAt)}</span>
        ${
          job.retryCount > 0
            ? html`<span class="job-retry">Retries: ${job.retryCount}</span>`
            : nothing
        }
        <div class="job-actions">
          ${
            canPrioritize
              ? html`
                <button
                  class="btn btn-sm"
                  @click=${(e: Event) => {
                    e.stopPropagation();
                    handlers.onPrioritize(job.id);
                  }}
                >
                  Prioritize
                </button>
              `
              : nothing
          }
          ${
            canSkip
              ? html`
                <button
                  class="btn btn-sm btn-danger"
                  @click=${(e: Event) => {
                    e.stopPropagation();
                    handlers.onSkip(job.id);
                  }}
                >
                  Skip
                </button>
              `
              : nothing
          }
        </div>
      </div>
    </div>
  `;
};
