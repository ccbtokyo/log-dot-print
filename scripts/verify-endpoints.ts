#!/usr/bin/env bun
/**
 * Endpoint verification script
 * Usage: bun verify [options]
 *
 * Options:
 *   --host, -h    Host name (default: localhost)
 *   --port, -p    Port number (default: 3000)
 *   --url, -u     Full base URL (overrides host/port)
 *
 * Examples:
 *   bun verify
 *   bun verify --host nre3336 --port 3000
 *   bun verify -h nre3336 -p 3000
 *   bun verify --url http://nre3336:3000
 */

function parseArgs(): { baseUrl: string } {
  const args = process.argv.slice(2);
  let host = process.env.VERIFY_HOST || "localhost";
  let port = process.env.VERIFY_PORT || "3000";
  let url: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    if (arg === "--host" || arg === "-h") {
      host = next;
      i++;
    } else if (arg === "--port" || arg === "-p") {
      port = next;
      i++;
    } else if (arg === "--url" || arg === "-u") {
      url = next;
      i++;
    } else if (arg === "--help") {
      console.log(`
Endpoint verification script

Usage: bun verify [options]

Options:
  --host, -h    Host name (default: localhost)
  --port, -p    Port number (default: 3000)
  --url, -u     Full base URL (overrides host/port)

Environment variables:
  VERIFY_HOST   Default host
  VERIFY_PORT   Default port

Examples:
  bun verify
  bun verify --host nre3336 --port 3000
  bun verify -h nre3336 -p 3000
  bun verify --url http://nre3336:3000
`);
      process.exit(0);
    }
  }

  const baseUrl = url || `http://${host}:${port}`;
  return { baseUrl };
}

const { baseUrl: BASE_URL } = parseArgs();

interface TestResult {
  name: string;
  endpoint: string;
  method: string;
  status: "pass" | "fail" | "skip";
  statusCode?: number;
  expected?: number[];
  error?: string;
  duration?: number;
}

const results: TestResult[] = [];

async function test(
  name: string,
  method: string,
  path: string,
  options: {
    body?: unknown;
    expected?: number[];
    skip?: boolean;
  } = {},
): Promise<void> {
  const { body, expected = [200], skip = false } = options;
  const endpoint = `${method} ${path}`;

  if (skip) {
    results.push({ name, endpoint, method, status: "skip" });
    return;
  }

  const start = performance.now();
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });

    const duration = performance.now() - start;
    const passed = expected.includes(response.status);

    results.push({
      name,
      endpoint,
      method,
      status: passed ? "pass" : "fail",
      statusCode: response.status,
      expected,
      duration,
      error: passed ? undefined : `Expected ${expected.join("|")}, got ${response.status}`,
    });
  } catch (error) {
    const duration = performance.now() - start;
    results.push({
      name,
      endpoint,
      method,
      status: "fail",
      duration,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function testWebSocket(name: string, path: string): Promise<void> {
  const wsUrl = BASE_URL.replace(/^http/, "ws") + path;
  const endpoint = `WS ${path}`;

  const start = performance.now();
  try {
    const ws = new WebSocket(wsUrl);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("Connection timeout"));
      }, 5000);

      ws.onopen = () => {
        clearTimeout(timeout);
        ws.close();
        resolve();
      };

      ws.onerror = (event) => {
        clearTimeout(timeout);
        reject(new Error("WebSocket error"));
      };
    });

    const duration = performance.now() - start;
    results.push({
      name,
      endpoint,
      method: "WS",
      status: "pass",
      duration,
    });
  } catch (error) {
    const duration = performance.now() - start;
    results.push({
      name,
      endpoint,
      method: "WS",
      status: "fail",
      duration,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function runTests(): Promise<void> {
  console.log(`\n🔍 Verifying endpoints at ${BASE_URL}\n`);

  // Health check
  await test("Health check", "GET", "/health");

  // OpenAPI spec
  await test("OpenAPI spec", "GET", "/openapi.json");

  // Log submission
  await test("Submit single log", "POST", "/log", {
    body: { message: "verify test", level: "info" },
  });

  await test("Submit batch logs", "POST", "/logs", {
    body: [
      { message: "batch test 1", level: "info" },
      { message: "batch test 2", level: "debug" },
    ],
  });

  // Queue API
  await test("Get queue", "GET", "/api/queue");
  await test("Get printers", "GET", "/api/printers");
  await test("Get history", "GET", "/api/history");

  // Queue control (these may return various status codes depending on state)
  await test("Pause queue", "POST", "/api/queue/pause", { expected: [200, 400] });
  await test("Resume queue", "POST", "/api/queue/resume", { expected: [200, 400] });

  // UI static files
  await test("UI index", "GET", "/ui/", { expected: [200, 304] });
  await test("UI main.js", "GET", "/ui/main.js", { expected: [200, 304] });
  await test("UI main.css", "GET", "/ui/main.css", { expected: [200, 304] });

  // WebSocket endpoints
  await testWebSocket("Log receiver WebSocket", "/ws");
  await testWebSocket("UI WebSocket", "/ws/ui");

  // Print results
  printResults();
}

function printResults(): void {
  console.log("─".repeat(80));
  console.log("Results:\n");

  const maxNameLen = Math.max(...results.map((r) => r.name.length));
  const maxEndpointLen = Math.max(...results.map((r) => r.endpoint.length));

  for (const result of results) {
    const icon = result.status === "pass" ? "✓" : result.status === "fail" ? "✗" : "○";
    const color =
      result.status === "pass" ? "\x1b[32m" : result.status === "fail" ? "\x1b[31m" : "\x1b[33m";
    const reset = "\x1b[0m";

    const name = result.name.padEnd(maxNameLen);
    const endpoint = result.endpoint.padEnd(maxEndpointLen);
    const duration = result.duration ? `${result.duration.toFixed(0)}ms`.padStart(6) : "     -";
    const status = result.statusCode ? `[${result.statusCode}]` : "";

    console.log(`${color}${icon}${reset} ${name}  ${endpoint}  ${duration}  ${status}`);

    if (result.error) {
      console.log(`  ${color}└─ ${result.error}${reset}`);
    }
  }

  console.log("\n" + "─".repeat(80));

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const skipped = results.filter((r) => r.status === "skip").length;

  console.log(
    `\nTotal: ${results.length} | Passed: ${passed} | Failed: ${failed} | Skipped: ${skipped}`,
  );

  if (failed > 0) {
    console.log("\n\x1b[31m✗ Some endpoints failed verification\x1b[0m\n");
    process.exit(1);
  } else {
    console.log("\n\x1b[32m✓ All endpoints verified successfully\x1b[0m\n");
  }
}

runTests().catch((error) => {
  console.error("Verification failed:", error);
  process.exit(1);
});
