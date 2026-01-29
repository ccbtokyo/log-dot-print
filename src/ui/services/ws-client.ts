/**
 * WebSocket client with automatic reconnection
 */

import type { ClientMessage, ServerMessage } from "../types.js";

export type ConnectionState = "connecting" | "connected" | "disconnected" | "reconnecting";

export interface WSClientOptions {
  url: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export type MessageHandler = (message: ServerMessage) => void;
export type ConnectionHandler = (state: ConnectionState) => void;

export class WSClient {
  private ws: WebSocket | null = null;
  private options: Required<WSClientOptions>;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private messageHandlers = new Set<MessageHandler>();
  private connectionHandlers = new Set<ConnectionHandler>();
  private state: ConnectionState = "disconnected";

  constructor(options: WSClientOptions) {
    this.options = {
      reconnectInterval: 3000,
      maxReconnectAttempts: 10,
      ...options,
    };
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    this.updateState("connecting");
    this.ws = new WebSocket(this.options.url);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.updateState("connected");
      this.startPing();

      // Request initial state
      this.send({ type: "subscribe" });
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as ServerMessage;
        this.notifyMessageHandlers(message);
      } catch (error) {
        console.error("[WSClient] Failed to parse message:", error);
      }
    };

    this.ws.onclose = () => {
      this.stopPing();
      this.handleDisconnect();
    };

    this.ws.onerror = (error) => {
      console.error("[WSClient] WebSocket error:", error);
    };
  }

  disconnect(): void {
    this.stopReconnect();
    this.stopPing();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.updateState("disconnected");
  }

  send(message: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  pause(): void {
    this.send({ type: "pause" });
  }

  resume(): void {
    this.send({ type: "resume" });
  }

  skip(jobId: string): void {
    this.send({ type: "skip", jobId });
  }

  prioritize(jobId: string): void {
    this.send({ type: "prioritize", jobId });
  }

  clear(): void {
    this.send({ type: "clear" });
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onConnectionChange(handler: ConnectionHandler): () => void {
    this.connectionHandlers.add(handler);
    // Immediately call with current state
    handler(this.state);
    return () => this.connectionHandlers.delete(handler);
  }

  getState(): ConnectionState {
    return this.state;
  }

  private updateState(newState: ConnectionState): void {
    if (this.state !== newState) {
      this.state = newState;
      this.notifyConnectionHandlers();
    }
  }

  private notifyMessageHandlers(message: ServerMessage): void {
    for (const handler of this.messageHandlers) {
      try {
        handler(message);
      } catch (error) {
        console.error("[WSClient] Message handler error:", error);
      }
    }
  }

  private notifyConnectionHandlers(): void {
    for (const handler of this.connectionHandlers) {
      try {
        handler(this.state);
      } catch (error) {
        console.error("[WSClient] Connection handler error:", error);
      }
    }
  }

  private handleDisconnect(): void {
    this.ws = null;

    if (this.reconnectAttempts < this.options.maxReconnectAttempts) {
      this.updateState("reconnecting");
      this.scheduleReconnect();
    } else {
      this.updateState("disconnected");
    }
  }

  private scheduleReconnect(): void {
    this.stopReconnect();

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      console.log(
        `[WSClient] Reconnecting (attempt ${this.reconnectAttempts}/${this.options.maxReconnectAttempts})...`,
      );
      this.connect();
    }, this.options.reconnectInterval);
  }

  private stopReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      this.send({ type: "ping" });
    }, 30000);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}
