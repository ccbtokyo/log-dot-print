# Log-Dot-Print

AI Log Printer System for Art Installations - Real-time printing of UE AI logs

## Overview

アートインスタレーション向けの AI ログプリンターシステム。Unreal Engine や HTTP/WebSocket クライアントから AI ログデータを受信し、各種プリンターでリアルタイムに印刷する。

```
┌─────────────────────┐         ┌───────────────────────────────────────────┐
│   UE Machine        │         │       Print Machine                       │
│                     │         │                                           │
│  ┌───────────────┐  │  HTTP/  │  ┌──────────┐  ┌───────────┐  ┌───────┐ │
│  │ UE Game +     │  │  WS     │  │   Log    │─▶│  Format   │─▶│ Queue │ │
│  │ AI System     │──┼────────▶│  │ Receiver │  │ (text/    │  └───┬───┘ │
│  └───────────────┘  │         │  └──────────┘  │  html/    │      │     │
│                     │         │       │        │  replay)  │      ▼     │
│                     │         │       ▼        └───────────┘  ┌───────┐ │
│                     │         │  ┌──────────┐  ┌───────────┐  │Printer│ │
│                     │         │  │ Storage  │  │ Converter │◀─│Plugin │ │
│                     │         │  │(SQLite/  │  │(PNG/PDF)  │  └───────┘ │
│                     │         │  │ JSONL)   │  └───────────┘            │
│                     │         │  └──────────┘                           │
│                     │         │       │        ┌───────────┐            │
│                     │         │       └───────▶│  Web UI   │            │
│                     │         │                └───────────┘            │
└─────────────────────┘         └───────────────────────────────────────────┘
```

## Features

- **イベント駆動アーキテクチャ** - `TypedEventEmitter` による型安全な疎結合設計
- **プラグインシステム** - `BasePrinter` を継承して新規プリンターを追加可能
- **複数プリンター対応**:
  - Mock (デバッグ/コンソール出力)
  - CUPS (Linux/macOS システムプリンター)
  - ESC/POS (サーマルプリンター)
  - Serial (ドットインパクトプリンター)
  - Native (クロスプラットフォーム、`@printers/printers` 利用)
  - PDF-to-Printer (Windows、SumatraPDF 利用)
- **複数出力フォーマット**: text / json / html / replay
- **変換パイプライン**: HTML → PNG / BMP / PDF (Playwright)
- **ログ永続化**: SQLite または JSONL ファイル
- **Web UI**: リアルタイムキュー監視・印刷履歴・設定管理
- **HTTP + WebSocket**: 柔軟なログ受信

## Quick Start

```bash
# 依存パッケージをインストール
bun install

# ビルド
bun run build

# 開発サーバー起動 (mock プリンター)
bun run dev

# 設定ファイルを指定して起動
bun dist/cli.js -c config.json
```

## CLI

```
Usage: log-dot-print [options]

Options:
  -c, --config <path>    設定ファイルパス (JSON)
  -p, --port <port>      サーバーポート (default: 3000)
  -h, --host <host>      サーバーホスト (default: 0.0.0.0)
  --printer <type>       プリンター種別 (mock, native, cups, escpos, serial, pdf-to-printer)
  --help                 ヘルプ表示

Environment Variables:
  PORT                   サーバーポート (-p/--port で上書き)
  HOST                   サーバーホスト (-h/--host で上書き)
  PRINTER_TYPE           プリンター種別 (--printer で上書き)
  PRINTER_NAME           プリンター名 (native プリンター用)
  PRINTERS_JS_SIMULATE   "true" でシミュレーションモード (実際の印刷なし)
```

## API

### HTTP Endpoints

```bash
# ログ送信 (単一)
curl -X POST http://localhost:3000/api/log \
  -H "Content-Type: application/json" \
  -d '{"event": "AI_Character_1", "message": "I should approach the player"}'

# ログ送信 (バッチ)
curl -X POST http://localhost:3000/api/logs \
  -H "Content-Type: application/json" \
  -d '[
    {"event": "AI_1", "message": "Moving to target"},
    {"event": "AI_2", "message": "Feeling curious"}
  ]'

# ヘルスチェック
curl http://localhost:3000/api/health
```

