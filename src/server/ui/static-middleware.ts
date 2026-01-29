/**
 * Static file middleware for serving UI files
 * @see docs/architecture.md for design details
 */

import { stat, readFile } from "fs/promises";
import { join, extname, resolve } from "path";
import type { IncomingMessage, ServerResponse } from "http";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
  ".map": "application/json",
};

/**
 * Configuration for static middleware
 */
export interface StaticMiddlewareConfig {
  /** Base path to serve static files from (e.g., /ui) */
  basePath: string;
  /** Directory containing static files */
  staticDir: string;
  /** Default file to serve for directory requests */
  indexFile?: string;
  /** Enable caching headers */
  enableCache?: boolean;
  /** Cache max-age in seconds */
  maxAge?: number;
}

/**
 * Static file middleware
 */
export class StaticMiddleware {
  private config: Required<StaticMiddlewareConfig>;

  constructor(config: StaticMiddlewareConfig) {
    this.config = {
      indexFile: "index.html",
      enableCache: true,
      maxAge: 3600,
      ...config,
      staticDir: resolve(config.staticDir),
      basePath: config.basePath.endsWith("/") ? config.basePath.slice(0, -1) : config.basePath,
    };
  }

  /**
   * Handle a request for static files
   * Returns true if the request was handled, false otherwise
   */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = req.url ?? "/";

    // Check if request matches our base path
    if (!url.startsWith(this.config.basePath)) {
      return false;
    }

    // Extract the file path from URL
    let filePath = url.slice(this.config.basePath.length);
    if (!filePath || filePath === "/") {
      filePath = `/${this.config.indexFile}`;
    }

    // Remove query string if present
    const queryIndex = filePath.indexOf("?");
    if (queryIndex !== -1) {
      filePath = filePath.slice(0, queryIndex);
    }

    // Security: prevent directory traversal
    const fullPath = join(this.config.staticDir, filePath);
    if (!fullPath.startsWith(this.config.staticDir)) {
      this.sendError(res, 403, "Forbidden");
      return true;
    }

    try {
      const stats = await stat(fullPath);

      if (stats.isDirectory()) {
        // Try to serve index file from directory
        const indexPath = join(fullPath, this.config.indexFile);
        return await this.serveFile(res, indexPath);
      }

      return await this.serveFile(res, fullPath);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        this.sendError(res, 404, "Not Found");
      } else {
        console.error("[StaticMiddleware] Error serving file:", err);
        this.sendError(res, 500, "Internal Server Error");
      }
      return true;
    }
  }

  private async serveFile(res: ServerResponse, filePath: string): Promise<boolean> {
    try {
      const content = await readFile(filePath);
      const ext = extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Length", content.length);

      if (this.config.enableCache) {
        res.setHeader("Cache-Control", `public, max-age=${this.config.maxAge}`);
      } else {
        res.setHeader("Cache-Control", "no-cache");
      }

      res.statusCode = 200;
      res.end(content);
      return true;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        this.sendError(res, 404, "Not Found");
      } else {
        console.error("[StaticMiddleware] Error reading file:", err);
        this.sendError(res, 500, "Internal Server Error");
      }
      return true;
    }
  }

  private sendError(res: ServerResponse, statusCode: number, message: string): void {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.statusCode = statusCode;
    res.end(message);
  }

  /**
   * Handle a request for static files using Bun's native Request/Response
   * Returns a Response if handled, null otherwise
   */
  async handleBun(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Check if request matches our base path
    if (!pathname.startsWith(this.config.basePath)) {
      return null;
    }

    // Extract the file path from URL
    let filePath = pathname.slice(this.config.basePath.length);
    if (!filePath || filePath === "/") {
      filePath = `/${this.config.indexFile}`;
    }

    // Security: prevent directory traversal
    const fullPath = join(this.config.staticDir, filePath);
    if (!fullPath.startsWith(this.config.staticDir)) {
      return new Response("Forbidden", {
        status: 403,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    try {
      const stats = await stat(fullPath);

      if (stats.isDirectory()) {
        // Try to serve index file from directory
        const indexPath = join(fullPath, this.config.indexFile);
        return await this.serveFileBun(indexPath);
      }

      return await this.serveFileBun(fullPath);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return new Response("Not Found", {
          status: 404,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
      console.error("[StaticMiddleware] Error serving file:", err);
      return new Response("Internal Server Error", {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  }

  private async serveFileBun(filePath: string): Promise<Response> {
    try {
      const content = await readFile(filePath);
      const ext = extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

      const headers: Record<string, string> = {
        "Content-Type": contentType,
        "Content-Length": String(content.length),
      };

      if (this.config.enableCache) {
        headers["Cache-Control"] = `public, max-age=${this.config.maxAge}`;
      } else {
        headers["Cache-Control"] = "no-cache";
      }

      return new Response(content, { status: 200, headers });
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return new Response("Not Found", {
          status: 404,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
      console.error("[StaticMiddleware] Error reading file:", err);
      return new Response("Internal Server Error", {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  }
}
