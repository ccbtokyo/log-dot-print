/**
 * Queue list component showing all jobs
 */

import { html, render } from "lit-html";
import type { AppState } from "../state/store.js";
import { renderJobCard, type JobCardHandlers } from "./job-card.js";

export const renderQueueList = (
  container: HTMLElement,
  state: AppState,
  handlers: JobCardHandlers,
) => {
  const { queue, selectedJobId } = state;

  const template = html`
    <div class="queue-list">
      ${
        queue.jobs.length === 0
          ? html`
              <div class="empty-state">
                <p>No jobs in queue</p>
              </div>
            `
          : queue.jobs.map((job) => renderJobCard(job, job.id === selectedJobId, handlers))
      }
    </div>
  `;

  render(template, container);
};
