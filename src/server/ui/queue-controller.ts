/**
 * REST API controller for queue management
 * @see docs/architecture.md for design details
 * @related packages/printer-core/src/queue.ts - PrintQueue
 */

import { Hono } from "hono";
import type { PrintJob, TypedEventEmitter } from "../../core/index.js";
import type { PrintQueue } from "../../printers/index.js";
import type { LogFormatterPlugin } from "../../core/index.js";

/**
 * Queue controller for REST API
 */
export class QueueController {
  private app: Hono;
  private printQueue: PrintQueue;
  private eventBus: TypedEventEmitter;
  private formatter?: LogFormatterPlugin;

  constructor(printQueue: PrintQueue, eventBus: TypedEventEmitter, formatter?: LogFormatterPlugin) {
    this.printQueue = printQueue;
    this.eventBus = eventBus;
    this.formatter = formatter;
    this.app = new Hono();
    this.configureRoutes();
  }

  /**
   * Get the Hono app for mounting
   */
  getApp(): Hono {
    return this.app;
  }

  private configureRoutes(): void {
    // GET /api/queue - Get queue state
    this.app.get("/api/queue", (c) => {
      const state = this.printQueue.getState();
      return c.json(state);
    });

    // GET /api/queue/:id - Get specific job
    this.app.get("/api/queue/:id", (c) => {
      const id = c.req.param("id");
      const job = this.printQueue.getJob(id);
      if (!job) {
        return c.json({ error: "Job not found" }, 404);
      }
      return c.json(this.serializePrintJob(job));
    });

    // GET /api/queue/:id/preview - Get formatted preview
    this.app.get("/api/queue/:id/preview", (c) => {
      const id = c.req.param("id");
      const job = this.printQueue.getJob(id);
      if (!job) {
        return c.json({ error: "Job not found" }, 404);
      }
      return c.json({
        id: job.id,
        formattedContent: job.formattedContent,
      });
    });

    // POST /api/queue/pause - Pause queue
    this.app.post("/api/queue/pause", (c) => {
      this.printQueue.pause();
      return c.json({ success: true, message: "Queue paused" });
    });

    // POST /api/queue/resume - Resume queue
    this.app.post("/api/queue/resume", (c) => {
      this.printQueue.resume();
      return c.json({ success: true, message: "Queue resumed" });
    });

    // POST /api/queue/clear - Clear queue
    this.app.post("/api/queue/clear", (c) => {
      const removed = this.printQueue.clear();
      return c.json({ success: true, removedCount: removed.length });
    });

    // DELETE /api/queue/:id - Skip (remove) job
    this.app.delete("/api/queue/:id", (c) => {
      const id = c.req.param("id");
      const job = this.printQueue.skip(id);
      if (!job) {
        return c.json({ error: "Job not found" }, 404);
      }
      return c.json({ success: true, job: this.serializePrintJob(job) });
    });

    // POST /api/queue/:id/prioritize - Prioritize job
    this.app.post("/api/queue/:id/prioritize", (c) => {
      const id = c.req.param("id");
      const newPosition = this.printQueue.prioritize(id);
      if (newPosition === -1) {
        return c.json({ error: "Job not found" }, 404);
      }
      return c.json({ success: true, newPosition });
    });
  }

  private serializePrintJob(job: PrintJob): object {
    return {
      id: job.id,
      logEntry: job.logEntry,
      formattedContent: job.formattedContent,
      createdAt: job.createdAt.toISOString(),
      status: job.status,
      retryCount: job.retryCount,
      error: job.error,
    };
  }
}
