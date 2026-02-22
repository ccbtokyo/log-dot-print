#!/usr/bin/env bun
/**
 * POST a JSON file to the log-dot-print server for E2E testing.
 *
 * Port / address defaults are resolved from config.json (same as cli.ts),
 * so running `bun run post payload.json` just works against the local server.
 *
 * Usage:
 *   bun run post <file.json> [options]
 *
 * Options:
 *   --config, -c   Path to config file (default: config.json)
 *   --port, -p     Port number (overrides config)
 *   --address, -a  Host address (overrides config)
 *   --batch, -b    Submit as batch via /api/logs (expects array or wraps single entry)
 *   --help         Show usage
 *
 * Examples:
 *   bun run post payload.json
 *   bun run post payload.json --port 4000
 *   bun run post payload.json -a 192.168.1.10 -p 3000
 *   bun run post payload.json -c config.html.example.json
 *   bun run post payloads.json --batch
 */

import { resolve } from "path";

function printUsage(): void {
  console.log(`
Usage: bun run post <file.json> [options]

Options:
  --config, -c   Path to config file (default: config.json)
  --port, -p     Port number (overrides config)
  --address, -a  Host address (overrides config)
  --batch, -b    Submit as batch via /api/logs
  --help         Show this help

Examples:
  bun run post payload.json
  bun run post payload.json --port 4000
  bun run post payload.json -a 192.168.1.10 -p 3000
  bun run post payload.json -c config.html.example.json
  bun run post payloads.json --batch
`);
}

interface RawArgs {
  filePath: string;
  configPath?: string;
  port?: number;
  address?: string;
  batch: boolean;
}

interface ServerConfig {
  server?: {
    port?: number;
    host?: string;
  };
}

function parseArgs(): RawArgs | null {
  const args = process.argv.slice(2);
  let filePath: string | undefined;
  let configPath: string | undefined;
  let port: number | undefined;
  let address: string | undefined;
  let batch = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    if (arg === "--help") {
      printUsage();
      process.exit(0);
    } else if (arg === "--config" || arg === "-c") {
      configPath = next;
      i++;
    } else if (arg === "--port" || arg === "-p") {
      port = Number(next);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        console.error(`Error: Invalid port "${next}"`);
        return null;
      }
      i++;
    } else if (arg === "--address" || arg === "-a") {
      address = next;
      i++;
    } else if (arg === "--batch" || arg === "-b") {
      batch = true;
    } else if (!arg.startsWith("-") && !filePath) {
      filePath = arg;
    }
  }

  if (!filePath) {
    console.error("Error: JSON file path is required.\n");
    printUsage();
    return null;
  }

  return { filePath, configPath, port, address, batch };
}

async function loadServerConfig(configPath?: string): Promise<ServerConfig> {
  const pathToLoad = configPath ?? "config.json";
  const fullPath = resolve(process.cwd(), pathToLoad);
  const file = Bun.file(fullPath);

  if (!(await file.exists())) {
    if (configPath) {
      console.error(`Error: Config file not found: ${pathToLoad}`);
      process.exit(1);
    }
    return {};
  }

  try {
    const content = await file.text();
    const parsed = JSON.parse(content) as ServerConfig;
    console.log(`Config: ${pathToLoad}`);
    return parsed;
  } catch {
    console.error(`Error: Failed to parse config: ${pathToLoad}`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const raw = parseArgs();
  if (!raw) {
    process.exit(1);
  }

  const config = await loadServerConfig(raw.configPath);

  // CLI args > config.json > defaults
  const port = raw.port ?? config.server?.port ?? 3000;
  const host = config.server?.host ?? "0.0.0.0";
  // For the POST target, prefer CLI address.
  // When not specified, derive from config host (0.0.0.0 → localhost).
  const address = raw.address ?? (host === "0.0.0.0" ? "localhost" : host);
  const batch = raw.batch;

  // Read JSON payload file
  const file = Bun.file(raw.filePath);
  if (!(await file.exists())) {
    console.error(`Error: File not found: ${raw.filePath}`);
    process.exit(1);
  }

  const content = await file.text();
  let payload: unknown;
  try {
    payload = JSON.parse(content);
  } catch {
    console.error(`Error: Failed to parse JSON: ${raw.filePath}`);
    process.exit(1);
  }

  const baseUrl = `http://${address}:${port}`;
  const endpoint = batch ? "/api/logs" : "/api/log";
  const url = `${baseUrl}${endpoint}`;

  // Wrap in array for batch mode if needed
  const body = batch && !Array.isArray(payload) ? [payload] : payload;

  console.log(`POST ${url}`);
  console.log(`File: ${raw.filePath}`);
  console.log(`Mode: ${batch ? "batch" : "single"}`);
  console.log("─".repeat(60));

  const start = performance.now();
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const duration = performance.now() - start;
    const result = await response.json();

    console.log(`Status: ${response.status} (${duration.toFixed(0)}ms)`);
    console.log("─".repeat(60));
    console.log(JSON.stringify(result, null, 2));

    if (!response.ok) {
      process.exit(1);
    }
  } catch (error) {
    const duration = performance.now() - start;
    console.error(`\nFailed after ${duration.toFixed(0)}ms`);
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
