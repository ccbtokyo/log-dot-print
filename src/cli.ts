#!/usr/bin/env node

import { readFile } from "fs/promises";
import { resolve } from "path";
import type { SystemConfig } from "./core/index.js";
import { LogPrintApp, type DeepPartial } from "./server/app.js";

async function loadConfig(configPath?: string): Promise<DeepPartial<SystemConfig>> {
  const defaultPath = "config.json";
  const pathToLoad = configPath ?? defaultPath;

  try {
    const fullPath = resolve(process.cwd(), pathToLoad);
    const content = await readFile(fullPath, "utf-8");
    const parsed = JSON.parse(content);
    console.log(`[CLI] Loaded config from ${pathToLoad}`);
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      // JSON parse error - always warn about invalid JSON
      console.error(`[CLI] Invalid JSON in ${pathToLoad}:`, error.message);
    } else if (configPath) {
      // File not found or other error - only warn if explicitly specified
      console.warn(`[CLI] Could not load config from ${configPath}:`, error);
    }
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
  const envPrinterType = process.env.PRINTER_TYPE;
  const envPrinterName = process.env.PRINTER_NAME;

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
      ...(envPrinterType && { type: envPrinterType as SystemConfig["printer"]["type"] }),
      ...(printerType && { type: printerType as SystemConfig["printer"]["type"] }),
      options: {
        ...fileConfig.printer?.options,
        ...(envPrinterName && { printerName: envPrinterName }),
      },
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
  --printer <type>       Printer type (mock, native, cups, escpos, serial, pdf-to-printer)
  --help                 Show this help message

Environment Variables:
  PORT                   Server port (overridden by -p/--port)
  HOST                   Server host (overridden by -h/--host)
  PRINTER_TYPE           Printer type (overridden by --printer)
  PRINTER_NAME           Printer name (for native printer)
  PRINTERS_JS_SIMULATE   Set to "true" for simulation mode (no actual printing)

Example:
  log-dot-print --port 8080 --printer mock
  log-dot-print -c config.json
  PORT=8080 PRINTER_TYPE=native log-dot-print
  PRINTER_TYPE=native PRINTER_NAME="Brother HL-L3230CDW" bun run dev
  PRINTERS_JS_SIMULATE=true PRINTER_TYPE=native bun run dev

API Endpoints:
  POST /api/log          Submit a single log entry
  POST /api/logs         Submit multiple log entries
  GET  /api/health       Health check
  GET  /api/openapi.json OpenAPI specification
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
