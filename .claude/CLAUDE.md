# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@../AGENTS.md

## ビルド・テストコマンド

```bash
bun test                    # テスト実行
bun run build               # ビルド (tsc)
bun run lint                # リント (oxlint)
bun run format              # フォーマット (oxfmt)

bun test src/core           # 単一モジュールのテスト
bun run dev                 # 開発サーバー起動 (hot reload)
```

## アーキテクチャ概要

アートインスタレーション向け AI ログプリンターシステム。UE/HTTP/WebSocket からログを受信し、各種プリンターで印刷する。

### ディレクトリ構造

```
src/
├── core/           # 型定義、イベント、インターフェース（依存なし）
├── printers/       # プリンター抽象化 + 実装（core に依存）
├── storage/        # ストレージ実装（core に依存）
├── server/         # HTTP/WS サーバー（core, printers, storage に依存）
├── ui/             # フロントエンド UI（別途 esbuild でビルド）
└── cli.ts          # エントリーポイント
```

### 依存方向（一方向）

```
core → printers → storage → server → cli
```

### 設計原則

- **疎結合**: `TypedEventEmitter` によるイベント駆動で全コンポーネント間を疎結合化
- **高凝集**: 各モジュールは単一責任
- **一方向依存**: 循環依存を避け、上位モジュールが下位モジュールに依存
- **Pluggable**: `BasePrinter` を継承して新規プリンター追加可能

### イベントフロー

```
log:received → LogPrintApp.handleLogReceived → log:formatted → printQueue.enqueue → log:queued
                                                                      ↓
print:started ← printQueue処理 ← queue:drained/queue:full
      ↓
print:completed / print:failed / print:retry
```

### 主要クラス

| クラス | 場所 | 役割 |
|--------|------|------|
| `TypedEventEmitter` | core/events.ts | 型安全なイベントバス |
| `LogPrintApp` | server/app.ts | アプリオーケストレーション |
| `PrinterRegistry` | printers/registry.ts | プリンターファクトリ登録・生成 |
| `BasePrinter` | printers/base-printer.ts | プリンター抽象基底クラス |
| `PrintQueue` | printers/queue.ts | 印刷ジョブキュー管理 |

### 新規プリンター追加

1. `BasePrinter` を継承（`src/printers/new-printer.ts`）
2. `name`, `version`, `printerType` プロパティを実装
3. `initialize()`, `shutdown()`, `doPrint()` メソッドを実装
4. `printerRegistry.register('type', factory)` で登録
5. `src/printers/index.ts` に import を追加

### イベント一覧

- ログ: `log:received`, `log:formatted`, `log:queued`
- 印刷: `print:started`, `print:completed`, `print:failed`, `print:retry`
- プリンター: `printer:connected`, `printer:disconnected`, `printer:status`, `printer:error`
- キュー: `queue:full`, `queue:drained`
- システム: `system:ready`, `system:shutdown`, `system:error`
