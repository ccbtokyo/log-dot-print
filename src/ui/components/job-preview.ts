/**
 * Job preview modal component (WIP - basic implementation)
 */

import { html, render, nothing } from "lit-html";
import type { QueueJobInfo, JobPreview } from "../types.js";

export interface PreviewState {
  isLoading: boolean;
  preview: JobPreview | null;
  error: string | null;
}

export interface PreviewHandlers {
  onClose: () => void;
  onSkip: (id: string) => void;
  onPrioritize: (id: string) => void;
}

export const renderJobPreview = (
  container: HTMLElement,
  job: QueueJobInfo | null,
  previewState: PreviewState,
  handlers: PreviewHandlers,
) => {
  if (!job) {
    render(nothing, container);
    return;
  }

  const canPrioritize = job.position > 0 && job.status === "pending";
  const canSkip = job.status === "pending" || job.status === "printing";

  const template = html`
    <div class="modal-overlay" @click=${handlers.onClose}>
      <div class="modal" @click=${(e: Event) => e.stopPropagation()}>
        <div class="modal-header">
          <h2>Job Preview</h2>
          <button class="btn-close" @click=${handlers.onClose}>&times;</button>
        </div>
        <div class="modal-body">
          <div class="preview-info">
            <div class="info-row">
              <span class="label">ID:</span>
              <span class="value">${job.id}</span>
            </div>
            <div class="info-row">
              <span class="label">Source:</span>
              <span class="value">${job.source}</span>
            </div>
            <div class="info-row">
              <span class="label">Status:</span>
              <span class="value">${job.status}</span>
            </div>
            <div class="info-row">
              <span class="label">Position:</span>
              <span class="value">#${job.position + 1}</span>
            </div>
          </div>
          <div class="preview-content">
            <h3>Formatted Content</h3>
            ${
              previewState.isLoading
                ? html`
                    <div class="loading">Loading...</div>
                  `
                : previewState.error
                  ? html`<div class="error">${previewState.error}</div>`
                  : previewState.preview && previewState.preview.id !== job.id
                    ? html`
                        <div class="loading">Loading...</div>
                      `
                    : html`<pre>${previewState.preview?.formattedContent ?? "No content"}</pre>`
            }
          </div>
        </div>
        <div class="modal-footer">
          ${
            canPrioritize
              ? html`
                <button
                  class="btn btn-primary"
                  @click=${() => handlers.onPrioritize(job.id)}
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
                  class="btn btn-danger"
                  @click=${() => handlers.onSkip(job.id)}
                >
                  Skip
                </button>
              `
              : nothing
          }
          <button class="btn" @click=${handlers.onClose}>Close</button>
        </div>
      </div>
    </div>
  `;

  render(template, container);
};
