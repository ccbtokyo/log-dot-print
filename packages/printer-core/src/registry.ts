import type { PrinterPlugin, PrinterPluginFactory } from "@log-dot-print/core";

/**
 * Plugin registry for managing printer plugins
 */
export class PrinterRegistry {
  private factories = new Map<string, PrinterPluginFactory>();
  private instances = new Map<string, PrinterPlugin>();

  /**
   * Register a printer plugin factory
   */
  register(type: string, factory: PrinterPluginFactory): void {
    if (this.factories.has(type)) {
      throw new Error(`Printer type '${type}' is already registered`);
    }
    this.factories.set(type, factory);
  }

  /**
   * Create a printer plugin instance
   */
  create(type: string, options: Record<string, unknown>): PrinterPlugin {
    const factory = this.factories.get(type);
    if (!factory) {
      throw new Error(
        `Unknown printer type '${type}'. Available types: ${this.listTypes().join(", ")}`,
      );
    }

    const instanceKey = `${type}:${JSON.stringify(options)}`;

    // Return cached instance if exists
    const cached = this.instances.get(instanceKey);
    if (cached) {
      return cached;
    }

    // Create new instance
    const instance = factory(options);
    this.instances.set(instanceKey, instance);
    return instance;
  }

  /**
   * List all registered printer types
   */
  listTypes(): string[] {
    return Array.from(this.factories.keys());
  }

  /**
   * Check if a printer type is registered
   */
  has(type: string): boolean {
    return this.factories.has(type);
  }

  /**
   * Clear all instances (for shutdown)
   */
  async clearInstances(): Promise<void> {
    for (const instance of this.instances.values()) {
      await instance.shutdown();
    }
    this.instances.clear();
  }
}

// Global registry instance
export const printerRegistry = new PrinterRegistry();
