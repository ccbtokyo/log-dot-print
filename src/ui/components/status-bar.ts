/**
 * Status bar component showing connection state and queue statistics
 */

import { html, render } from "lit-html";
import type { AppState } from "../state/store.js";
import type { ConnectionState } from "../services/ws-client.js";

export interface StatusBarCallbacks {
  onPrinterChange?: (printerName: string | null) => void;
  onPaperSizeChange?: (paperSize: string | null) => void;
}

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

export const renderStatusBar = (
  container: HTMLElement,
  state: AppState,
  callbacks?: StatusBarCallbacks,
) => {
  const { queue, connection, printerSettings, paperSettings } = state;

  const handlePrinterChange = (event: Event) => {
    const select = event.target as HTMLSelectElement;
    const value = select.value;
    callbacks?.onPrinterChange?.(value === "" ? null : value);
  };

  const handlePaperSizeChange = (event: Event) => {
    const select = event.target as HTMLSelectElement;
    const value = select.value;
    callbacks?.onPaperSizeChange?.(value === "" ? null : value);
  };

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
      <div class="status-item printer-selector">
        <span class="icon">🖨️</span>
        <select
          class="printer-select"
          @change=${handlePrinterChange}
          ?disabled=${printerSettings.isLoading}
        >
          ${printerSettings.availablePrinters.map(
            (printer) => html`
              <option
                value=${printer.isDefault ? "" : printer.name}
                ?selected=${
                  printerSettings.isDefault
                    ? printer.isDefault
                    : printerSettings.currentPrinter === printer.name
                }
              >
                ${printer.name}${printer.isDefault ? " (default)" : ""}
              </option>
            `,
          )}
        </select>
        ${
          printerSettings.isLoading
            ? html`
                <span class="loading-indicator">⏳</span>
              `
            : ""
        }
      </div>
      <div class="status-item paper-selector">
        <span class="icon">📄</span>
        <select
          class="paper-select"
          @change=${handlePaperSizeChange}
          ?disabled=${paperSettings.isLoading || printerSettings.isLoading}
        >
          <option value="" ?selected=${paperSettings.isDefault}>
            Default
          </option>
          ${
            !paperSettings.isDefault &&
            paperSettings.currentPaperSize !== null &&
            !paperSettings.availablePaperSizes.includes(paperSettings.currentPaperSize)
              ? html`
                  <option value=${paperSettings.currentPaperSize} selected>
                    ${paperSettings.currentPaperSize}
                  </option>
                `
              : ""
          }
          ${paperSettings.availablePaperSizes.map(
            (size) => html`
              <option
                value=${size}
                ?selected=${!paperSettings.isDefault && paperSettings.currentPaperSize === size}
              >
                ${size}
              </option>
            `,
          )}
        </select>
        ${
          paperSettings.isLoading
            ? html`
                <span class="loading-indicator">⏳</span>
              `
            : ""
        }
      </div>
    </div>
  `;

  render(template, container);
};
