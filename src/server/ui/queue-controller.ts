/**
 * REST API controller for queue management
 * @see docs/architecture.md for design details
 * @related packages/printer-core/src/queue.ts - PrintQueue
 */

import { Hono } from "hono";
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import type { PrintJob, TypedEventEmitter, QueuePersistencePlugin } from "../../core/index.js";
import type { PrintQueue } from "../../printers/index.js";
import type { LogFormatterPlugin } from "../../core/index.js";
import { printerDiscovery } from "../../printers/discovery.js";

/**
 * Queue controller for REST API
 */
export class QueueController {
  private app: Hono;
  private printQueue: PrintQueue;
  private eventBus: TypedEventEmitter;
  private formatter?: LogFormatterPlugin;
  private storage?: QueuePersistencePlugin;

  constructor(
    printQueue: PrintQueue,
    eventBus: TypedEventEmitter,
    formatter?: LogFormatterPlugin,
    storage?: QueuePersistencePlugin,
  ) {
    this.printQueue = printQueue;
    this.eventBus = eventBus;
    this.formatter = formatter;
    this.storage = storage;
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

    // GET /api/history - Get job history (completed/failed jobs)
    this.app.get("/api/history", async (c) => {
      if (!this.storage) {
        return c.json({ error: "Storage not configured" }, 503);
      }

      const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10));
      const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") ?? "20", 10)));
      const offset = (page - 1) * limit;

      const statusFilter = c.req.query("status");
      let status: ("completed" | "failed")[] = ["completed", "failed"];
      if (statusFilter) {
        const requestedStatuses = statusFilter
          .split(",")
          .filter((s) => s === "completed" || s === "failed");
        if (requestedStatuses.length > 0) {
          status = requestedStatuses as ("completed" | "failed")[];
        }
      }

      const [jobs, total] = await Promise.all([
        this.storage.queryPrintJobs({ status, limit, offset, order: "desc" }),
        this.storage.countPrintJobs({ status }),
      ]);

      const totalPages = Math.ceil(total / limit);

      return c.json({
        jobs: jobs.map((job) => this.serializeHistoryJob(job)),
        pagination: {
          page,
          limit,
          total,
          totalPages,
        },
      });
    });

    // GET /api/history/:id/download - Download print file
    this.app.get("/api/history/:id/download", async (c) => {
      if (!this.storage?.getPrintJobById) {
        return c.json({ error: "Storage not configured" }, 503);
      }

      const id = c.req.param("id");
      const job = await this.storage.getPrintJobById(id);

      if (!job) {
        return c.json({ error: "Job not found" }, 404);
      }

      if (!job.filePath) {
        return c.json({ error: "No file available for this job" }, 404);
      }

      try {
        await stat(job.filePath);
      } catch {
        return c.json({ error: "File not found on disk" }, 404);
      }

      const content = await readFile(job.filePath, "utf-8");
      const filename = basename(job.filePath);

      return new Response(content, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    });

    // GET /api/printers - List available OS printers (native mode)
    this.app.get("/api/printers", async (c) => {
      const printers = await printerDiscovery.listPrinters();
      return c.json({ printers });
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

  private serializeHistoryJob(job: PrintJob): object {
    const messagePreview =
      job.logEntry.message.length > 100
        ? job.logEntry.message.slice(0, 100) + "..."
        : job.logEntry.message;

    return {
      id: job.id,
      logEntryId: job.logEntry.id,
      source: job.logEntry.source,
      messagePreview,
      status: job.status,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.createdAt.toISOString(), // Use createdAt as updatedAt is not in PrintJob type
      retryCount: job.retryCount,
      error: job.error,
      hasFile: !!job.filePath,
    };
  }
}
