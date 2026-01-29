import type { PrintJob, PrinterStatus, PrinterType } from "../core/index.js";
import { BasePrinter } from "./base-printer.js";
import { printerRegistry } from "./registry.js";

// SerialPort - dynamically imported
type SerialPortType = import("serialport").SerialPort;
let SerialPort: typeof import("serialport").SerialPort | null = null;

interface SerialPrinterOptions {
  /** Serial port path (e.g., /dev/ttyUSB0, COM1) */
  path: string;
  /** Baud rate */
  baudRate?: number;
  /** Data bits */
  dataBits?: 5 | 6 | 7 | 8;
  /** Stop bits */
  stopBits?: 1 | 1.5 | 2;
  /** Parity */
  parity?: "none" | "even" | "odd" | "mark" | "space";
  /** Line ending style */
  lineEnding?: "crlf" | "lf" | "cr";
  /** Character encoding */
  encoding?: BufferEncoding;
  /** Delay between characters in ms (for slow printers) */
  charDelayMs?: number;
  /** Delay between lines in ms */
  lineDelayMs?: number;
  /** Initialize with reset command */
  initCommands?: number[];
  /** Form feed after print */
  formFeed?: boolean;
}

/**
 * Serial/RS-232 printer plugin
 * For dot matrix and legacy printers connected via serial port
 */
export class SerialPrinter extends BasePrinter {
  readonly name = "serial-printer";
  readonly version = "1.0.0";
  protected readonly printerType: PrinterType = "serial";

  private options: Required<Omit<SerialPrinterOptions, "initCommands">> & {
    initCommands?: number[];
  };
  private port: SerialPortType | null = null;

  constructor(options: SerialPrinterOptions) {
    super();
    this.options = {
      path: options.path,
      baudRate: options.baudRate ?? 9600,
      dataBits: options.dataBits ?? 8,
      stopBits: options.stopBits ?? 1,
      parity: options.parity ?? "none",
      lineEnding: options.lineEnding ?? "crlf",
      encoding: options.encoding ?? "ascii",
      charDelayMs: options.charDelayMs ?? 0,
      lineDelayMs: options.lineDelayMs ?? 0,
      initCommands: options.initCommands,
      formFeed: options.formFeed ?? false,
    };
  }

  protected async connect(): Promise<void> {
    // Dynamic import of serialport
    if (!SerialPort) {
      try {
        const module = await import("serialport");
        SerialPort = module.SerialPort;
      } catch {
        throw new Error("serialport package not installed. Run: npm install serialport");
      }
    }

    const { path, baudRate, dataBits, stopBits, parity } = this.options;

    this.port = new SerialPort({
      path,
      baudRate,
      dataBits,
      stopBits,
      parity,
      autoOpen: false,
    });

    await new Promise<void>((resolve, reject) => {
      this.port!.open((err) => {
        if (err) reject(new Error(`Failed to open ${path}: ${err.message}`));
        else resolve();
      });
    });

    // Send init commands if configured
    if (this.options.initCommands?.length) {
      await this.writeBytes(Buffer.from(this.options.initCommands));
    }

    console.log(`[SerialPrinter] Connected to ${path} at ${baudRate} baud`);
  }

  protected async disconnect(): Promise<void> {
    if (this.port?.isOpen) {
      await new Promise<void>((resolve) => {
        this.port!.close(() => resolve());
      });
    }
    this.port = null;
    console.log("[SerialPrinter] Disconnected");
  }

  async getStatus(): Promise<PrinterStatus> {
    return {
      connected: this.connected,
      name: `${this.name}@${this.options.path}`,
      type: this.printerType,
      ready: this.connected && this.port?.isOpen === true,
      info: `${this.options.baudRate} baud`,
    };
  }

  async print(job: PrintJob): Promise<void> {
    if (!this.port?.isOpen) {
      throw new Error("Serial port not open");
    }

    const lineEnding = this.getLineEnding();
    const lines = job.formattedContent.split("\n");

    for (const line of lines) {
      const data = Buffer.from(line + lineEnding, this.options.encoding);

      if (this.options.charDelayMs > 0) {
        // Send character by character with delay
        for (const byte of data) {
          await this.writeBytes(Buffer.from([byte]));
          await this.delay(this.options.charDelayMs);
        }
      } else {
        await this.writeBytes(data);
      }

      if (this.options.lineDelayMs > 0) {
        await this.delay(this.options.lineDelayMs);
      }
    }

    // Form feed if configured
    if (this.options.formFeed) {
      await this.writeBytes(Buffer.from([0x0c])); // Form feed character
    }

    // Ensure all data is written
    await this.drain();
  }

  private getLineEnding(): string {
    switch (this.options.lineEnding) {
      case "crlf":
        return "\r\n";
      case "lf":
        return "\n";
      case "cr":
        return "\r";
    }
  }

  private writeBytes(data: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      this.port!.write(data, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private drain(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.port!.drain((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Send raw bytes to the printer
   */
  async sendRaw(bytes: number[]): Promise<void> {
    if (!this.port?.isOpen) {
      throw new Error("Serial port not open");
    }
    await this.writeBytes(Buffer.from(bytes));
    await this.drain();
  }

  /**
   * List available serial ports
   */
  static async listPorts(): Promise<{ path: string; manufacturer?: string }[]> {
    if (!SerialPort) {
      try {
        const module = await import("serialport");
        SerialPort = module.SerialPort;
      } catch {
        return [];
      }
    }

    // Use the list function from serialport
    const { SerialPort: SP } = await import("serialport");
    const portList = await SP.list();
    return portList.map((p) => ({
      path: p.path,
      manufacturer: p.manufacturer,
    }));
  }
}

/**
 * Factory function for creating SerialPrinter instances
 */
export function createSerialPrinter(options: Record<string, unknown>): SerialPrinter {
  if (typeof options.path !== "string") {
    throw new Error("Serial printer requires a path option");
  }

  return new SerialPrinter({
    path: options.path,
    baudRate: typeof options.baudRate === "number" ? options.baudRate : undefined,
    dataBits:
      typeof options.dataBits === "number" ? (options.dataBits as 5 | 6 | 7 | 8) : undefined,
    stopBits: typeof options.stopBits === "number" ? (options.stopBits as 1 | 1.5 | 2) : undefined,
    parity:
      typeof options.parity === "string"
        ? (options.parity as SerialPrinterOptions["parity"])
        : undefined,
    lineEnding:
      typeof options.lineEnding === "string"
        ? (options.lineEnding as SerialPrinterOptions["lineEnding"])
        : undefined,
    encoding:
      typeof options.encoding === "string" ? (options.encoding as BufferEncoding) : undefined,
    charDelayMs: typeof options.charDelayMs === "number" ? options.charDelayMs : undefined,
    lineDelayMs: typeof options.lineDelayMs === "number" ? options.lineDelayMs : undefined,
    initCommands: Array.isArray(options.initCommands) ? options.initCommands : undefined,
    formFeed: typeof options.formFeed === "boolean" ? options.formFeed : undefined,
  });
}

/**
 * Register the serial printer plugin
 */
export function register(): void {
  printerRegistry.register("serial", createSerialPrinter);
}

// Auto-register when imported
register();
