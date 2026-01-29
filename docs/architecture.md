# Log-Dot-Print System Architecture

## 概要

Log-Dot-Print は、アートインスタレーション向けの **AI ログプリンターシステム** です。Unreal Engine（または任意の HTTP/WebSocket クライアント）からリアルタイムで AI ログを受信し、各種プリンターで印刷します。

## システム全体図

```mermaid
flowchart TB
    subgraph Clients["クライアント層"]
        UE["Unreal Engine"]
        HTTP_Client["HTTP クライアント"]
        WS_Client["WebSocket クライアント"]
    end

    subgraph Server["サーバー層"]
        subgraph Receivers["受信モジュール"]
            HttpReceiver["HttpReceiver<br/>(Hono Framework)"]
            WsReceiver["WebSocketReceiver"]
        end

        EventBus["EventBus<br/>(TypedEventEmitter)"]

        subgraph Processing["処理モジュール"]
            Formatter["LogFormatter"]
            Storage["FileStorage<br/>(JSONL)"]
            Queue["PrintQueue"]
        end
    end

    subgraph Printers["プリンター層"]
        Registry["PrinterRegistry"]
        Mock["MockPrinter"]
        CUPS["CupsPrinter"]
        ESCPOS["EscposPrinter"]
        Serial["SerialPrinter"]
    end

    subgraph Output["出力先"]
        Console["Console"]
        File["File"]
        SystemPrinter["System Printer"]
        ThermalPrinter["Thermal Printer"]
        DotMatrix["Dot Matrix"]
    end

    UE -->|POST /log| HttpReceiver
    HTTP_Client -->|POST /logs| HttpReceiver
    WS_Client -->|WS /ws| WsReceiver

    HttpReceiver --> EventBus
    WsReceiver --> EventBus

    EventBus -->|log:received| Formatter
    EventBus -->|log:received| Storage

    Formatter -->|log:formatted| Queue

    Queue --> Registry
    Registry --> Mock
    Registry --> CUPS
    Registry --> ESCPOS
    Registry --> Serial

    Mock --> Console
    Mock --> File
    CUPS --> SystemPrinter
    ESCPOS --> ThermalPrinter
    Serial --> DotMatrix
```

## コンポーネント構成

```mermaid
graph TB
    subgraph Core["@log-dot-print/core"]
        Types["Types<br/>LogEntry, PrintJob, etc."]
        Events["Events<br/>TypedEventEmitter"]
        Interfaces["Interfaces<br/>Plugin, PrinterPlugin"]
        Utils["Utils<br/>parseLogEntry, wordWrap"]
    end

    subgraph PrinterCore["@log-dot-print/printer-core"]
        BasePrinter["BasePrinter<br/>(Abstract)"]
        PrintQueue2["PrintQueue"]
        Formatters["Formatters<br/>Default, Minimal, JSON"]
        PrinterRegistry2["PrinterRegistry"]
    end

    subgraph Plugins["Printer Plugins"]
        MockPlugin["@log-dot-print/printer-mock"]
        CupsPlugin["@log-dot-print/printer-cups"]
        EscposPlugin["@log-dot-print/printer-escpos"]
        SerialPlugin["@log-dot-print/printer-serial"]
    end

    subgraph ServerPkg["@log-dot-print/server"]
        LogPrintApp["LogPrintApp"]
        HttpRcv["HttpReceiver"]
        WsRcv["WebSocketReceiver"]
        FileStor["FileStorage"]
        CLI["CLI"]
    end

    Core --> PrinterCore
    Core --> ServerPkg
    PrinterCore --> Plugins
    PrinterCore --> ServerPkg
    Plugins --> ServerPkg
```

## ログ受信フロー

```mermaid
flowchart TD
    Start([クライアントからリクエスト])

    Start --> CheckType{プロトコル?}

    CheckType -->|HTTP POST| ParseHTTP[HTTPボディをパース]
    CheckType -->|WebSocket| ParseWS[WSメッセージをパース]

    ParseHTTP --> CreateEntry[LogEntryを生成]
    ParseWS --> CreateEntry

    CreateEntry --> SetFields["フィールド設定<br/>- id: UUID<br/>- timestamp: ISO 8601<br/>- source: headers/IP<br/>- message: JSON"]

    SetFields --> EmitReceived["eventBus.emit<br/>('log:received', entry)"]

    EmitReceived --> HandleLog[LogPrintApp.handleLogReceived]

    HandleLog --> SaveStorage["storage.save(entry)<br/>(非同期・バッファリング)"]
    HandleLog --> FormatLog["formatter.format(entry)"]

    FormatLog --> CreateJob["PrintJobを生成"]

    CreateJob --> EmitFormatted["eventBus.emit<br/>('log:formatted', job)"]

    EmitFormatted --> Enqueue["printQueue.enqueue(job)"]

    Enqueue --> EmitQueued["eventBus.emit<br/>('log:queued', job)"]

    EmitQueued --> Response["レスポンス返却<br/>{accepted, id, queueSize}"]

    Response --> End([完了])
```

