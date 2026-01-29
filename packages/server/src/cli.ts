#!/usr/bin/env node

import { readFile } from "fs/promises";
import { resolve } from "path";
import type { SystemConfig } from "@log-dot-print/core";
import { LogPrintApp, type DeepPartial } from "./app.js";

async function loadConfig(configPath?: string): Promise<DeepPartial<SystemConfig>> {
  if (!configPath) {
    return {};
  }

  try {
    const fullPath = resolve(process.cwd(), configPath);
    const content = await readFile(fullPath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.warn(`[CLI] Could not load config from ${configPath}:`, error);
    return {};
  }
}

async function main(): Promise<void> {
  console.log("╔════════════════════════════════════════╗");
  console.log("║      Log-Dot-Print Server v1.0.0       ║");
  console.log("║   AI Log Printer for Art Installations ║");
  console.log("╚════════════════════════════════════════╝");
  console.log("");

  // Parse command line arguments
  const args = process.argv.slice(2);
  let configPath: string | undefined;
  let port: number | undefined;
  let host: string | undefined;
  let printerType: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--config" || arg === "-c") {
      configPath = args[++i];
    } else if (arg === "--port" || arg === "-p") {
      port = parseInt(args[++i], 10);
    } else if (arg === "--host" || arg === "-h") {
      host = args[++i];
    } else if (arg === "--printer") {
      printerType = args[++i];
    } else if (arg === "--help") {
      printHelp();
      process.exit(0);
    }
  }

  // Load config file
  const fileConfig = await loadConfig(configPath);

  // Read from environment variables (CLI args take precedence)
  const envPort = process.env.PORT ? parseInt(process.env.PORT, 10) : undefined;
  const envHost = process.env.HOST;

  // Build config with CLI overrides (priority: CLI > env > file config)
  const config: DeepPartial<SystemConfig> = {
    ...fileConfig,
    server: {
      ...fileConfig.server,
      ...(envPort && { port: envPort }),
      ...(envHost && { host: envHost }),
      ...(port && { port }),
      ...(host && { host }),
    },
    printer: {
      ...fileConfig.printer,
      ...(printerType && { type: printerType as SystemConfig["printer"]["type"] }),
    },
  };

  // Create and start app
  const app = new LogPrintApp(config);

  // Handle shutdown signals
  const shutdown = async () => {
    console.log("\n[CLI] Received shutdown signal");
    await app.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    await app.start();
  } catch (error) {
    console.error("[CLI] Failed to start:", error);
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
Usage: log-dot-print [options]

Options:
  -c, --config <path>    Path to config file (JSON)
  -p, --port <port>      Server port (default: 3000)
  -h, --host <host>      Server host (default: 0.0.0.0)
  --printer <type>       Printer type (mock, cups, escpos, serial)
  --help                 Show this help message

Environment Variables:
  PORT                   Server port (overridden by -p/--port)
  HOST                   Server host (overridden by -h/--host)

Example:
  log-dot-print --port 8080 --printer mock
  log-dot-print -c config.json
  PORT=8080 log-dot-print --printer mock

API Endpoints:
  POST /log              Submit a single log entry
  POST /logs             Submit multiple log entries
  GET  /health           Health check
  WS   /ws               WebSocket connection for real-time streaming

Log Entry Format:
  {
    "event": "AI_Character_1",
    "message": "I should move towards the player",
    "metadata": { "target": "player", "distance": 5.2 }
  }
  (source is derived from request headers; level is not used)
`);
}

main().catch(console.error);
