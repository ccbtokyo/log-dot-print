/**
 * Printer selector component for choosing the target printer
 */

import { html, render, nothing } from "lit-html";
import type { PrinterSettingsState } from "../types.js";

export interface PrinterSelectorCallbacks {
  onPrinterChange: (printerName: string | null) => void;
}

export const renderPrinterSelector = (
  container: HTMLElement,
  settings: PrinterSettingsState,
  callbacks: PrinterSelectorCallbacks,
) => {
  const handleChange = (event: Event) => {
    const select = event.target as HTMLSelectElement;
    const value = select.value;
    // Empty string means "use default"
    callbacks.onPrinterChange(value === "" ? null : value);
  };

  const template = html`
    <div class="printer-selector">
      <label class="printer-selector__label">
        <span class="printer-selector__icon">🖨️</span>
        <select
          class="printer-selector__select"
          @change=${handleChange}
          ?disabled=${settings.isLoading}
        >
          <option value="" ?selected=${settings.isDefault}>
            ${settings.availablePrinters.find((p) => p.isDefault)?.name ?? "System Default"}
          </option>
          ${settings.availablePrinters
            .filter((p) => !p.isDefault)
            .map(
              (printer) => html`
                <option
                  value=${printer.name}
                  ?selected=${settings.currentPrinter === printer.name}
                >
                  ${printer.name}
                </option>
              `,
            )}
        </select>
        ${
          settings.isLoading
            ? html`
                <span class="printer-selector__loading">⏳</span>
              `
            : nothing
        }
      </label>
      ${
        settings.error
          ? html`<span class="printer-selector__error" title=${settings.error}>⚠️</span>`
          : nothing
      }
    </div>
  `;

  render(template, container);
};