## 印刷処理フロー

```mermaid
flowchart TD
    Start([キュー処理開始])

    Start --> CheckQueue{キューに<br/>ジョブあり?}

    CheckQueue -->|No| EmitDrained["eventBus.emit<br/>('queue:drained')"]
    EmitDrained --> Wait[待機]
    Wait --> CheckQueue

    CheckQueue -->|Yes| PopJob[ジョブを取得]

    PopJob --> EmitStarted["eventBus.emit<br/>('print:started', job)"]

    EmitStarted --> Print["printer.print(job)"]

    Print --> CheckResult{印刷結果?}

    CheckResult -->|成功| SetCompleted["job.status = 'completed'"]
    SetCompleted --> EmitCompleted["eventBus.emit<br/>('print:completed', job)"]
    EmitCompleted --> MarkPrinted["storage.markPrinted(job.id)"]
    MarkPrinted --> RemoveJob[キューから削除]
    RemoveJob --> CheckQueue

    CheckResult -->|失敗| IncrRetry["job.retryCount++"]
    IncrRetry --> CheckRetry{リトライ回数<br/>< maxAttempts?}

    CheckRetry -->|Yes| EmitRetry["eventBus.emit<br/>('print:retry', job)"]
    EmitRetry --> Backoff["指数バックオフ待機"]
    Backoff --> Print

    CheckRetry -->|No| SetFailed["job.status = 'failed'"]
    SetFailed --> EmitFailed["eventBus.emit<br/>('print:failed', job, error)"]
    EmitFailed --> RemoveJob
```

## サーバー起動フロー

```mermaid
flowchart TD
    Start([CLI実行])

    Start --> LoadConfig["設定ファイル読み込み<br/>+ CLIオプション解析"]

    LoadConfig --> MergeConfig["設定マージ<br/>(CLI > File > Default)"]

    MergeConfig --> CreateApp["new LogPrintApp(config)"]

    CreateApp --> AppStart["app.start()"]

    AppStart --> InitStorage["FileStorage初期化"]
    InitStorage --> InitFormatter["Formatter初期化"]
    InitFormatter --> InitPrinter["printerRegistry.create()<br/>プリンター初期化"]
    InitPrinter --> InitQueue["printQueue.initialize()"]
    InitQueue --> SetupHandlers["イベントハンドラ設定"]
    SetupHandlers --> InitHttp["httpReceiver.initialize()"]
    InitHttp --> InitWs["wsReceiver.initialize()"]
    InitWs --> CreateServer["HTTPサーバー作成"]

    CreateServer --> TryListen{ポート<br/>使用可能?}

    TryListen -->|Yes| Listen["server.listen(port)"]
    TryListen -->|No| IncrPort["port++"]
    IncrPort --> TryListen

    Listen --> AttachWs["WebSocket接続"]
    AttachWs --> EmitReady["eventBus.emit<br/>('system:ready')"]
    EmitReady --> Ready([サーバー起動完了])
```

## イベントシステム

```mermaid
flowchart LR
    subgraph LogEvents["ログイベント"]
        LR["log:received"]
        LQ["log:queued"]
        LF["log:formatted"]
    end

    subgraph PrintEvents["印刷イベント"]
        PS["print:started"]
        PC["print:completed"]
        PF["print:failed"]
        PR["print:retry"]
    end

    subgraph PrinterEvents["プリンターイベント"]
        PCon["printer:connected"]
        PDis["printer:disconnected"]
        PSt["printer:status"]
        PEr["printer:error"]
    end

    subgraph SystemEvents["システムイベント"]
        SR["system:ready"]
        SS["system:shutdown"]
        SE["system:error"]
    end

    subgraph QueueEvents["キューイベント"]
        QF["queue:full"]
        QD["queue:drained"]
    end

    EventBus((EventBus))

    LogEvents --> EventBus
    PrintEvents --> EventBus
    PrinterEvents --> EventBus
    SystemEvents --> EventBus
    QueueEvents --> EventBus
```

