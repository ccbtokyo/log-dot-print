import { createServer, IncomingMessage, ServerResponse } from 'http';
import type {
  LogEntry,
  LogReceiverPlugin,
  SystemConfig,
  TypedEventEmitter,
} from '@log-dot-print/core';
import { parseLogEntry } from '@log-dot-print/core';

/**
 * HTTP server for receiving log entries via REST API
 */
export class HttpReceiver implements LogReceiverPlugin {
  readonly name = 'http-receiver';
  readonly version = '1.0.0';

  private server: ReturnType<typeof createServer> | null = null;
  private eventBus: TypedEventEmitter | null = null;
  private config: SystemConfig | null = null;

  async initialize(eventBus: TypedEventEmitter, config: SystemConfig): Promise<void> {
    this.eventBus = eventBus;
    this.config = config;
  }

  async shutdown(): Promise<void> {
    await this.stop();
  }

  async start(): Promise<void> {
    if (!this.config || !this.eventBus) {
      throw new Error('HttpReceiver not initialized');
    }

    const { port, host } = this.config.server;

    this.server = createServer((req, res) => {
      this.handleRequest(req, res);
    });

    return new Promise((resolve, reject) => {
      this.server!.on('error', reject);
      this.server!.listen(port, host, () => {
        console.log(`[HttpReceiver] Listening on http://${host}:${port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('[HttpReceiver] Server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health check
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    // Log submission
    if (req.method === 'POST' && req.url === '/log') {
      this.handleLogSubmit(req, res);
      return;
    }

    // Batch log submission
    if (req.method === 'POST' && req.url === '/logs') {
      this.handleBatchLogSubmit(req, res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  private handleLogSubmit(req: IncomingMessage, res: ServerResponse): void {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const entry = parseLogEntry(data);

        if (!entry) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid log entry' }));
          return;
        }

        this.eventBus?.emit('log:received', entry);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, id: entry.id }));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  }

  private handleBatchLogSubmit(req: IncomingMessage, res: ServerResponse): void {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const data = JSON.parse(body);

        if (!Array.isArray(data)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Expected array of log entries' }));
          return;
        }

        const results: { id: string; success: boolean }[] = [];

        for (const item of data) {
          const entry = parseLogEntry(item);
          if (entry) {
            this.eventBus?.emit('log:received', entry);
            results.push({ id: entry.id, success: true });
          } else {
            results.push({ id: '', success: false });
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ results }));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  }
}
