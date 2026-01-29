/**
 * WebSocket handler interface for Bun native WebSocket
 */

import type { ServerWebSocket } from "bun";
import type { WebSocketData } from "./bun-server.js";

export interface WebSocketHandler {
  onOpen?(ws: ServerWebSocket<WebSocketData>): void;
  onMessage?(ws: ServerWebSocket<WebSocketData>, message: string): void;
  onClose?(ws: ServerWebSocket<WebSocketData>, code: number, reason: string): void;
}
