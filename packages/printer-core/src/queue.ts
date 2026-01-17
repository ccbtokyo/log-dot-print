import type { PrintJob, PrinterPlugin, TypedEventEmitter } from "@log-dot-print/core";

interface QueueConfig {
  maxSize: number;
  retryAttempts: number;
  retryDelayMs: number;
}

/**
 * Print queue with retry logic and event-driven processing
 */
export class PrintQueue {
  private queue: PrintJob[] = [];
  private processing = false;
  private printer: PrinterPlugin | null = null;
  private eventBus: TypedEventEmitter | null = null;
  private config: QueueConfig;
  private shutdownRequested = false;

  constructor(config?: Partial<QueueConfig>) {
    this.config = {
      maxSize: config?.maxSize ?? 1000,
      retryAttempts: config?.retryAttempts ?? 3,
      retryDelayMs: config?.retryDelayMs ?? 1000,
    };
  }

  /**
   * Initialize the queue with a printer and event bus
   */
  initialize(printer: PrinterPlugin, eventBus: TypedEventEmitter): void {
    this.printer = printer;
    this.eventBus = eventBus;
    this.shutdownRequested = false;
  }

  /**
   * Add a job to the queue
   */
  enqueue(job: PrintJob): boolean {
    if (this.queue.length >= this.config.maxSize) {
      this.eventBus?.emit("queue:full", this.queue.length);
      return false;
    }

    this.queue.push(job);
    this.eventBus?.emit("log:queued", job);

    // Start processing if not already running
    if (!this.processing) {
      this.processQueue();
    }

    return true;
  }

  /**
   * Get current queue size
   */
  get size(): number {
    return this.queue.length;
  }

  /**
   * Check if queue is processing
   */
  get isProcessing(): boolean {
    return this.processing;
  }

  /**
   * Process the queue
   */
  private async processQueue(): Promise<void> {
    if (this.processing || !this.printer || this.shutdownRequested) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0 && !this.shutdownRequested) {
      const job = this.queue[0];

      try {
        job.status = "printing";
        this.eventBus?.emit("print:started", job);

        await this.printer.print(job);

        job.status = "completed";
        this.eventBus?.emit("print:completed", job);
        this.queue.shift();
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));

        job.retryCount++;

        if (job.retryCount <= this.config.retryAttempts) {
          this.eventBus?.emit("print:retry", job, job.retryCount);
          await this.delay(this.config.retryDelayMs * job.retryCount);
        } else {
          job.status = "failed";
          job.error = err.message;
          this.eventBus?.emit("print:failed", job, err);
          this.queue.shift();
        }
      }
    }

    this.processing = false;

    if (this.queue.length === 0) {
      this.eventBus?.emit("queue:drained");
    }
  }

  /**
   * Pause processing
   */
  pause(): void {
    this.shutdownRequested = true;
  }

  /**
   * Resume processing
   */
  resume(): void {
    this.shutdownRequested = false;
    if (!this.processing && this.queue.length > 0) {
      this.processQueue();
    }
  }

  /**
   * Clear the queue
   */
  clear(): PrintJob[] {
    const removed = [...this.queue];
    this.queue = [];
    return removed;
  }

  /**
   * Shutdown the queue
   */
  async shutdown(): Promise<void> {
    this.shutdownRequested = true;
    // Wait for current job to complete
    while (this.processing) {
      await this.delay(100);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
