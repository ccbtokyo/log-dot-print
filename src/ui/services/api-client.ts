/**
 * REST API client for queue management
 */

import type {
  QueueState,
  PrintJob,
  JobPreview,
  HistoryResponse,
  PrinterSettingsState,
  PaperSettingsState,
} from "../types.js";

export class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = "") {
    this.baseUrl = baseUrl;
  }

  async getQueueState(): Promise<QueueState> {
    const response = await fetch(`${this.baseUrl}/api/queue`);
    if (!response.ok) {
      throw new Error(`Failed to get queue state: ${response.status}`);
    }
    return response.json();
  }

  async getJob(id: string): Promise<PrintJob> {
    const response = await fetch(`${this.baseUrl}/api/queue/${encodeURIComponent(id)}`);
    if (!response.ok) {
      throw new Error(`Failed to get job: ${response.status}`);
    }
    return response.json();
  }

  async getJobPreview(id: string): Promise<JobPreview> {
    const response = await fetch(`${this.baseUrl}/api/queue/${encodeURIComponent(id)}/preview`);
    if (!response.ok) {
      throw new Error(`Failed to get job preview: ${response.status}`);
    }
    return response.json();
  }

  async pauseQueue(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/queue/pause`, {
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(`Failed to pause queue: ${response.status}`);
    }
  }

  async resumeQueue(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/queue/resume`, {
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(`Failed to resume queue: ${response.status}`);
    }
  }

  async clearQueue(): Promise<{ removedCount: number }> {
    const response = await fetch(`${this.baseUrl}/api/queue/clear`, {
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(`Failed to clear queue: ${response.status}`);
    }
    return response.json();
  }

  async skipJob(id: string): Promise<PrintJob | null> {
    const response = await fetch(`${this.baseUrl}/api/queue/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`Failed to skip job: ${response.status}`);
    }
    const result = await response.json();
    return result.job ?? null;
  }

  async prioritizeJob(id: string): Promise<number> {
    const response = await fetch(`${this.baseUrl}/api/queue/${encodeURIComponent(id)}/prioritize`, {
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(`Failed to prioritize job: ${response.status}`);
    }
    const result = await response.json();
    return result.newPosition;
  }

  async getHistory(options: { page?: number; limit?: number } = {}): Promise<HistoryResponse> {
    const params = new URLSearchParams();
    if (options.page !== undefined) {
      params.set("page", String(options.page));
    }
    if (options.limit !== undefined) {
      params.set("limit", String(options.limit));
    }
    const query = params.toString();
    const url = `${this.baseUrl}/api/history${query ? `?${query}` : ""}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to get history: ${response.status}`);
    }
    return response.json();
  }

  async getPrinterSettings(): Promise<PrinterSettingsState> {
    const response = await fetch(`${this.baseUrl}/api/settings/printer`);
    if (!response.ok) {
      throw new Error(`Failed to get printer settings: ${response.status}`);
    }
    const data = await response.json();
    return {
      currentPrinter: data.currentPrinter,
      availablePrinters: data.availablePrinters,
      isDefault: data.isDefault,
      isLoading: false,
      error: null,
    };
  }

  async updatePrinterSettings(printerName: string | null): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/settings/printer`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ printerName }),
    });
    if (!response.ok) {
      throw new Error(`Failed to update printer settings: ${response.status}`);
    }
  }

  async getAvailablePapers(): Promise<{
    paperSizes: string[];
    source: string;
    printerName: string | null;
  }> {
    const response = await fetch(`${this.baseUrl}/api/papers`);
    if (!response.ok) {
      throw new Error(`Failed to get available papers: ${response.status}`);
    }
    return response.json();
  }

  async getPaperSettings(): Promise<PaperSettingsState> {
    const response = await fetch(`${this.baseUrl}/api/settings/paper`);
    if (!response.ok) {
      throw new Error(`Failed to get paper settings: ${response.status}`);
    }
    const data = await response.json();
    return {
      currentPaperSize: data.currentPaperSize,
      availablePaperSizes: [],
      source: "fallback",
      isDefault: data.isDefault,
      isLoading: false,
      error: null,
    };
  }

  async updatePaperSettings(paperSize: string | null): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/settings/paper`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paperSize }),
    });
    if (!response.ok) {
      throw new Error(`Failed to update paper settings: ${response.status}`);
    }
  }
}
