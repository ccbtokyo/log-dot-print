import type { PrintJob, PrinterStatus, PrinterType } from "../core/index.js";
import { BasePrinter } from "./base-printer.js";
import { printerRegistry } from "./registry.js";

type EscposDevice = {
  open: (cb: (err: Error | null) => void) => void;
  close: (cb: () => void) => void;
};

type EscposDeviceConstructor = new (...args: any[]) => EscposDevice;

// ESC/POS libraries - may not be installed
let escpos: typeof import("escpos") | null = null;
let USB: EscposDeviceConstructor | null = null;
let Network: EscposDeviceConstructor | null = null;
let Serial: EscposDeviceConstructor | null = null;

interface EscPosPrinterOptions {
  /** Connection type */
  connectionType: "usb" | "network" | "serial";
  /** For network: IP address or hostname */
  host?: string;
  /** For network: port (default 9100) */
  port?: number;
  /** For USB: vendor ID */
  vendorId?: number;
  /** For USB: product ID */
  productId?: number;
  /** For serial: device path */
  devicePath?: string;
  /** For serial: baud rate */
  baudRate?: number;
  /** Paper width in characters */
  width?: number;
  /** Character encoding */
  encoding?: string;
  /** Cut paper after print */
  cut?: boolean;
}

/**
 * ESC/POS thermal printer plugin
 * Supports USB, Network, and Serial connections
 */
export class EscPosPrinter extends BasePrinter {
  readonly name = "escpos-printer";
  readonly version = "1.0.0";
  protected readonly printerType: PrinterType = "escpos";

  private options: EscPosPrinterOptions;
  private device: EscposDevice | null = null;
  private printer: unknown = null;

  constructor(options: EscPosPrinterOptions) {
    super();
    this.options = {
      connectionType: options.connectionType,
      host: options.host,
      port: options.port ?? 9100,
      vendorId: options.vendorId,
      productId: options.productId,
      devicePath: options.devicePath,
      baudRate: options.baudRate ?? 9600,
      width: options.width ?? 48,
      encoding: options.encoding ?? "GB18030",
      cut: options.cut ?? true,
    };
  }

  protected async connect(): Promise<void> {
    // Dynamic import of escpos
    try {
      escpos = await import("escpos");
    } catch {
      throw new Error("escpos package not installed. Run: npm install escpos");
    }

    const { connectionType } = this.options;

    switch (connectionType) {
      case "usb":
        await this.connectUsb();
        break;
      case "network":
        await this.connectNetwork();
        break;
      case "serial":
        await this.connectSerial();
        break;
      default:
        throw new Error(`Unknown connection type: ${connectionType}`);
    }

    console.log(`[EscPosPrinter] Connected via ${connectionType}`);
  }

