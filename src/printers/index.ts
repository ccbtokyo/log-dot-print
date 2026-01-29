// Printers module - base, queue, formatter, registry, implementations
export * from "./base-printer.js";
export * from "./queue.js";
export * from "./formatter.js";
export * from "./registry.js";

// Printer implementations (side effects: register with registry)
import "./mock.js";
import "./cups.js";
import "./escpos.js";
import "./serial.js";
