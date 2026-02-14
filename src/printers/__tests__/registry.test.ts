import { describe, test, expect, mock, beforeEach } from "bun:test";
import { PrinterRegistry } from "../registry";
import type { PrinterPlugin, PrinterPluginFactory } from "../../core/interfaces";
import type { PrinterStatus } from "../../core/types";

const makeMockPlugin = (name = "mock"): PrinterPlugin => ({
  name,
  version: "1.0.0",
  initialize: mock(() => Promise.resolve()),
  shutdown: mock(() => Promise.resolve()),
  getStatus: mock(() =>
    Promise.resolve({ connected: true, name, type: "mock", ready: true } as PrinterStatus),
  ),
  print: mock(() => Promise.resolve()),
  testConnection: mock(() => Promise.resolve(true)),
});

describe("PrinterRegistry", () => {
  let registry: PrinterRegistry;

  beforeEach(() => {
    registry = new PrinterRegistry();
  });

  describe("register", () => {
    test("registers a factory successfully", () => {
      const factory: PrinterPluginFactory = () => makeMockPlugin();
      registry.register("mock", factory);
      expect(registry.has("mock")).toBe(true);
    });

    test("throws on duplicate registration", () => {
      const factory: PrinterPluginFactory = () => makeMockPlugin();
      registry.register("mock", factory);
      expect(() => registry.register("mock", factory)).toThrow(
        "Printer type 'mock' is already registered",
      );
    });
  });

  describe("create", () => {
    test("creates instance via factory", () => {
      const plugin = makeMockPlugin();
      const factory = mock(() => plugin);
      registry.register("mock", factory);

      const result = registry.create("mock", { key: "value" });

      expect(result).toBe(plugin);
      expect(factory).toHaveBeenCalledTimes(1);
      expect(factory.mock.calls[0][0]).toEqual({ key: "value" });
    });

    test("throws for unregistered type", () => {
      expect(() => registry.create("unknown", {})).toThrow(
        "Unknown printer type 'unknown'. Available types: ",
      );
    });

    test("includes available types in error message", () => {
      registry.register("mock", () => makeMockPlugin());
      registry.register("cups", () => makeMockPlugin("cups"));

      expect(() => registry.create("serial", {})).toThrow("mock, cups");
    });

    test("returns cached instance for same options", () => {
      const factory = mock(() => makeMockPlugin());
      registry.register("mock", factory);

      const opts = { port: 9100 };
      const first = registry.create("mock", opts);
      const second = registry.create("mock", opts);

      expect(first).toBe(second);
      expect(factory).toHaveBeenCalledTimes(1);
    });

    test("creates new instance for different options", () => {
      const factory = mock(() => makeMockPlugin());
      registry.register("mock", factory);

      registry.create("mock", { port: 9100 });
      registry.create("mock", { port: 9200 });

      expect(factory).toHaveBeenCalledTimes(2);
    });
  });

  describe("listTypes", () => {
    test("returns empty array initially", () => {
      expect(registry.listTypes()).toEqual([]);
    });

    test("returns registered types", () => {
      registry.register("mock", () => makeMockPlugin());
      registry.register("cups", () => makeMockPlugin("cups"));

      expect(registry.listTypes()).toEqual(["mock", "cups"]);
    });
  });

  describe("has", () => {
    test("returns false for unregistered type", () => {
      expect(registry.has("mock")).toBe(false);
    });

    test("returns true for registered type", () => {
      registry.register("mock", () => makeMockPlugin());
      expect(registry.has("mock")).toBe(true);
    });
  });

  describe("clearInstances", () => {
    test("calls shutdown on all instances", async () => {
      const plugin1 = makeMockPlugin("p1");
      const plugin2 = makeMockPlugin("p2");
      let callCount = 0;
      registry.register("type1", () => {
        callCount++;
        return callCount === 1 ? plugin1 : plugin2;
      });

      registry.create("type1", { id: 1 });

      registry.register("type2", () => plugin2);
      registry.create("type2", { id: 2 });

      await registry.clearInstances();

      expect(plugin1.shutdown).toHaveBeenCalledTimes(1);
      expect(plugin2.shutdown).toHaveBeenCalledTimes(1);
    });

    test("clears instance cache", async () => {
      const factory = mock(() => makeMockPlugin());
      registry.register("mock", factory);

      registry.create("mock", { id: 1 });
      await registry.clearInstances();
      registry.create("mock", { id: 1 });

      expect(factory).toHaveBeenCalledTimes(2);
    });
  });
});