## プリンタープラグインアーキテクチャ

```mermaid
classDiagram
    class PrinterPlugin {
        <<interface>>
        +name: string
        +print(job: PrintJob): Promise~void~
        +getStatus(): PrinterStatus
        +testConnection(): Promise~boolean~
        +connect(): Promise~void~
        +disconnect(): Promise~void~
    }

    class BasePrinter {
        <<abstract>>
        #status: PrinterStatus
        +connect(): Promise~void~
        +disconnect(): Promise~void~
        +print(job: PrintJob): Promise~void~
        #initialize(): Promise~void~
        #shutdown(): Promise~void~
        #doPrint(job: PrintJob): Promise~void~
    }

    class MockPrinter {
        -outputToConsole: boolean
        -outputToFile: boolean
        -simulateDelay: number
        +print(job: PrintJob): Promise~void~
    }

    class CupsPrinter {
        -printerName: string
        +print(job: PrintJob): Promise~void~
    }

    class EscposPrinter {
        -connection: 'network' | 'usb' | 'serial'
        -device: Device
        +print(job: PrintJob): Promise~void~
    }

    class SerialPrinter {
        -port: string
        -baudRate: number
        +print(job: PrintJob): Promise~void~
    }

    PrinterPlugin <|.. BasePrinter
    BasePrinter <|-- MockPrinter
    BasePrinter <|-- CupsPrinter
    BasePrinter <|-- EscposPrinter
    BasePrinter <|-- SerialPrinter
```

## 設定構造

```mermaid
graph TB
    subgraph Config["SystemConfig"]
        Server["server<br/>- port: 3000<br/>- host: '0.0.0.0'"]
        Printer["printer<br/>- type: string<br/>- options: object"]
        Queue["queue<br/>- maxSize: 1000<br/>- retryAttempts: 3<br/>- retryDelayMs: 1000"]
        Format["format<br/>- maxLineWidth: 80<br/>- includeTimestamp: true<br/>- includeSource: true"]
        Storage["storage<br/>- enabled: true<br/>- type: 'file'<br/>- path: './logs/ai-logs.jsonl'"]
    end
```

## デザインパターン

| パターン | 適用箇所 | 説明 |
|---------|---------|------|
| Plugin Architecture | PrinterRegistry | プリンタープラグインの動的登録・生成 |
| Template Method | BasePrinter | プリンターのライフサイクル管理 |
| Event Emitter | TypedEventEmitter | コンポーネント間の疎結合通信 |
| Singleton | printerRegistry, eventBus | グローバルインスタンス管理 |
| Factory | PrinterRegistry.create() | プリンターの型別生成 |
| Strategy | Formatters | 出力形式の切り替え |
| Command | PrintJob | 印刷操作のカプセル化 |
| Observer | Event listeners | 状態変更への反応 |

## モノレポ構成

```
packages/
├── core/                 # 型、イベント、インターフェース（プラットフォーム非依存）
├── printer-core/         # キュー、フォーマッター、ベースプリンター、レジストリ
├── printer-mock/         # Mockプリンタープラグイン
├── printer-cups/         # CUPSプリンタープラグイン
├── printer-escpos/       # ESC/POSプリンタープラグイン
├── printer-serial/       # シリアルプリンタープラグイン
└── server/               # HTTP/WSサーバー、CLI、ストレージ、アプリオーケストレーション
```

## APIエンドポイント

| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/log` | 単一ログエントリの送信 |
| POST | `/logs` | バッチログエントリの送信 |
| GET | `/health` | ヘルスチェック |
| WS | `/ws` | WebSocketリアルタイム接続 |

## 主要な実装詳細

- **非同期/Await**: すべてのI/O操作は非同期ファースト
- **型安全性**: 完全なTypeScriptとジェネリック型付け
- **エラーハンドリング**: try-catch + イベント発行
- **リトライロジック**: 指数バックオフ（遅延をリトライ回数で乗算）
- **書き込みバッファリング**: FileStorageはパフォーマンスのためバッチ書き込み
- **ポートフォールバック**: 設定ポートが使用中の場合自動インクリメント
- **CORS**: クロスオリジンリクエスト有効
- **OpenAPI**: HTTPエンドポイントのドキュメント化
- **Graceful Shutdown**: SIGINT/SIGTERMハンドラがキューをドレインしてから終了
