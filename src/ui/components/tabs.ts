/**
 * Tabs component for switching between Queue and History views
 */

import { html, render } from "lit-html";
import type { TabType } from "../types.js";

export interface TabsHandlers {
  onTabChange: (tab: TabType) => void;
}

export const renderTabs = (container: HTMLElement, activeTab: TabType, handlers: TabsHandlers) => {
  const template = html`
    <div class="tabs">
      <button
        class="tab ${activeTab === "queue" ? "active" : ""}"
        @click=${() => handlers.onTabChange("queue")}
      >
        Queue
      </button>
      <button
        class="tab ${activeTab === "history" ? "active" : ""}"
        @click=${() => handlers.onTabChange("history")}
      >
        History
      </button>
    </div>
  `;

  render(template, container);
};
