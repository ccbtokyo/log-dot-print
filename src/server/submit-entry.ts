/**
 * Shared utility for submitting a log entry through the event bus pipeline.
 * Used by HttpReceiver, WebSocketReceiver, and QueueController (replay).
 *
 * @related src/server/http-server.ts - HttpReceiver
 * @related src/server/websocket-server.ts - WebSocketReceiver
 * @related src/server/ui/queue-controller.ts - QueueController (replay)
 */

import type { LogEntry, LogSubmitResult, TypedEventEmitter } from "../core/index.js";

const SUBMISSION_TIMEOUT_MS = 300_000;

/**
 * Submit a log entry to the event bus and wait for the result.
 * Includes timeout protection and settled guard to prevent double-resolution.
 */
export function submitEntry(
  eventBus: TypedEventEmitter,
  entry: LogEntry,
): Promise<LogSubmitResult> {
  return new Promise((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({
        accepted: false,
        id: entry.id,
        code: "timeout",
        message: "Submission timed out",
      });
    }, SUBMISSION_TIMEOUT_MS);

    const handled = eventBus.emit("log:received", entry, (result: LogSubmitResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    });

    if (!handled) {
      settled = true;
      clearTimeout(timeout);
      resolve({
        accepted: false,
        id: entry.id,
        code: "no_handler",
        message: "No log handler registered",
      });
    }
  });
}
