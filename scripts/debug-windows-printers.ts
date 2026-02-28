#!/usr/bin/env bun
/**
 * Windows printer debug CLI.
 *
 * Commands:
 *   printers                List installed printers
 *   papers [--printer NAME] List paper size / paper kind for a printer
 *   bins   [--printer NAME] List paper trays / bins for a printer
 *
 * Examples:
 *   bun scripts/debug-windows-printers.ts printers
 *   bun scripts/debug-windows-printers.ts papers
 *   bun scripts/debug-windows-printers.ts papers --printer "EPSON VP-F4400"
 *   bun scripts/debug-windows-printers.ts papers --printer "EPSON VP-F4400" --json
 *   bun scripts/debug-windows-printers.ts bins --printer "EPSON VP-F4400"
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const POWERSHELL_TIMEOUT_MS = 15000;
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

const PAPER_KIND_LABELS: Record<number, string> = {
  1: "Letter",
  5: "Legal",
  8: "A3",
  9: "A4",
  11: "A5",
  12: "B4 (JIS)",
  13: "B5 (JIS)",
  256: "Custom",
};

type Command = "printers" | "papers" | "bins";

interface CliOptions {
  command: Command | null;
  printerName?: string;
  json: boolean;
  help: boolean;
}

interface PrinterInfo {
  name: string;
  isDefault: boolean;
  statusCode: number;
  status: string;
  offline: boolean;
  shared: boolean;
  driver: string;
  port: string;
}

interface PaperItem {
  paperSize: string;
  paperKind: number | null;
  paperKindLabel: string;
}

interface PaperListResult {
  printerName: string;
  isDefault: boolean;
  papers: PaperItem[];
}

interface BinItem {
  sourceName: string;
  kind: number;
  rawKind: number;
}

interface BinListResult {
  printerName: string;
  bins: BinItem[];
}

const PRINTERS_PS_SCRIPT = `
$items = @(
  Get-CimInstance Win32_Printer |
    Sort-Object Name |
    ForEach-Object {
      [PSCustomObject]@{
        name = [string]$_.Name
        isDefault = [bool]$_.Default
        statusCode = [int]$_.PrinterStatus
        offline = [bool]$_.WorkOffline
        shared = [bool]$_.Shared
        driver = [string]$_.DriverName
        port = [string]$_.PortName
      }
    }
)
$items | ConvertTo-Json -Depth 4 -Compress
`;

const PAPERS_PS_SCRIPT = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class WinspoolInterop {
    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern int DeviceCapabilitiesW(
        string pDevice,
        string pPort,
        ushort fwCapability,
        IntPtr pOutput,
        IntPtr pDevMode
    );

    public const ushort DC_PAPERS = 2;
    public const ushort DC_PAPERNAMES = 16;
}
"@

$inputName = [Environment]::GetEnvironmentVariable("LOG_DOT_PRINT_PRINTER")
if ([string]::IsNullOrWhiteSpace($inputName)) {
    $p = Get-CimInstance Win32_Printer -Filter "Default=True" | Select-Object -First 1
    if (-not $p) { throw "No default printer found" }
} else {
    $wmiName = $inputName -replace "'", "''"
    $p = Get-CimInstance Win32_Printer -Filter "Name='$wmiName'" | Select-Object -First 1
    if (-not $p) { throw ("Printer not found: " + $inputName) }
}
$devName = $p.Name
$portName = $p.PortName
$isDefault = [bool]$p.Default

$count = [WinspoolInterop]::DeviceCapabilitiesW($devName, $portName, [WinspoolInterop]::DC_PAPERS, [IntPtr]::Zero, [IntPtr]::Zero)
if ($count -le 0) { throw "DeviceCapabilities DC_PAPERS returned $count" }

$papersPtr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($count * 2)
try {
    $ret = [WinspoolInterop]::DeviceCapabilitiesW($devName, $portName, [WinspoolInterop]::DC_PAPERS, $papersPtr, [IntPtr]::Zero)
    if ($ret -lt 0) { throw "DeviceCapabilities DC_PAPERS (fill) returned $ret" }
    $ids = New-Object int[] $count
    for ($i = 0; $i -lt $count; $i++) {
        $ids[$i] = [System.Runtime.InteropServices.Marshal]::ReadInt16($papersPtr, $i * 2)
    }
} finally {
    [System.Runtime.InteropServices.Marshal]::FreeHGlobal($papersPtr)
}

$nameSlotBytes = 64 * 2
$namesPtr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($count * $nameSlotBytes)
try {
    $ret = [WinspoolInterop]::DeviceCapabilitiesW($devName, $portName, [WinspoolInterop]::DC_PAPERNAMES, $namesPtr, [IntPtr]::Zero)
    if ($ret -lt 0) { throw "DeviceCapabilities DC_PAPERNAMES (fill) returned $ret" }
    $papers = @()
    for ($i = 0; $i -lt $count; $i++) {
        $offset = $i * $nameSlotBytes
        $ptr = [IntPtr]::Add($namesPtr, $offset)
        $name = [System.Runtime.InteropServices.Marshal]::PtrToStringUni($ptr)
        $papers += [PSCustomObject]@{
            paperSize = $name
            paperKind = $ids[$i]
        }
    }
} finally {
    [System.Runtime.InteropServices.Marshal]::FreeHGlobal($namesPtr)
}

[PSCustomObject]@{
    printerName = [string]$devName
    isDefault = $isDefault
    papers = $papers
} | ConvertTo-Json -Depth 6 -Compress
`;

const BINS_PS_SCRIPT = `
Add-Type -AssemblyName System.Drawing

$inputName = [Environment]::GetEnvironmentVariable("LOG_DOT_PRINT_PRINTER")
$settings = New-Object System.Drawing.Printing.PrinterSettings

if (-not [string]::IsNullOrWhiteSpace($inputName)) {
  $settings.PrinterName = $inputName
} else {
  # Use default printer
}

if (-not $settings.IsValid) {
  throw ("Printer not valid: " + $settings.PrinterName)
}

$bins = @()
foreach ($src in $settings.PaperSources) {
  $bins += [PSCustomObject]@{
    sourceName = [string]$src.SourceName
    kind       = [int]$src.Kind
    rawKind    = [int]$src.RawKind
  }
}

[PSCustomObject]@{
  printerName = [string]$settings.PrinterName
  bins = $bins
} | ConvertTo-Json -Depth 6 -Compress
`;

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    command: null,
    json: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--printer" || arg === "-p") {
      const value = args[i + 1];
      if (!value) {
        throw new Error("Missing value for --printer");
      }
      options.printerName = value;
      i++;
      continue;
    }

    if (arg === "printers" || arg === "papers" || arg === "bins") {
      if (options.command) {
        throw new Error(`Command is already set to "${options.command}"`);
      }
      options.command = arg;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp(): void {
  console.log(`
Windows printer debug CLI

Usage:
  bun scripts/debug-windows-printers.ts <command> [options]

Commands:
  printers                  List installed printers
  papers                    List paper size / paper kind
  bins                      List paper trays / bins

Options:
  -p, --printer <name>      Target printer name (papers command only)
  --json                    Output JSON
  -h, --help                Show help

Examples:
  bun run debug:printers
  bun run debug:papers
  bun run debug:papers -- --printer "EPSON VP-F4400"
  bun run debug:papers -- --printer "EPSON VP-F4400" --json
`);
}

function encodePowerShell(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

function parseJsonOutput(output: string): unknown {
  const trimmed = output.trim();
  if (!trimmed) {
    throw new Error("PowerShell returned empty output");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const first = trimmed.search(/[[{]/);
    const lastObj = trimmed.lastIndexOf("}");
    const lastArr = trimmed.lastIndexOf("]");
    const last = Math.max(lastObj, lastArr);
    if (first !== -1 && last !== -1 && last >= first) {
      return JSON.parse(trimmed.slice(first, last + 1));
    }
    throw new Error(`Failed to parse JSON output: ${trimmed}`);
  }
}

async function runPowerShellJson<T>(script: string, envVars: Record<string, string>): Promise<T> {
  const encoded = encodePowerShell(script);
  const { stdout, stderr } = await execFileAsync(
    "powershell",
    ["-NoProfile", "-EncodedCommand", encoded],
    {
      timeout: POWERSHELL_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER_BYTES,
      env: {
        ...process.env,
        ...envVars,
      },
    },
  );

  if (stderr.trim().length > 0) {
    // Keep stderr as informational output. JSON payload is expected on stdout.
    console.warn(stderr.trim());
  }

  return parseJsonOutput(stdout) as T;
}

function toStringOrEmpty(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

function toBoolean(value: unknown): boolean {
  return value === true;
}

function toNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function printerStatusFromCode(code: number): string {
  switch (code) {
    case 3:
      return "Idle";
    case 4:
      return "Printing";
    case 5:
      return "Warmup";
    case 6:
      return "Stopped";
    case 7:
      return "Offline";
    default:
      return "Unknown";
  }
}

function paperKindLabel(kind: number | null): string {
  if (kind === null) return "-";
  return PAPER_KIND_LABELS[kind] ?? "Unknown";
}

async function fetchPrinters(): Promise<PrinterInfo[]> {
  const raw = await runPowerShellJson<unknown>(PRINTERS_PS_SCRIPT, {});
  const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return items
    .map((entry) => {
      const obj = entry as Record<string, unknown>;
      const statusCode = toNumber(obj.statusCode, 0);
      return {
        name: toStringOrEmpty(obj.name),
        isDefault: toBoolean(obj.isDefault),
        statusCode,
        status: printerStatusFromCode(statusCode),
        offline: toBoolean(obj.offline),
        shared: toBoolean(obj.shared),
        driver: toStringOrEmpty(obj.driver),
        port: toStringOrEmpty(obj.port),
      };
    })
    .filter((entry) => entry.name.length > 0);
}

async function fetchPapers(printerName?: string): Promise<PaperListResult> {
  const raw = (await runPowerShellJson<unknown>(PAPERS_PS_SCRIPT, {
    LOG_DOT_PRINT_PRINTER: printerName ?? "",
  })) as Record<string, unknown>;

  const papersRaw = Array.isArray(raw.papers) ? raw.papers : [];
  const papers = papersRaw.map((entry) => {
    const obj = entry as Record<string, unknown>;
    const kind = toNumberOrNull(obj.paperKind);
    const size = toStringOrEmpty(obj.paperSize);
    return {
      paperSize: size.length > 0 ? size : "(unknown)",
      paperKind: kind,
      paperKindLabel: paperKindLabel(kind),
    };
  });

  return {
    printerName: toStringOrEmpty(raw.printerName),
    isDefault: toBoolean(raw.isDefault),
    papers,
  };
}

async function fetchBins(printerName?: string): Promise<BinListResult> {
  const raw = (await runPowerShellJson<unknown>(BINS_PS_SCRIPT, {
    LOG_DOT_PRINT_PRINTER: printerName ?? "",
  })) as Record<string, unknown>;

  const binsRaw = Array.isArray(raw.bins) ? raw.bins : [];
  const bins = binsRaw.map((entry) => {
    const obj = entry as Record<string, unknown>;
    return {
      sourceName: toStringOrEmpty(obj.sourceName),
      kind: toNumber(obj.kind, 0),
      rawKind: toNumber(obj.rawKind, 0),
    };
  });

  return {
    printerName: toStringOrEmpty(raw.printerName),
    bins,
  };
}

function printBinsTable(result: BinListResult): void {
  console.log(`Printer: ${result.printerName}\nSource Name\tKind\tRawKind`);
  for (const bin of result.bins) {
    console.log(`${bin.sourceName}\t${bin.kind}\t${bin.rawKind}`);
  }
}

function printPrintersTable(printers: PrinterInfo[]): void {
  if (printers.length === 0) {
    console.log("No printers found.");
    return;
  }

  console.log("Name\tDefault\tStatus(code)\tOffline\tShared\tDriver\tPort");
  for (const printer of printers) {
    const status = `${printer.status}(${printer.statusCode})`;
    console.log(
      `${printer.name}\t${printer.isDefault ? "yes" : "no"}\t${status}\t${printer.offline ? "yes" : "no"}\t${printer.shared ? "yes" : "no"}\t${printer.driver}\t${printer.port}`,
    );
  }
}

function printPapersTable(result: PaperListResult): void {
  console.log(
    `Printer: ${result.printerName}${result.isDefault ? " (default)" : ""}\nPaper Size\tPaper Kind\tKind Label`,
  );
  for (const paper of result.papers) {
    const kind = paper.paperKind === null ? "-" : String(paper.paperKind);
    console.log(`${paper.paperSize}\t${kind}\t${paper.paperKindLabel}`);
  }
}

async function main(): Promise<void> {
  let options: CliOptions;
  try {
    options = parseArgs();
  } catch (error) {
    console.error(
      `[debug-windows-printers] ${error instanceof Error ? error.message : String(error)}`,
    );
    printHelp();
    process.exit(1);
  }

  if (options.help || options.command === null) {
    printHelp();
    process.exit(options.help ? 0 : 1);
  }

  if (process.platform !== "win32") {
    console.error("[debug-windows-printers] This CLI is Windows-only.");
    process.exit(1);
  }

  if (options.command === "printers") {
    const printers = await fetchPrinters();
    if (options.json) {
      console.log(JSON.stringify(printers, null, 2));
    } else {
      printPrintersTable(printers);
    }
    return;
  }

  if (options.command === "bins") {
    const bins = await fetchBins(options.printerName);
    if (options.json) {
      console.log(JSON.stringify(bins, null, 2));
    } else {
      printBinsTable(bins);
    }
    return;
  }

  const papers = await fetchPapers(options.printerName);
  if (options.json) {
    console.log(JSON.stringify(papers, null, 2));
  } else {
    printPapersTable(papers);
  }
}

main().catch((error) => {
  console.error(
    `[debug-windows-printers] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
