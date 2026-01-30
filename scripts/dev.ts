#!/usr/bin/env bun
/**
 * Cross-platform development script
 * Runs UI build watcher and server with hot reload in parallel
 */
import { spawn, type Subprocess } from "bun";

const processes: Subprocess[] = [];

function cleanup() {
  console.log("\n[dev] Shutting down...");
  for (const proc of processes) {
    proc.kill();
  }
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

async function main() {
  // 1. Build UI first (one-time)
  console.log("[dev] Building UI...");
  const buildResult = await Bun.spawn(["bun", "run", "build:ui"], {
    stdio: ["inherit", "inherit", "inherit"],
  }).exited;

  if (buildResult !== 0) {
    console.error("[dev] UI build failed");
    process.exit(1);
  }

  // 2. Start UI watcher
  console.log("[dev] Starting UI watcher...");
  const uiWatcher = spawn(["bun", "run", "dev:ui"], {
    stdio: ["inherit", "inherit", "inherit"],
  });
  processes.push(uiWatcher);

  // 3. Start server with hot reload
  console.log("[dev] Starting server with hot reload...");
  const server = spawn(["bun", "--hot", "src/cli.ts"], {
    stdio: ["inherit", "inherit", "inherit"],
  });
  processes.push(server);

  // Wait for either process to exit
  const results = await Promise.race([uiWatcher.exited, server.exited]);

  console.log(`[dev] Process exited with code ${results}`);
  cleanup();
}

main().catch((err) => {
  console.error("[dev] Error:", err);
  cleanup();
});
