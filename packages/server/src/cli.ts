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

  // Build config with CLI overrides
  const config: DeepPartial<SystemConfig> = {
    ...fileConfig,
    server: {
      ...fileConfig.server,
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

Example:
  log-dot-print --port 8080 --printer mock
  log-dot-print -c config.json

API Endpoints:
  POST /log              Submit a single log entry
  POST /logs             Submit multiple log entries
  GET  /health           Health check
  WS   /ws               WebSocket connection for real-time streaming

Log Entry Format:
  {
    "source": "AI_Character_1",
    "level": "thought",
    "message": "I should move towards the player",
    "metadata": { "target": "player", "distance": 5.2 }
  }
`);
}

main().catch(console.error);
