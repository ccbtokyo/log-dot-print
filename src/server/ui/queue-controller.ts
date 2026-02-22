/**
 * REST API controller for queue management
 * @see docs/architecture.md for design details
 * @related packages/printer-core/src/queue.ts - PrintQueue
 */

import { Hono } from "hono";
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import type {
  PrintJob,
  TypedEventEmitter,
  QueuePersistencePlugin,
  PrinterSettings,
  PaperListResponse,
  PaperSettings,
} from "../../core/index.js";
import type { SqliteStorage } from "../../storage/sqlite-storage.js";
import type { PrintQueue } from "../../printers/index.js";
import type { LogFormatterPlugin } from "../../core/index.js";
import { printerDiscovery } from "../../printers/discovery.js";
import { getAvailablePaperSizes } from "../../printers/paper-discovery.js";

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
        console.warn("[QueueController] Storage not configured for /api/history");
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

      console.log(
        `[QueueController] History query: status=${status.join(",")}, offset=${offset}, limit=${limit}`,
      );

      const [jobs, total] = await Promise.all([
        this.storage.queryPrintJobs({ status, limit, offset, order: "desc" }),
        this.storage.countPrintJobs({ status }),
      ]);

      console.log(`[QueueController] History result: ${jobs.length} jobs, total=${total}`);

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
      try {
        console.log("[QueueController] Listing printers...");
        const printers = await printerDiscovery.listPrinters();
        console.log(`[QueueController] Found ${printers.length} printers`);
        return c.json({ printers });
      } catch (error) {
        console.error("[QueueController] Failed to list printers:", error);
        return c.json({ error: "Failed to list printers", details: String(error) }, 500);
      }
    });

    // GET /api/settings/printer - Get printer settings
    this.app.get("/api/settings/printer", async (c) => {
      try {
        const printers = await printerDiscovery.listPrinters();
        const sqliteStorage = this.storage as SqliteStorage | undefined;
        const savedPrinter = sqliteStorage?.getSetting
          ? await sqliteStorage.getSetting("printer.name")
          : null;

        const currentPrinter = savedPrinter ?? null;
        const isDefault = savedPrinter === null;

        const response: PrinterSettings = {
          currentPrinter,
          availablePrinters: printers,
          isDefault,
        };

        return c.json(response);
      } catch (error) {
        console.error("[QueueController] Failed to get printer settings:", error);
        return c.json({ error: "Failed to get printer settings", details: String(error) }, 500);
      }
    });

    // PUT /api/settings/printer - Update printer setting
    this.app.put("/api/settings/printer", async (c) => {
      const sqliteStorage = this.storage as SqliteStorage | undefined;
      if (!sqliteStorage?.setSetting) {
        return c.json({ error: "Storage not configured for settings" }, 503);
      }

      let body: { printerName?: string | null };
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
      }

      if (typeof body !== "object" || body === null || !("printerName" in body)) {
        return c.json({ error: "Missing printerName field" }, 400);
      }

      const { printerName } = body;

      try {
        if (printerName === null) {
          // Clear the setting to use default
          await sqliteStorage.deleteSetting("printer.name");
          console.log("[QueueController] Printer setting cleared (using default)");
        } else if (typeof printerName === "string") {
          await sqliteStorage.setSetting("printer.name", printerName);
          console.log(`[QueueController] Printer setting saved: ${printerName}`);
        }

        return c.json({ success: true, printerName });
      } catch (error) {
        console.error("[QueueController] Failed to save printer setting:", error);
        return c.json({ error: "Failed to save printer setting", details: String(error) }, 500);
      }
    });

    // GET /api/papers - List available paper sizes
    this.app.get("/api/papers", async (c) => {
      try {
        const sqliteStorage = this.storage as SqliteStorage | undefined;
        const savedPrinter = sqliteStorage?.getSetting
          ? await sqliteStorage.getSetting("printer.name")
          : null;

        const result = await getAvailablePaperSizes(savedPrinter);
        const response: PaperListResponse = {
          paperSizes: result.paperSizes,
          paperSizeDetails: result.paperSizeDetails,
          source: result.source,
          printerName: result.printerName,
        };
        return c.json(response);
      } catch (error) {
        console.error("[QueueController] Failed to get paper sizes:", error);
        return c.json({ error: "Failed to get paper sizes", details: String(error) }, 500);
      }
    });

    // GET /api/settings/paper - Get current paper setting
    this.app.get("/api/settings/paper", async (c) => {
      try {
        const sqliteStorage = this.storage as SqliteStorage | undefined;
        const savedPaperSize = sqliteStorage?.getSetting
          ? await sqliteStorage.getSetting("printer.paperSize")
          : null;
        const savedPaperKindRaw = sqliteStorage?.getSetting
          ? await sqliteStorage.getSetting("printer.paperKind")
          : null;
        let currentPaperKind: number | null = null;
        if (savedPaperKindRaw !== null) {
          const parsed = parseInt(savedPaperKindRaw, 10);
          if (Number.isFinite(parsed) && parsed > 0) {
            currentPaperKind = parsed;
          }
        }

        const response: PaperSettings = {
          currentPaperSize: savedPaperSize ?? null,
          currentPaperKind,
          isDefault: savedPaperSize === null,
        };
        return c.json(response);
      } catch (error) {
        console.error("[QueueController] Failed to get paper settings:", error);
        return c.json({ error: "Failed to get paper settings", details: String(error) }, 500);
      }
    });

    // PUT /api/settings/paper - Update paper setting
    this.app.put("/api/settings/paper", async (c) => {
      const sqliteStorage = this.storage as SqliteStorage | undefined;
      if (!sqliteStorage?.setSetting) {
        return c.json({ error: "Storage not configured for settings" }, 503);
      }

      let body: { paperSize?: string | null; paperKind?: number | null };
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
      }

      if (typeof body !== "object" || body === null || !("paperSize" in body)) {
        return c.json({ error: "Missing paperSize field" }, 400);
      }

      const { paperSize, paperKind } = body;

      try {
        if (paperSize === null) {
          await sqliteStorage.deleteSetting("printer.paperSize");
          await sqliteStorage.deleteSetting("printer.paperKind");
          console.log("[QueueController] Paper size/kind setting cleared (using default)");
          return c.json({ success: true, paperSize: null, paperKind: null });
        }

        if (typeof paperSize !== "string" || !paperSize.trim()) {
          return c.json({ error: "paperSize must be a non-empty string or null" }, 400);
        }

        const trimmed = paperSize.trim();

        // Validate against available sizes
        const sqliteStorageForPrinter = this.storage as SqliteStorage | undefined;
        const savedPrinter = sqliteStorageForPrinter?.getSetting
          ? await sqliteStorageForPrinter.getSetting("printer.name")
          : null;
        const available = await getAvailablePaperSizes(savedPrinter);
        if (!available.paperSizes.includes(trimmed)) {
          return c.json(
            {
              error: `Unknown paper size: "${trimmed}"`,
              availableSizes: available.paperSizes,
            },
            400,
          );
        }

        await sqliteStorage.setSetting("printer.paperSize", trimmed);

        // Handle paperKind: save, clear, or reject invalid values.
        // When paperKind is not provided, clear the stored value to avoid
        // stale dmPaperSize mismatching the new paperSize.
        let savedPaperKind: number | null = null;
        if ("paperKind" in body && paperKind !== undefined && paperKind !== null) {
          // Validate paperKind is a positive integer
          if (
            typeof paperKind !== "number" ||
            !Number.isFinite(paperKind) ||
            !Number.isInteger(paperKind) ||
            paperKind <= 0
          ) {
            return c.json({ error: "paperKind must be a positive integer or null" }, 400);
          }
          // Validate paperKind matches the paperSize in discovery data (when rawKind is known)
          const matchingDetail = available.paperSizeDetails.find((d) => d.name === trimmed);
          if (
            matchingDetail !== undefined &&
            matchingDetail.rawKind !== null &&
            matchingDetail.rawKind !== paperKind
          ) {
            return c.json(
              {
                error: `paperKind ${paperKind} does not match paper size "${trimmed}" (expected ${matchingDetail.rawKind})`,
              },
              400,
            );
          }
          await sqliteStorage.setSetting("printer.paperKind", String(paperKind));
          savedPaperKind = paperKind;
          console.log(`[QueueController] Paper setting saved: ${trimmed} (paperKind=${paperKind})`);
        } else {
          await sqliteStorage.deleteSetting("printer.paperKind");
          console.log(`[QueueController] Paper size setting saved: ${trimmed} (paperKind cleared)`);
        }

        return c.json({ success: true, paperSize: trimmed, paperKind: savedPaperKind });
      } catch (error) {
        console.error("[QueueController] Failed to save paper setting:", error);
        return c.json({ error: "Failed to save paper setting", details: String(error) }, 500);
      }
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
