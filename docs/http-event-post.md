# HTTP POST でイベント（ログ）を登録する

このドキュメントは、log-dot-print server に JSON を POST してイベント（ログ）を登録するための
エンドポイント、動作フロー、payload、response、error case をまとめたものです。

## ベースURL

- `http://{host}:{port}`
- デフォルトは `host=0.0.0.0`, `port=3000`
- 起動時にポートが使用中の場合は自動的に次のポートへフォールバックします

## エンドポイント

### 単発送信

- `POST /log`

### バッチ送信

- `POST /logs`

### 共通ヘッダー

- `Content-Type: application/json`

## 動作フロー（内部）

1. HTTP サーバーが JSON を受信し、`JSON.parse` を実行
2. `parseLogEntry` が payload を文字列化し、LogEntry を生成
3. `log:received` イベントを EventBus に emit
4. `LogPrintApp` が `log:received` を受けて以下を実行
   - 可能ならストレージへ保存
   - フォーマット済み文字列を生成
   - PrintQueue に enqueue
5. PrintQueue がプリンタープラグインで印刷処理を開始

## payload 仕様（重要）

- **任意の JSON** を受け付けます（object / array / primitive / null）。
- 受け取った payload は **そのまま `JSON.stringify` されて `message` になります**。
- `id` と `timestamp` は **常にサーバー側で生成** されます。
  - `id`: 新規UUID
  - `timestamp`: 受信時刻の ISO 文字列
- `source` は **リクエストヘッダー由来の情報** から決定されます。
  - 例: `x-forwarded-for` / `forwarded` / `x-real-ip` / `host` / `from` など
  - 見つからない場合は `unknown` になります
- `level` は **使用しません**（常に内部では `info` 扱い）。
- つまり、payload に `source` や `level` を入れても **フィールドとしては反映されず**、
  payload 全体が文字列化されて `message` になります。

### 例: 単発送信

```bash
curl -X POST http://localhost:3000/log \
  -H "Content-Type: application/json" \
  -d '{"source":"AI_1","level":"thought","message":"Hello"}'
```

上の例は、実際には `message` に以下の文字列が入ります。

```
{"source":"AI_1","level":"thought","message":"Hello"}
```

### 例: 任意 JSON（配列・数値・null など）

```bash
curl -X POST http://localhost:3000/log \
  -H "Content-Type: application/json" \
  -d '["a", 1, true]'
```

## Response

### 単発送信: 成功

- HTTP Status: `200`
- Body:

```json
{
  "success": true,
  "id": "<generated-id>",
  "queueSize": 3
}
```

### 単発送信: 失敗

- HTTP Status: `503` / `504` / `500`
- Body:

```json
{
  "success": false,
  "id": "<generated-id>",
  "error": "Queue is full",
  "code": "queue_full",
  "queueSize": 1000
}
```

### バッチ送信

- HTTP Status:
  - 全件成功: `200`
  - 1件でも失敗: `503`
- Body:

```json
{
  "results": [
    {
      "success": true,
      "id": "<generated-id>",
      "queueSize": 3
    },
    {
      "success": false,
      "id": "<generated-id>",
      "error": "Queue is full",
      "code": "queue_full",
      "queueSize": 1000
    }
  ]
}
```

## Error case 一覧

### 400 Bad Request

- `Invalid JSON`:
  - JSON パース失敗
  - 例: 文字列が不正、末尾カンマなど
- `Invalid log entry`:
  - `parseLogEntry` が null を返した場合（JSON として送れる値ではほぼ発生しません）

### 503 Service Unavailable

- `queue_full`:
  - PrintQueue が満杯
- `no_handler`:
  - `log:received` を処理するハンドラが未登録
- `not_ready`:
  - Receiver 未初期化

### 504 Gateway Timeout

- `timeout`:
  - 受理処理が 300 秒以内に完了しない

### 500 Internal Server Error

- `internal_error` など、上記に該当しないサーバー側エラー

## 参考: レスポンスのフィールド

| フィールド  | 型      | 説明                                   |
| ----------- | ------- | -------------------------------------- |
| `success`   | boolean | 受付成功 여부（`accepted` に相当）     |
| `id`        | string  | 受理したログのID（常に生成されたUUID） |
| `queueSize` | number  | 受理時点のキューサイズ                 |
| `error`     | string  | 失敗時のメッセージ                     |
| `code`      | string  | 失敗時の機械可読コード                 |
