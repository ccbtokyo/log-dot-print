import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { PrintQueue } from '../queue';
import type { PrintJob, PrinterPlugin, TypedEventEmitter } from '@log-dot-print/core';

// Mock printer
const createMockPrinter = () => ({
  name: 'test-printer',
  version: '1.0.0',
  initialize: mock(() => Promise.resolve()),
  shutdown: mock(() => Promise.resolve()),
  getStatus: mock(() => Promise.resolve({ connected: true, name: 'test', type: 'mock' as const, ready: true })),
  print: mock(() => Promise.resolve()),
  testConnection: mock(() => Promise.resolve(true)),
});

// Mock event bus
const createMockEventBus = () => ({
  emit: mock(() => true),
  on: mock(() => ({} as TypedEventEmitter)),
  once: mock(() => ({} as TypedEventEmitter)),
  off: mock(() => ({} as TypedEventEmitter)),
});

const createMockJob = (id: string): PrintJob => ({
  id,
  logEntry: {
    id: `log-${id}`,
    timestamp: new Date().toISOString(),
    source: 'test',
    level: 'info',
    message: 'Test message',
  },
  formattedContent: 'Formatted test content',
  createdAt: new Date(),
  status: 'pending',
  retryCount: 0,
});

describe('PrintQueue', () => {
  let queue: PrintQueue;
  let printer: ReturnType<typeof createMockPrinter>;
  let eventBus: ReturnType<typeof createMockEventBus>;

  beforeEach(() => {
    queue = new PrintQueue({ maxSize: 10, retryAttempts: 2, retryDelayMs: 10 });
    printer = createMockPrinter();
    eventBus = createMockEventBus();
    queue.initialize(printer as unknown as PrinterPlugin, eventBus as unknown as TypedEventEmitter);
  });

  test('initializes with correct config', () => {
    expect(queue.size).toBe(0);
    expect(queue.isProcessing).toBe(false);
  });

  test('enqueues jobs', () => {
    const job = createMockJob('1');
    const result = queue.enqueue(job);
    expect(result).toBe(true);
    expect(queue.size).toBe(1);
  });

  test('emits log:queued event', () => {
    const job = createMockJob('1');
    queue.enqueue(job);
    expect(eventBus.emit).toHaveBeenCalledWith('log:queued', job);
  });

  test('rejects jobs when queue is full', () => {
    for (let i = 0; i < 10; i++) {
      queue.enqueue(createMockJob(`${i}`));
    }
    const result = queue.enqueue(createMockJob('overflow'));
    expect(result).toBe(false);
    expect(eventBus.emit).toHaveBeenCalledWith('queue:full', 10);
  });

  test('clears the queue', () => {
    queue.enqueue(createMockJob('1'));
    queue.enqueue(createMockJob('2'));
    const removed = queue.clear();
    expect(removed.length).toBe(2);
    expect(queue.size).toBe(0);
  });

  test('pauses and resumes processing', () => {
    queue.pause();
    queue.enqueue(createMockJob('1'));
    // Queue should not process when paused
    queue.resume();
  });
});
