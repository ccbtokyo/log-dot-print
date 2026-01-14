import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type {
  LogReceiverPlugin,
  SystemConfig,
  TypedEventEmitter,
} from '@log-dot-print/core';
import { parseLogEntry } from '@log-dot-print/core';

/**
 * WebSocket server for real-time log streaming from UE
 */
export class WebSocketReceiver implements LogReceiverPlugin {
  readonly name = 'websocket-receiver';
  readonly version = '1.0.0';

  private wss: WebSocketServer | null = null;
  private eventBus: TypedEventEmitter | null = null;
  private clients = new Set<WebSocket>();

  async initialize(eventBus: TypedEventEmitter, _config: SystemConfig): Promise<void> {
    this.eventBus = eventBus;
  }

  async shutdown(): Promise<void> {
    await this.stop();
  }

  /**
   * Attach to an existing HTTP server
   */
  attachToServer(server: Server): void {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.setupWebSocket();
    console.log('[WebSocketReceiver] Attached to HTTP server on /ws');
  }

  async start(): Promise<void> {
    // WebSocket is attached to HTTP server, nothing to start separately
  }

  async stop(): Promise<void> {
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();

    return new Promise((resolve) => {
      if (this.wss) {
        this.wss.close(() => {
          console.log('[WebSocketReceiver] Server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private setupWebSocket(): void {
    if (!this.wss) return;

    this.wss.on('connection', (ws) => {
      console.log('[WebSocketReceiver] Client connected');
      this.clients.add(ws);

      ws.on('message', (data) => {
        this.handleMessage(ws, data.toString());
      });

      ws.on('close', () => {
        console.log('[WebSocketReceiver] Client disconnected');
        this.clients.delete(ws);
      });

      ws.on('error', (error) => {
        console.error('[WebSocketReceiver] Client error:', error);
        this.clients.delete(ws);
      });

      // Send welcome message
      ws.send(JSON.stringify({ type: 'connected', message: 'Log receiver ready' }));
    });
  }

  private handleMessage(ws: WebSocket, message: string): void {
    try {
      const data = JSON.parse(message);

      // Handle different message types
      if (data.type === 'log') {
        const entry = parseLogEntry(data.payload || data);
        if (entry) {
          this.eventBus?.emit('log:received', entry);
          ws.send(JSON.stringify({ type: 'ack', id: entry.id }));
        } else {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid log entry' }));
        }
      } else if (data.type === 'batch') {
        const entries = Array.isArray(data.payload) ? data.payload : [];
        const ids: string[] = [];
        for (const item of entries) {
          const entry = parseLogEntry(item);
          if (entry) {
            this.eventBus?.emit('log:received', entry);
            ids.push(entry.id);
          }
        }
        ws.send(JSON.stringify({ type: 'batch_ack', ids }));
      } else if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      } else {
        // Treat as direct log entry
        const entry = parseLogEntry(data);
        if (entry) {
          this.eventBus?.emit('log:received', entry);
          ws.send(JSON.stringify({ type: 'ack', id: entry.id }));
        }
      }
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
    }
  }

  /**
   * Broadcast a message to all connected clients
   */
  broadcast(message: object): void {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  /**
   * Get connected client count
   */
  get clientCount(): number {
    return this.clients.size;
  }
}
