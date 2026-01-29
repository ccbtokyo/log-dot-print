/**
 * Simple reactive store for UI state
 */

import type { QueueState, QueueJobInfo } from "../types.js";
import type { ConnectionState } from "../services/ws-client.js";

export interface AppState {
  queue: QueueState;
  connection: ConnectionState;
  selectedJobId: string | null;
  error: string | null;
}

export type StateListener = (state: AppState) => void;

const initialQueueState: QueueState = {
  jobs: [],
  isPaused: false,
  isProcessing: false,
  totalSize: 0,
};

export class Store {
  private state: AppState = {
    queue: initialQueueState,
    connection: "disconnected",
    selectedJobId: null,
    error: null,
  };

  private listeners = new Set<StateListener>();

  getState(): AppState {
    return this.state;
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    // Immediately call with current state
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  setQueueState(queue: QueueState): void {
    this.state = { ...this.state, queue };
    this.notify();
  }

  setConnectionState(connection: ConnectionState): void {
    this.state = { ...this.state, connection };
    this.notify();
  }

  setSelectedJob(jobId: string | null): void {
    this.state = { ...this.state, selectedJobId: jobId };
    this.notify();
  }

  setError(error: string | null): void {
    this.state = { ...this.state, error };
    this.notify();
  }

  clearError(): void {
    this.setError(null);
  }

  getSelectedJob(): QueueJobInfo | null {
    if (!this.state.selectedJobId) {
      return null;
    }
    return this.state.queue.jobs.find((job) => job.id === this.state.selectedJobId) ?? null;
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch (error) {
        console.error("[Store] Listener error:", error);
      }
    }
  }
}

// Global store instance
export const store = new Store();
