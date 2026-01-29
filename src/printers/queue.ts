import type {
  PrintJob,
  PrinterPlugin,
  TypedEventEmitter,
  QueueState,
  QueueJobInfo,
} from "../core/index.js";

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
    if (!this.shutdownRequested) {
      this.shutdownRequested = true;
      this.eventBus?.emit("queue:paused");
      this.emitQueueState();
    }
  }

  /**
   * Resume processing
   */
  resume(): void {
    if (this.shutdownRequested) {
      this.shutdownRequested = false;
      this.eventBus?.emit("queue:resumed");
      this.emitQueueState();
      if (!this.processing && this.queue.length > 0) {
        this.processQueue();
      }
    }
  }

  /**
   * Check if queue is paused
   */
  get isPaused(): boolean {
    return this.shutdownRequested;
  }

  /**
   * Skip (remove) a specific job from the queue
   */
  skip(jobId: string): PrintJob | null {
    const index = this.queue.findIndex((job) => job.id === jobId);
    if (index === -1) {
      return null;
    }

    const [removed] = this.queue.splice(index, 1);
    this.eventBus?.emit("queue:job:skipped", removed);
    this.emitQueueState();
    return removed;
  }

  /**
   * Move a job to the front of the queue (position 0)
   * Returns the new position (always 0 on success, -1 if not found)
   */
  prioritize(jobId: string): number {
    const index = this.queue.findIndex((job) => job.id === jobId);
    if (index === -1) {
      return -1;
    }

    if (index === 0) {
      // Already at front
      return 0;
    }

    const [job] = this.queue.splice(index, 1);
    this.queue.unshift(job);
    this.eventBus?.emit("queue:job:prioritized", job, 0);
    this.emitQueueState();
    return 0;
  }

  /**
   * Get current queue state for UI
   */
  getState(): QueueState {
    return {
      jobs: this.queue.map((job, index) => this.toJobInfo(job, index)),
      isPaused: this.shutdownRequested,
      isProcessing: this.processing,
      totalSize: this.queue.length,
    };
  }

  /**
   * Get a specific job by ID
   */
  getJob(jobId: string): PrintJob | null {
    return this.queue.find((job) => job.id === jobId) ?? null;
  }

  /**
   * Convert PrintJob to QueueJobInfo
   */
  private toJobInfo(job: PrintJob, position: number): QueueJobInfo {
    const message = job.logEntry.message;
    const messagePreview = message.length > 100 ? message.slice(0, 97) + "..." : message;

    return {
      id: job.id,
      logEntryId: job.logEntry.id,
      source: job.logEntry.source,
      messagePreview,
      status: job.status,
      createdAt: job.createdAt.toISOString(),
      retryCount: job.retryCount,
      position,
    };
  }

  /**
   * Emit current queue state
   */
  private emitQueueState(): void {
    this.eventBus?.emit("queue:state", this.getState());
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
