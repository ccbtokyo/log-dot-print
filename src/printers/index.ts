// Printers module - base, queue, formatter, registry, implementations
export * from "./base-printer.js";
export * from "./queue.js";
export * from "./formatter.js";
export * from "./registry.js";
export * from "./discovery.js";

// Printer implementations (side effects: register with registry)
// Note: escpos, serial, and native are NOT auto-registered due to native module dependencies
// Use tryRegisterSerialPrinter(), tryRegisterEscposPrinter(), and tryRegisterNativePrinter() for conditional registration
import "./mock.js";
import "./cups.js";

/**
 * Try to register the serial printer plugin (requires serialport native module)
 * Safe to call in environments where serialport may not be available
 * @returns true if registered successfully, false if module not available
 */
export async function tryRegisterSerialPrinter(): Promise<boolean> {
  try {
    const { tryRegister } = await import("./serial.js");
    return tryRegister();
  } catch {
    console.log("[Printers] Failed to load serial printer module");
    return false;
  }
}

/**
 * Try to register the ESC/POS printer plugin (requires escpos native module)
 * Safe to call in environments where escpos may not be available
 * @returns true if registered successfully, false if module not available
 */
export async function tryRegisterEscposPrinter(): Promise<boolean> {
  try {
    const { tryRegister } = await import("./escpos.js");
    return tryRegister();
  } catch {
    console.log("[Printers] Failed to load escpos printer module");
    return false;
  }
}

/**
 * Try to register the native printer plugin (requires @printers/printers native module)
 * Safe to call in environments where @printers/printers may not be available
 * @returns true if registered successfully, false if module not available
 */
export async function tryRegisterNativePrinter(): Promise<boolean> {
  try {
    const { tryRegister } = await import("./native.js");
    return tryRegister();
  } catch {
    console.log("[Printers] Failed to load native printer module");
    return false;
  }
}