| Method | Path                     | Description                  |
| ------ | ------------------------ | ---------------------------- |
| `POST` | `/api/log`               | ログ送信 (単一)              |
| `POST` | `/api/logs`              | ログ送信 (バッチ)            |
| `GET`  | `/api/health`            | ヘルスチェック               |
| `GET`  | `/api/openapi.json`      | OpenAPI 仕様                 |
| `GET`  | `/api/queue`             | キュー状態取得               |
| `GET`  | `/api/queue/:id`         | ジョブ詳細取得               |
| `GET`  | `/api/queue/:id/preview` | フォーマット済みプレビュー   |
| `GET`  | `/api/printers`          | OS プリンター一覧            |
| `GET`  | `/api/settings/printer`  | 現在のプリンター設定         |
| `GET`  | `/api/papers`            | 用紙サイズ一覧               |
| `GET`  | `/api/settings/paper`    | 現在の用紙設定               |
| `GET`  | `/api/history`           | 印刷履歴 (ページネーション)  |
| `GET`  | `/api/history/:id`       | 履歴エントリ詳細             |
| `GET`  | `/api/history/:id/file`  | 印刷済みファイルダウンロード |

### WebSocket

```javascript
// ログ送信用
const ws = new WebSocket("ws://localhost:3000/ws");

ws.onopen = () => {
  ws.send(
    JSON.stringify({
      type: "log",
      payload: {
        event: "AI_Character_1",
        message: "The player is nearby",
      },
    }),
  );
};

// Web UI リアルタイム更新用
const uiWs = new WebSocket("ws://localhost:3000/ws/ui");
```

### Log Entry Format

```typescript
// 任意の JSON シリアライズ可能な値を受け付ける (object/array/primitive/null)
// サーバーは JSON.stringify(payload) をそのまま印刷する
// source はリクエストヘッダーから導出される
type LogPayload = unknown;
```

## Configuration

設定ファイル例は `config.*.example.json` を参照。

```json
{
  "server": {
    "port": 3000,
    "host": "0.0.0.0"
  },
  "printer": {
    "type": "mock",
    "options": {
      "logToConsole": true,
      "logToFile": "./logs/printed.log"
    }
  },
  "queue": {
    "maxSize": 1000,
    "retryAttempts": 3,
    "retryDelayMs": 1000
  },
  "format": {
    "outputFormat": "text",
    "maxLineWidth": 80,
    "includeTimestamp": true,
    "includeSource": true,
    "includeLevel": false
  },
  "conversion": {
    "enabled": true,
    "format": "png",
    "width": 2835,
    "grayscale": false
  },
  "storage": {
    "enabled": true,
    "type": "sqlite",
    "path": "./data/logs.db"
  },
  "ui": {
    "enabled": true,
    "wsPath": "/ws/ui"
  }
}
```

### Printer Configurations

#### Mock (デバッグ)

```json
{
  "printer": {
    "type": "mock",
    "options": {
      "logToConsole": true,
      "logToFile": "./logs/printed.log",
      "printDelayMs": 100
    }
  }
}
```

#### Native (クロスプラットフォーム)

```json
{
  "printer": {
    "type": "native",
    "options": {
      "printerName": "EPSON VP-F4400N",
      "paperSize": "15x11",
      "paperKind": 120
    }
  }
}
```

#### CUPS (Linux/macOS)

```json
{
  "printer": {
    "type": "cups",
    "options": {
      "printerName": "HP_LaserJet",
      "paperSize": "a4",
      "copies": 1,
      "htmlConverter": "weasyprint"
    }
  }
}
```

#### ESC/POS (サーマルプリンター)

```json
{
  "printer": {
    "type": "escpos",
    "options": {
      "connectionType": "network",
      "host": "192.168.1.100",
      "port": 9100,
      "width": 48,
      "encoding": "GB18030",
      "cut": true
    }
  }
}
```

#### Serial (ドットインパクト)

```json
{
  "printer": {
    "type": "serial",
    "options": {
      "path": "/dev/ttyUSB0",
      "baudRate": 9600,
      "dataBits": 8,
      "stopBits": 1,
      "parity": "none",
      "lineEnding": "crlf",
      "lineDelayMs": 50,
      "formFeed": true
    }
  }
}
```

