declare module "escpos" {
  export interface PrinterOptions {
    encoding?: string;
    width?: number;
  }

  export class Printer {
    constructor(device: unknown, options?: PrinterOptions);
    font(font: string): this;
    align(alignment: string): this;
    style(style: string): this;
    size(width: number, height: number): this;
    text(text: string): this;
    feed(lines: number): this;
    cut(): this;
    close(cb?: () => void): void;
  }

  const escpos: {
    Printer: typeof Printer;
  };
  export default escpos;
}

declare module "escpos-usb" {
  export type OpenCallback = (err: Error | null) => void;

  export class USB {
    constructor(vendorId?: number, productId?: number);
    open(cb: OpenCallback): void;
    close(cb: () => void): void;
  }

  export default USB;
}

declare module "escpos-network" {
  export type OpenCallback = (err: Error | null) => void;

  export class Network {
    constructor(host: string, port?: number);
    open(cb: OpenCallback): void;
    close(cb: () => void): void;
  }

  export default Network;
}

declare module "escpos-serialport" {
  export type OpenCallback = (err: Error | null) => void;

  export class SerialPort {
    constructor(devicePath: string, options?: { baudRate?: number });
    open(cb: OpenCallback): void;
    close(cb: () => void): void;
  }

  export const Serial: typeof SerialPort;
  export default SerialPort;
}
