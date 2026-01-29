/**
 * Bun native HTTP + WebSocket server
 * Provides unified server using Bun.serve() with WebSocket upgrade handling
 */

import type { Server, ServerWebSocket } from "bun";
import type { WebSocketHandler } from "./websocket-types.js";

export interface BunServerOptions {
  port: number;
  hostname: string;
  fetch: (request: Request, server: Server<WebSocketData>) => Response | Promise<Response>;
  wsHandlers: Map<string, WebSocketHandler>;
}

export interface WebSocketData {
  path: string;
  remoteAddress: string;
}

/**
 * Create a Bun server with HTTP and WebSocket support
 */
export function createBunServer(options: BunServerOptions): Server<WebSocketData> {
  const { port, hostname, fetch, wsHandlers } = options;

  return Bun.serve<WebSocketData>({
    port,
    hostname,
    fetch: async (request: Request, server: Server<WebSocketData>): Promise<Response> => {
      const url = new URL(request.url);

      // Check if this is a WebSocket upgrade request
      if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
        for (const [path, _handler] of wsHandlers) {
          if (url.pathname === path) {
            const remoteAddress =
              server.requestIP(request)?.address ?? request.headers.get("x-forwarded-for") ?? "";
            const success = server.upgrade(request, {
              data: {
                path,
                remoteAddress,
              },
            });
            if (success) {
              return new Response(null, { status: 101 });
            }
            return new Response("WebSocket upgrade failed", { status: 500 });
          }
        }
        return new Response("Not Found", { status: 404 });
      }

      // Handle regular HTTP requests
      return fetch(request, server);
    },
    websocket: {
      open(ws: ServerWebSocket<WebSocketData>) {
        const handler = wsHandlers.get(ws.data.path);
        handler?.onOpen?.(ws);
      },
      message(ws: ServerWebSocket<WebSocketData>, message: string | Buffer) {
        const handler = wsHandlers.get(ws.data.path);
        const messageStr = typeof message === "string" ? message : message.toString("utf-8");
        handler?.onMessage?.(ws, messageStr);
      },
      close(ws: ServerWebSocket<WebSocketData>, code: number, reason: string) {
        const handler = wsHandlers.get(ws.data.path);
        handler?.onClose?.(ws, code, reason);
      },
    },
  });
}