#### PDF-to-Printer (Windows)

```json
{
  "printer": {
    "type": "pdf-to-printer",
    "options": {
      "printerName": "Your_Printer_Name",
      "copies": 1
    }
  }
}
```

### Output Formats

| Format   | Description                    | Use Case                        |
| -------- | ------------------------------ | ------------------------------- |
| `text`   | プレーンテキスト               | 汎用。サーマル/ドットインパクト |
| `json`   | Pretty-printed JSON            | デバッグ                        |
| `html`   | カスタムフォント/CSS 対応 HTML | レーザープリンター              |
| `replay` | ゲームプレイ会話チャット形式   | アートインスタレーション        |

#### Replay Format

ゲームプレイの会話ログを印刷する専用フォーマット。

```json
{
  "format": {
    "outputFormat": "replay",
    "fontFamily": "Noto Sans JP",
    "fontSize": 28,
    "pageWidth": 355,
    "sideMargin": 10
  }
}
```

入力ペイロード:

```json
{
  "gameplay": [
    {
      "npc": { "replay_id": "npc_001", "nickname": "Alice" },
      "dialogue": [
        { "role": "npc", "text": "Hello!" },
        { "role": "player", "text": "Hi there!" }
      ]
    }
  ],
  "respawn": {
    "nickname": "Player Name",
    "age": "30",
    "gender": "they/them"
  }
}
```

### Conversion Pipeline

HTML 出力をドットインパクトプリンター向けにラスタライズ変換。

```json
{
  "conversion": {
    "enabled": true,
    "format": "png",
    "width": 2835,
    "grayscale": false
  }
}
```

対応フォーマット: `png`, `bmp`, `pdf`

## Project Structure

```
src/
├── core/           # 型定義、イベント、インターフェース（依存なし）
├── printers/       # プリンター抽象化 + 実装（core に依存）
│   ├── converters/ # HTML → PNG/BMP/PDF 変換
│   └── __tests__/
├── storage/        # ストレージ実装（core に依存）
├── server/         # HTTP/WS サーバー（core, printers, storage に依存）
│   └── ui/         # Web UI 静的アセット
├── ui/             # Web UI フロントエンド (lit-html)
└── cli.ts          # エントリーポイント
```

### Dependency Flow

```
core → printers → storage → server → cli
```

## Development

```bash
bun test                    # テスト実行
bun run build               # ビルド (tsgo + UI)
bun run lint                # リント (oxlint)
bun run format              # フォーマット (oxfmt)

bun test src/core           # 単一モジュールのテスト
bun run dev                 # 開発サーバー起動 (hot reload)
bun test --coverage         # カバレッジ付きテスト
```

## Extending

### Adding a New Printer Plugin

```typescript
import { BasePrinter } from "./base-printer";
import { printerRegistry } from "./registry";

class MyPrinter extends BasePrinter {
  readonly name = "my-printer";
  readonly version = "1.0.0";
  protected readonly printerType = "custom";

  async initialize(): Promise<void> {
    // プリンターに接続
  }

  async shutdown(): Promise<void> {
    // 切断
  }

  protected async doPrint(content: string): Promise<void> {
    // 印刷処理
    console.log(content);
  }
}

// レジストリに登録
printerRegistry.register("my-printer", (options) => new MyPrinter(options));
```

## Unreal Engine Integration

### Blueprint HTTP Request

`VaRest` プラグインまたは組み込み HTTP モジュールを使用:

```cpp
void UAILogSender::SendLog(const FString& Source, const FString& Level, const FString& Message)
{
    TSharedPtr<FJsonObject> JsonObject = MakeShared<FJsonObject>();
    JsonObject->SetStringField("source", Source);
    JsonObject->SetStringField("level", Level);
    JsonObject->SetStringField("message", Message);
    JsonObject->SetStringField("timestamp", FDateTime::Now().ToIso8601());

    // Send via HTTP POST to http://print-server:3000/api/log
}
```

## License

[MIT](LICENSE) - Copyright (c) 2025-present ccbtokyo (Civic Creative Base Tokyo)