  private async connectUsb(): Promise<void> {
    try {
      const usbModule = await import("escpos-usb");
      USB = (usbModule.default || usbModule.USB || usbModule) as EscposDeviceConstructor;
    } catch {
      throw new Error("escpos-usb not installed. Run: npm install escpos-usb");
    }

    const { vendorId, productId } = this.options;
    const deviceCtor = USB;
    const escposModule = escpos;
    if (!deviceCtor || !escposModule) {
      throw new Error("escpos-usb not initialized");
    }

    this.device = vendorId && productId ? new deviceCtor(vendorId, productId) : new deviceCtor();
    this.printer = new escposModule.Printer(this.device, {
      encoding: this.options.encoding,
      width: this.options.width,
    });

    await new Promise<void>((resolve, reject) => {
      const device = this.device;
      if (!device) {
        reject(new Error("USB device not available"));
        return;
      }
      device.open((err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private async connectNetwork(): Promise<void> {
    try {
      const netModule = await import("escpos-network");
      Network = (netModule.default || netModule.Network || netModule) as EscposDeviceConstructor;
    } catch {
      throw new Error("escpos-network not installed. Run: npm install escpos-network");
    }

    const { host, port } = this.options;
    if (!host) {
      throw new Error("Host is required for network connection");
    }

    const deviceCtor = Network;
    const escposModule = escpos;
    if (!deviceCtor || !escposModule) {
      throw new Error("escpos-network not initialized");
    }

    this.device = new deviceCtor(host, port);
    this.printer = new escposModule.Printer(this.device, {
      encoding: this.options.encoding,
      width: this.options.width,
    });

    await new Promise<void>((resolve, reject) => {
      const device = this.device;
      if (!device) {
        reject(new Error("Network device not available"));
        return;
      }
      device.open((err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private async connectSerial(): Promise<void> {
    try {
      const serialModule = await import("escpos-serialport");
      Serial = (serialModule.default ||
        serialModule.Serial ||
        serialModule) as EscposDeviceConstructor;
    } catch {
      throw new Error("escpos-serialport not installed. Run: npm install escpos-serialport");
    }

    const { devicePath, baudRate } = this.options;
    if (!devicePath) {
      throw new Error("Device path is required for serial connection");
    }

    const deviceCtor = Serial;
    const escposModule = escpos;
    if (!deviceCtor || !escposModule) {
      throw new Error("escpos-serialport not initialized");
    }

    this.device = new deviceCtor(devicePath, { baudRate });
    this.printer = new escposModule.Printer(this.device, {
      encoding: this.options.encoding,
      width: this.options.width,
    });

    await new Promise<void>((resolve, reject) => {
      const device = this.device;
      if (!device) {
        reject(new Error("Serial device not available"));
        return;
      }
      device.open((err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  protected async disconnect(): Promise<void> {
    const device = this.device;
    if (device) {
      await new Promise<void>((resolve) => {
        device.close(() => resolve());
      });
    }
    this.device = null;
    this.printer = null;
    console.log("[EscPosPrinter] Disconnected");
  }

  async getStatus(): Promise<PrinterStatus> {
    return {
      connected: this.connected,
      name: this.name,
      type: this.printerType,
      ready: this.connected && this.printer !== null,
      info: `${this.options.connectionType} connection`,
    };
  }

  async print(job: PrintJob): Promise<void> {
    if (!this.printer) {
      throw new Error("Printer not connected");
    }

    const p = this.printer as {
      font: (f: string) => unknown;
      align: (a: string) => unknown;
      style: (s: string) => unknown;
      size: (w: number, h: number) => unknown;
      text: (t: string) => unknown;
      feed: (n: number) => unknown;
      cut: () => unknown;
      close: (cb: () => void) => void;
    };

    // Print content
    const lines = job.formattedContent.split("\n");

    p.font("a");
    p.align("lt");
    p.style("normal");
    p.size(1, 1);

    for (const line of lines) {
      p.text(line);
    }

    p.feed(2);

    if (this.options.cut) {
      p.cut();
    }

    // Note: close() would disconnect, so we just let the buffer flush
    // The printer stays connected for the next job
  }
}

/**
 * Factory function for creating EscPosPrinter instances
 */
export function createEscPosPrinter(options: Record<string, unknown>): EscPosPrinter {
  const connectionType = options.connectionType as EscPosPrinterOptions["connectionType"];

  if (!connectionType || !["usb", "network", "serial"].includes(connectionType)) {
    throw new Error("connectionType must be one of: usb, network, serial");
  }

  return new EscPosPrinter({
    connectionType,
    host: typeof options.host === "string" ? options.host : undefined,
    port: typeof options.port === "number" ? options.port : undefined,
    vendorId: typeof options.vendorId === "number" ? options.vendorId : undefined,
    productId: typeof options.productId === "number" ? options.productId : undefined,
    devicePath: typeof options.devicePath === "string" ? options.devicePath : undefined,
    baudRate: typeof options.baudRate === "number" ? options.baudRate : undefined,
    width: typeof options.width === "number" ? options.width : undefined,
    encoding: typeof options.encoding === "string" ? options.encoding : undefined,
    cut: typeof options.cut === "boolean" ? options.cut : undefined,
  });
}

/**
 * Register the ESC/POS printer plugin
 */
export function register(): void {
  printerRegistry.register("escpos", createEscPosPrinter);
}

// Auto-register when imported
register();
