/**
 * Queue persistence handler using event-driven architecture
 * @see docs/architecture.md for design details
 * @related packages/core/src/events.ts - TypedEventEmitter
 * @related packages/printer-core/src/queue.ts - PrintQueue
 */

import type { PrintJob, TypedEventEmitter, QueuePersistencePlugin } from "../core/index.js";

/**
 * Handles queue persistence by listening to system events
 * This maintains loose coupling by not modifying PrintQueue directly
 */
export class QueuePersistenceHandler {
  private persistence: QueuePersistencePlugin;
  private eventBus: TypedEventEmitter;
  private initialized = false;

  constructor(persistence: QueuePersistencePlugin, eventBus: TypedEventEmitter) {
    this.persistence = persistence;
    this.eventBus = eventBus;
  }

  /**
   * Start listening to events and persisting queue state
   */
  initialize(): void {
    if (this.initialized) {
      return;
    }

    this.eventBus.on("log:queued", this.onJobQueued);
    this.eventBus.on("print:started", this.onPrintStarted);
    this.eventBus.on("print:completed", this.onPrintCompleted);
    this.eventBus.on("print:failed", this.onPrintFailed);
    this.eventBus.on("print:retry", this.onPrintRetry);

    this.initialized = true;
    console.log("[QueuePersistenceHandler] Initialized");
  }

  /**
   * Stop listening to events
   */
  shutdown(): void {
    if (!this.initialized) {
      return;
    }

    this.eventBus.off("log:queued", this.onJobQueued);
    this.eventBus.off("print:started", this.onPrintStarted);
    this.eventBus.off("print:completed", this.onPrintCompleted);
    this.eventBus.off("print:failed", this.onPrintFailed);
    this.eventBus.off("print:retry", this.onPrintRetry);

    this.initialized = false;
    console.log("[QueuePersistenceHandler] Shutdown complete");
  }

  /**
   * Get pending jobs for queue restoration
   */
  async getPendingJobs(): Promise<PrintJob[]> {
    return this.persistence.getPendingJobs();
  }

  private onJobQueued = (job: PrintJob): void => {
    this.persistence.savePrintJob(job).catch((error) => {
      console.error("[QueuePersistenceHandler] Failed to save job:", error);
    });
  };

  private onPrintStarted = (job: PrintJob): void => {
    this.persistence.updatePrintJobStatus(job.id, "printing", job.retryCount).catch((error) => {
      console.error("[QueuePersistenceHandler] Failed to update status to printing:", error);
    });
  };

  private onPrintCompleted = (job: PrintJob): void => {
    this.persistence.updatePrintJobStatus(job.id, "completed", job.retryCount).catch((error) => {
      console.error("[QueuePersistenceHandler] Failed to update status to completed:", error);
    });
  };

  private onPrintFailed = (job: PrintJob, error: Error): void => {
    this.persistence
      .updatePrintJobStatus(job.id, "failed", job.retryCount, error.message)
      .catch((persistError) => {
        console.error("[QueuePersistenceHandler] Failed to update status to failed:", persistError);
      });
  };

  private onPrintRetry = (job: PrintJob, attempt: number): void => {
    this.persistence.updatePrintJobStatus(job.id, "pending", attempt).catch((error) => {
      console.error("[QueuePersistenceHandler] Failed to record retry:", error);
    });
  };
}
