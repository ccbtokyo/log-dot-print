/**
 * Status bar component showing connection state and queue statistics
 */

import { html, render } from "lit-html";
import type { AppState } from "../state/store.js";
import type { ConnectionState } from "../services/ws-client.js";

const getConnectionIcon = (state: ConnectionState): string => {
  switch (state) {
    case "connected":
      return "\u2705";
    case "connecting":
    case "reconnecting":
      return "\u23F3";
    case "disconnected":
      return "\u274C";
  }
};

const getConnectionText = (state: ConnectionState): string => {
  switch (state) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting...";
    case "reconnecting":
      return "Reconnecting...";
    case "disconnected":
      return "Disconnected";
  }
};

export const renderStatusBar = (container: HTMLElement, state: AppState) => {
  const { queue, connection } = state;

  const template = html`
    <div class="status-bar">
      <div class="status-item connection ${connection}">
        <span class="icon">${getConnectionIcon(connection)}</span>
        <span class="text">${getConnectionText(connection)}</span>
      </div>
      <div class="status-item">
        <span class="label">Queue:</span>
        <span class="value">${queue.totalSize}</span>
      </div>
      <div class="status-item">
        <span class="label">Processing:</span>
        <span class="value">${queue.isProcessing ? "Yes" : "No"}</span>
      </div>
      <div class="status-item ${queue.isPaused ? "paused" : ""}">
        <span class="label">Status:</span>
        <span class="value">${queue.isPaused ? "Paused" : "Running"}</span>
      </div>
    </div>
  `;

  render(template, container);
};
