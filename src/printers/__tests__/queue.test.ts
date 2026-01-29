import { describe, test, expect, mock, beforeEach } from "bun:test";
import { PrintQueue } from "../queue";
import type { PrintJob, PrinterPlugin, TypedEventEmitter } from "../../core/index.js";

// Mock printer
const createMockPrinter = () => ({
  name: "test-printer",
  version: "1.0.0",
  initialize: mock(() => Promise.resolve()),
  shutdown: mock(() => Promise.resolve()),
  getStatus: mock(() =>
    Promise.resolve({ connected: true, name: "test", type: "mock" as const, ready: true }),
  ),
  print: mock(() => Promise.resolve()),
  testConnection: mock(() => Promise.resolve(true)),
});

// Mock event bus
const createMockEventBus = () => ({
  emit: mock(() => true),
  on: mock(() => ({}) as TypedEventEmitter),
  once: mock(() => ({}) as TypedEventEmitter),
  off: mock(() => ({}) as TypedEventEmitter),
});

const createMockJob = (id: string): PrintJob => ({
  id,
  logEntry: {
    id: `log-${id}`,
    timestamp: new Date().toISOString(),
    source: "test",
    level: "info",
    message: "Test message",
    printed: false,
  },
  formattedContent: "Formatted test content",
  createdAt: new Date(),
  status: "pending",
  retryCount: 0,
});

describe("PrintQueue", () => {
  let queue: PrintQueue;
  let printer: ReturnType<typeof createMockPrinter>;
  let eventBus: ReturnType<typeof createMockEventBus>;

  beforeEach(() => {
    queue = new PrintQueue({ maxSize: 10, retryAttempts: 2, retryDelayMs: 10 });
    printer = createMockPrinter();
    eventBus = createMockEventBus();
    queue.initialize(printer as unknown as PrinterPlugin, eventBus as unknown as TypedEventEmitter);
  });

  test("initializes with correct config", () => {
    expect(queue.size).toBe(0);
    expect(queue.isProcessing).toBe(false);
  });

  test("enqueues jobs", () => {
    const job = createMockJob("1");
    const result = queue.enqueue(job);
    expect(result).toBe(true);
    expect(queue.size).toBe(1);
  });

  test("emits log:queued event", () => {
    const job = createMockJob("1");
    queue.enqueue(job);
    expect(eventBus.emit).toHaveBeenCalledWith("log:queued", job);
  });

  test("rejects jobs when queue is full", () => {
    for (let i = 0; i < 10; i++) {
      queue.enqueue(createMockJob(`${i}`));
    }
    const result = queue.enqueue(createMockJob("overflow"));
    expect(result).toBe(false);
    expect(eventBus.emit).toHaveBeenCalledWith("queue:full", 10);
  });

  test("clears the queue", () => {
    queue.enqueue(createMockJob("1"));
    queue.enqueue(createMockJob("2"));
    const removed = queue.clear();
    expect(removed.length).toBe(2);
    expect(queue.size).toBe(0);
  });

  test("pauses and resumes processing", () => {
    queue.pause();
    expect(queue.isPaused).toBe(true);
    expect(eventBus.emit).toHaveBeenCalledWith("queue:paused");
    queue.enqueue(createMockJob("1"));
    // Queue should not process when paused
    queue.resume();
    expect(queue.isPaused).toBe(false);
    expect(eventBus.emit).toHaveBeenCalledWith("queue:resumed");
  });

  test("emits queue:state on pause", () => {
    queue.pause();
    const stateCalls = (eventBus.emit as ReturnType<typeof mock>).mock.calls.filter(
      (call) => call[0] === "queue:state",
    );
    expect(stateCalls.length).toBeGreaterThan(0);
  });

  test("skips a job from queue", () => {
    const job1 = createMockJob("1");
    const job2 = createMockJob("2");
    queue.pause(); // Pause to prevent processing
    queue.enqueue(job1);
    queue.enqueue(job2);

    const skipped = queue.skip("1");
    expect(skipped).not.toBeNull();
    expect(skipped?.id).toBe("1");
    expect(queue.size).toBe(1);
    expect(eventBus.emit).toHaveBeenCalledWith("queue:job:skipped", job1);
  });

  test("skip returns null for non-existent job", () => {
    queue.pause();
    queue.enqueue(createMockJob("1"));
    const result = queue.skip("non-existent");
    expect(result).toBeNull();
  });

  test("prioritizes a job to front of queue", () => {
    queue.pause();
    queue.enqueue(createMockJob("1"));
    queue.enqueue(createMockJob("2"));
    queue.enqueue(createMockJob("3"));

    const newPos = queue.prioritize("3");
    expect(newPos).toBe(0);

    const state = queue.getState();
    expect(state.jobs[0].id).toBe("3");
    expect(state.jobs[1].id).toBe("1");
    expect(state.jobs[2].id).toBe("2");
  });

  test("prioritize returns -1 for non-existent job", () => {
    queue.pause();
    queue.enqueue(createMockJob("1"));
    const result = queue.prioritize("non-existent");
    expect(result).toBe(-1);
  });

  test("prioritize returns 0 if already at front", () => {
    queue.pause();
    queue.enqueue(createMockJob("1"));
    queue.enqueue(createMockJob("2"));

    const result = queue.prioritize("1");
    expect(result).toBe(0);
  });

  test("getState returns correct queue state", () => {
    queue.pause();
    const job = createMockJob("1");
    queue.enqueue(job);

    const state = queue.getState();
    expect(state.isPaused).toBe(true);
    expect(state.isProcessing).toBe(false);
    expect(state.totalSize).toBe(1);
    expect(state.jobs.length).toBe(1);
    expect(state.jobs[0].id).toBe("1");
    expect(state.jobs[0].position).toBe(0);
    expect(state.jobs[0].source).toBe("test");
  });

  test("getJob returns job by id", () => {
    queue.pause();
    const job = createMockJob("1");
    queue.enqueue(job);

    const found = queue.getJob("1");
    expect(found).not.toBeNull();
    expect(found?.id).toBe("1");
  });

  test("getJob returns null for non-existent job", () => {
    queue.pause();
    queue.enqueue(createMockJob("1"));

    const found = queue.getJob("non-existent");
    expect(found).toBeNull();
  });

  test("messagePreview truncates long messages", () => {
    queue.pause();
    const longMessage = "A".repeat(150);
    const job = createMockJob("1");
    job.logEntry.message = longMessage;
    queue.enqueue(job);

    const state = queue.getState();
    expect(state.jobs[0].messagePreview.length).toBe(100);
    expect(state.jobs[0].messagePreview.endsWith("...")).toBe(true);
  });
});
