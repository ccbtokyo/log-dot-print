/**
 * History table component for displaying completed/failed jobs
 */

import { html, render } from "lit-html";
import type { HistoryState, HistoryJobInfo } from "../types.js";

export interface HistoryTableHandlers {
  onReplay: (id: string) => void;
}

const formatDate = (isoString: string): string => {
  const date = new Date(isoString);
  return date.toLocaleString();
};

const truncateMessage = (message: string, maxLength = 50): string => {
  if (message.length <= maxLength) {
    return message;
  }
  return message.slice(0, maxLength) + "...";
};

const getStatusBadgeClass = (status: string): string => {
  switch (status) {
    case "completed":
      return "status-badge completed";
    case "failed":
      return "status-badge failed";
    default:
      return "status-badge";
  }
};

const renderRow = (job: HistoryJobInfo, handlers: HistoryTableHandlers) => {
  const downloadLink = job.hasFile
    ? html`<a href="/api/history/${job.id}/download" class="download-link" download>📄</a>`
    : html`
        <span class="no-file">-</span>
      `;

  return html`
    <tr>
      <td class="history-cell-time">${formatDate(job.createdAt)}</td>
      <td class="history-cell-source">${job.source}</td>
      <td class="history-cell-message" title="${job.messagePreview}">${truncateMessage(job.messagePreview)}</td>
      <td class="history-cell-status">
        <span class="${getStatusBadgeClass(job.status)}">${job.status}</span>
      </td>
      <td class="history-cell-retry">${job.retryCount}</td>
      <td class="history-cell-error" title="${job.error ?? ""}">${job.error ? truncateMessage(job.error, 30) : "-"}</td>
      <td class="history-cell-download">${downloadLink}</td>
      <td class="history-cell-replay">
        <button class="replay-btn" @click=${() => handlers.onReplay(job.id)} title="Re-print this job">
          ↻
        </button>
      </td>
    </tr>
  `;
};

export const renderHistoryTable = (
  container: HTMLElement,
  state: HistoryState,
  handlers: HistoryTableHandlers,
) => {
  if (state.isLoading) {
    const template = html`
      <div class="loading">Loading history...</div>
    `;
    render(template, container);
    return;
  }

  if (state.error) {
    const template = html`<div class="error">${state.error}</div>`;
    render(template, container);
    return;
  }

  if (state.jobs.length === 0) {
    const template = html`
      <div class="empty-state">No completed or failed jobs yet.</div>
    `;
    render(template, container);
    return;
  }

  const template = html`
    <table class="history-table">
      <thead>
        <tr>
          <th>Time</th>
          <th>Source</th>
          <th>Message</th>
          <th>Status</th>
          <th>Retries</th>
          <th>Error</th>
          <th>File</th>
          <th>Replay</th>
        </tr>
      </thead>
      <tbody>
        ${state.jobs.map((job) => renderRow(job, handlers))}
      </tbody>
    </table>
  `;

  render(template, container);
};
