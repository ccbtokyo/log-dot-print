/**
 * Pagination component for navigating history pages
 */

import { html, render } from "lit-html";
import type { PaginationInfo } from "../types.js";

export interface PaginationHandlers {
  onPageChange: (page: number) => void;
}

export const renderPagination = (
  container: HTMLElement,
  pagination: PaginationInfo,
  handlers: PaginationHandlers,
) => {
  const { page, totalPages, total } = pagination;

  if (totalPages <= 0) {
    render(
      html`
        
      `,
      container,
    );
    return;
  }

  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  const template = html`
    <div class="pagination">
      <button
        class="btn btn-sm pagination-btn"
        ?disabled=${!hasPrev}
        @click=${() => handlers.onPageChange(page - 1)}
      >
        Prev
      </button>
      <span class="pagination-info">
        Page ${page} of ${totalPages} (${total} total)
      </span>
      <button
        class="btn btn-sm pagination-btn"
        ?disabled=${!hasNext}
        @click=${() => handlers.onPageChange(page + 1)}
      >
        Next
      </button>
    </div>
  `;

  render(template, container);
};
