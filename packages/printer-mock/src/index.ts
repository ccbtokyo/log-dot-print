import type { PrintJob, PrinterStatus, PrinterType } from '@log-dot-print/core';
import { BasePrinter, printerRegistry } from '@log-dot-print/printer-core';
import { appendFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';

interface MockPrinterOptions {
  /** Simulated print delay in milliseconds */
  printDelayMs?: number;
  /** Simulate random failures (0-1 probability) */
  failureProbability?: number;
  /** Output to console */
  logToConsole?: boolean;
  /** Output to file */
  logToFile?: string;
}

/**
 * Mock printer for debugging and testing
 * Outputs to console and/or file instead of actual printer
 */
export class MockPrinter extends BasePrinter {
  readonly name = 'mock-printer';
  readonly version = '1.0.0';
  protected readonly printerType: PrinterType = 'mock';

  private options: Required<MockPrinterOptions>;
  private printCount = 0;

  constructor(options: MockPrinterOptions = {}) {
    super();
    this.options = {
      printDelayMs: options.printDelayMs ?? 100,
      failureProbability: options.failureProbability ?? 0,
      logToConsole: options.logToConsole ?? true,
      logToFile: options.logToFile ?? '',
    };
  }

  protected async connect(): Promise<void> {
    // Mock connection - always succeeds
    console.log('[MockPrinter] Connected');
  }

  protected async disconnect(): Promise<void> {
    console.log(`[MockPrinter] Disconnected (printed ${this.printCount} jobs)`);
  }

  async getStatus(): Promise<PrinterStatus> {
    return {
      connected: this.connected,
      name: this.name,
      type: this.printerType,
      ready: this.connected,
      info: `Mock printer (${this.printCount} jobs printed)`,
    };
  }

  async print(job: PrintJob): Promise<void> {
    // Simulate delay
    if (this.options.printDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.options.printDelayMs));
    }

    // Simulate random failure
    if (this.options.failureProbability > 0 && Math.random() < this.options.failureProbability) {
      throw new Error('Simulated print failure');
    }

    // Output to console
    if (this.options.logToConsole) {
      console.log('\n' + '='.repeat(60));
      console.log('[MockPrinter] PRINTING JOB:', job.id);
      console.log('='.repeat(60));
      console.log(job.formattedContent);
    }

    // Output to file
    if (this.options.logToFile) {
      const content = [
        `--- Job: ${job.id} ---`,
        `Time: ${new Date().toISOString()}`,
        '',
        job.formattedContent,
        '',
      ].join('\n');

      await mkdir(dirname(this.options.logToFile), { recursive: true });
      await appendFile(this.options.logToFile, content);
    }

    this.printCount++;
  }
}

/**
 * Factory function for creating MockPrinter instances
 */
export function createMockPrinter(options: Record<string, unknown>): MockPrinter {
  return new MockPrinter({
    printDelayMs: typeof options.printDelayMs === 'number' ? options.printDelayMs : undefined,
    failureProbability:
      typeof options.failureProbability === 'number' ? options.failureProbability : undefined,
    logToConsole: typeof options.logToConsole === 'boolean' ? options.logToConsole : undefined,
    logToFile: typeof options.logToFile === 'string' ? options.logToFile : undefined,
  });
}

/**
 * Register the mock printer plugin
 */
export function register(): void {
  printerRegistry.register('mock', createMockPrinter);
}

// Auto-register when imported
register();
