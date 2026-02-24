---
name: new-printer
description: |
  BasePrinter を継承した新しいプリンター実装を TDD で追加する。
  テストファイル、実装クラス、registry 登録、index.ts エクスポートを一括生成。
  "add a printer", "create printer plugin", "new printer type", "implement printer" などで発動。
argument-hint: "[printer-name]"
---

# 新規プリンター追加ワークフロー

本プロジェクトで新しいプリンタープラグインを追加する際の TDD 実装パターン。
既存の mock / cups / native / escpos / serial / pdf-to-printer プリンターと同一アーキテクチャに従う。

## アーキテクチャ概要

```
BasePrinter (src/printers/base-printer.ts)
     ↑ extends
NewPrinter (src/printers/{name}.ts)
     ↓ registers
printerRegistry (src/printers/registry.ts)
     ↓ re-export
src/printers/index.ts
```

## ファイル構成

新規プリンター `{name}` に対して以下のファイルを作成/編集:

| ファイル                                | 操作                                             |
| --------------------------------------- | ------------------------------------------------ |
| `src/printers/__tests__/{name}.test.ts` | 新規作成（テスト先行）                           |
| `src/printers/{name}.ts`                | 新規作成（実装）                                 |
| `src/printers/index.ts`                 | 編集（エクスポート追加）                         |
| `src/core/types.ts`                     | 編集（`PrinterType` にリテラル追加、必要時のみ） |

## TDD 実装手順

### 1. `core/types.ts` に PrinterType リテラル追加（必要な場合のみ）

`PrinterType` が union literal の場合、新しい型を追加:

```typescript
export type PrinterType =
  | "mock"
  | "cups"
  | "native"
  | "escpos"
  | "serial"
  | "pdf-to-printer"
  | "{name}";
```

### 2. テストファイル作成（先に書く）

`src/printers/__tests__/{name}.test.ts`:

```typescript
import "../__tests__/printers-mock.js"; // 必須: 先頭でモック

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { {ClassName} } from "../{name}.js";
import type { PrintJob, SystemConfig, TypedEventEmitter } from "../../core/index.js";

// 最低限のモック EventBus
function createMockEventBus(): TypedEventEmitter {
  return { emit: () => {} } as unknown as TypedEventEmitter;
}

describe("{ClassName}", () => {
  let printer: {ClassName};

  beforeEach(() => {
    printer = new {ClassName}(/* default options */);
  });

  afterEach(async () => {
    if (printer) {
      try { await printer.shutdown(); } catch {}
    }
  });

  test("has correct name and printerType", () => {
    expect(printer.name).toBe("{name}-printer");
    expect(printer.version).toBeDefined();
  });

  test("initialize connects successfully", async () => {
    const eventBus = createMockEventBus();
    const config = { printer: { type: "{name}", options: {} } } as unknown as SystemConfig;
    await printer.initialize(eventBus, config);
    const status = await printer.getStatus();
    expect(status.connected).toBe(true);
  });

  test("print processes a job", async () => {
    const eventBus = createMockEventBus();
    const config = { printer: { type: "{name}", options: {} } } as unknown as SystemConfig;
    await printer.initialize(eventBus, config);

    const job: PrintJob = {
      id: "test-job-1",
      logEntry: { id: "1", timestamp: new Date().toISOString(), level: "info", source: "test", message: "test", printed: false },
      formattedContent: "Test content",
      createdAt: new Date(),
    };
    await expect(printer.print(job)).resolves.toBeUndefined();
  });

  test("shutdown disconnects", async () => {
    const eventBus = createMockEventBus();
    const config = { printer: { type: "{name}", options: {} } } as unknown as SystemConfig;
    await printer.initialize(eventBus, config);
    await printer.shutdown();
    const status = await printer.getStatus();
    expect(status.connected).toBe(false);
  });
});
```

### 3. 実装ファイル作成

`src/printers/{name}.ts`:

```typescript
import type { PrintJob, PrinterStatus, PrinterType } from "../core/index.js";
import { BasePrinter } from "./base-printer.js";
import { printerRegistry } from "./registry.js";

interface {ClassName}Options {
  // プリンター固有のオプション
}

/**
 * {description}
 *
 * Design: docs/printers/{name}.md (必要に応じて)
 * Related: BasePrinter, PrinterRegistry
 */
export class {ClassName} extends BasePrinter {
  readonly name = "{name}-printer";
  readonly version = "1.0.0";
  protected readonly printerType: PrinterType = "{name}";

  private options: Required<{ClassName}Options>;

  constructor(options: {ClassName}Options = {}) {
    super();
    this.options = {
      // デフォルト値設定
      ...options,
    } as Required<{ClassName}Options>;
  }

  protected async connect(): Promise<void> {
    // 接続ロジック
    console.log(`[{ClassName}] Connected`);
  }

  protected async disconnect(): Promise<void> {
    // 切断ロジック
    console.log(`[{ClassName}] Disconnected`);
  }

  async print(job: PrintJob): Promise<void> {
    // 印刷ロジック
  }
}

/**
 * Factory function for creating {ClassName} instances
 */
export function create{ClassName}(options: Record<string, unknown>): {ClassName} {
  return new {ClassName}({
    // options のバリデーションとマッピング
  });
}

/**
 * Register the {name} printer plugin
 */
export function register(): void {
  printerRegistry.register("{name}", create{ClassName});
}

// Auto-register when imported
register();
```

### 4. ネイティブモジュール依存がある場合

ネイティブモジュール（serialport, escpos, @printers/printers 等）に依存する場合は
自動登録ではなく `tryRegister` パターンを使用:

```typescript
// {name}.ts 末尾
export function tryRegister(): boolean {
  try {
    // ネイティブモジュールの import チェック
    register();
    console.log(`[{ClassName}] Registered successfully`);
    return true;
  } catch {
    console.log(`[{ClassName}] Module not available, skipping registration`);
    return false;
  }
}
// auto-register を削除
```

```typescript
// index.ts に追加
export async function tryRegister{ClassName}(): Promise<boolean> {
  try {
    const { tryRegister } = await import("./{name}.js");
    return tryRegister();
  } catch {
    console.log("[Printers] Failed to load {name} printer module");
    return false;
  }
}
```

### 5. index.ts にエクスポート追加

`src/printers/index.ts`:

自動登録の場合:

```typescript
import "./{name}.js";
```

ネイティブモジュール依存の場合:

```typescript
export async function tryRegister{ClassName}(): Promise<boolean> { ... }
```

### 6. 検証（AGENTS.md 準拠）

```bash
bun test && bun run build && bun run lint && bun run format
```

## 注意事項

- テストファイル先頭で `printers-mock.js` を必ずインポート（モック初期化順序）
- `PrinterType` リテラル型と `printerType` プロパティ値を一致させる
- ネイティブモジュール依存は `tryRegister` パターンを使い、import 失敗を graceful に処理
- ファクトリ関数の引数は `Record<string, unknown>` — typeof ガードで型変換
- oxfmt が自動整形するため手動整形は不要
