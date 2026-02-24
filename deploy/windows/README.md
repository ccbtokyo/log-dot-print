# Windows デプロイガイド

Log-Dot-Print を Windows 上でサービスとして本番運用するための手順書です。

## 前提条件

| ソフトウェア                   | バージョン             | 用途                                      |
| ------------------------------ | ---------------------- | ----------------------------------------- |
| Windows                        | 10 / 11 / Server 2019+ | OS                                        |
| PowerShell                     | 5.1 以上               | スクリプト実行                            |
| [Bun](https://bun.sh)          | 最新                   | ランタイム（`bun:sqlite` 依存のため必須） |
| [Node.js](https://nodejs.org/) | LTS                    | Playwright サブプロセス用                 |

> **注意**: `bun:sqlite` を使用しているため、Node.js ではなく Bun で実行する必要があります。

## ファイル構成

```
deploy/windows/
├── README.md                 # この手順書
├── winsw/
│   └── log-dot-print-service.xml.template  # WinSW 設定テンプレート
└── scripts/
    ├── setup-environment.ps1       # 初回環境構築
    ├── build-production.ps1        # 本番ビルド
    ├── install-service.ps1         # サービスインストール
    ├── uninstall-service.ps1       # サービス削除
    ├── start-service.ps1           # サービス開始
    ├── stop-service.ps1            # サービス停止
    ├── enable-service.ps1          # 自動起動 ON
    ├── disable-service.ps1         # 自動起動 OFF
    ├── status-service.ps1          # ステータス確認
    ├── restart-service.ps1         # 再起動
    ├── watchdog.ps1                # ヘルスチェック
    ├── install-watchdog.ps1        # ウォッチドッグ登録
    └── uninstall-watchdog.ps1      # ウォッチドッグ削除
```

## 1. 初回セットアップ

```powershell
# PowerShell の実行ポリシーを設定（初回のみ）
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# 環境構築スクリプトを実行
.\deploy\windows\scripts\setup-environment.ps1
```

このスクリプトは以下を自動で行います:

- Bun のインストール確認
- Node.js の確認（Playwright 用）
- `bun install` による依存パッケージインストール
- Playwright Chromium のインストール
- `data/` / `logs/` ディレクトリの作成
- プリンターの存在確認
- `config.json` の初期配置

## 2. 設定ファイル

`config.json` を環境に合わせて編集します:

```json
{
  "server": {
    "port": 3000,
    "host": "0.0.0.0"
  },
  "printer": {
    "type": "native",
    "options": {
      "printerName": "Your Printer Name"
    }
  }
}
```

プリンター名は `Get-CimInstance Win32_Printer | Select Name` で確認できます。

## 3. ビルド

```powershell
.\deploy\windows\scripts\build-production.ps1
```

`dist/cli.js` と `dist/ui/` が生成されることを確認してください。

### 手動確認

```powershell
bun dist/cli.js
# http://localhost:3000/api/health にアクセスして応答を確認
```

## 4. サービス登録

> **管理者権限が必要です。** PowerShell を「管理者として実行」してください。

```powershell
.\deploy\windows\scripts\install-service.ps1
```

このスクリプトは以下を行います:

1. WinSW バイナリのダウンロード（初回のみ）
2. XML 設定ファイルのパス置換
3. Windows サービスとして登録
4. サービスアカウントの設定
5. ファイアウォールルールの追加

## 5. 日常運用

すべてのサービス管理スクリプトには管理者権限が必要です（`status-service.ps1` を除く）。

### サービスの開始・停止・再起動

```powershell
.\deploy\windows\scripts\start-service.ps1     # 開始
.\deploy\windows\scripts\stop-service.ps1      # 停止
.\deploy\windows\scripts\restart-service.ps1   # 再起動
```

### ステータス確認

```powershell
.\deploy\windows\scripts\status-service.ps1
```

以下の情報を表示します:

- サービス状態
- ヘルスチェック結果
- 最新ログ（20 行）
- プリンター状態
- ディスク使用量
- プロセスメモリ使用量

### 自動起動の制御

```powershell
.\deploy\windows\scripts\enable-service.ps1    # OS 起動時に自動開始
.\deploy\windows\scripts\disable-service.ps1   # 自動開始を無効化
```

## 6. ウォッチドッグ（自動復旧）

5 分間隔でヘルスチェックを行い、異常時にサービスを自動再起動します。

```powershell
# 登録（管理者権限必要）
.\deploy\windows\scripts\install-watchdog.ps1

# 削除
.\deploy\windows\scripts\uninstall-watchdog.ps1
```

ウォッチドッグの動作:

1. サービスが停止していれば自動起動
2. `/api/health` に HTTP リクエスト（タイムアウト 10 秒）
3. 3 回連続失敗でサービスを強制再起動
4. ログを `logs/watchdog.log` に記録

## 7. トラブルシューティング

### サービスが起動しない

```powershell
# サービスのイベントログを確認
Get-EventLog -LogName Application -Source "LogDotPrint" -Newest 10

# WinSW のログを確認
Get-Content .\logs\log-dot-print-service.wrapper.log -Tail 50

# 手動で起動して確認
bun dist/cli.js
```

### ヘルスチェックが失敗する

```powershell
# ポート番号を確認
Get-Content .\config.json | ConvertFrom-Json | Select-Object -ExpandProperty server

# ポートが使用中か確認
netstat -an | findstr :3000

# ファイアウォールルールを確認
Get-NetFirewallRule -DisplayName "Log-Dot-Print"
```

### プリンターが見つからない

```powershell
# 利用可能なプリンターを一覧表示
Get-CimInstance Win32_Printer | Select-Object Name, DriverName, PortName, PrinterStatus

# config.json のプリンター名が一致しているか確認
```

### メモリ使用量が増え続ける

```powershell
# プロセスのメモリ使用量を確認
Get-Process bun | Select-Object Id, WorkingSet64, CPU

# サービスを再起動
.\deploy\windows\scripts\restart-service.ps1
```

### ウォッチドッグが動作しない

```powershell
# タスクスケジューラの状態を確認
Get-ScheduledTask -TaskName "LogDotPrint-Watchdog" | Select-Object State, LastRunTime, LastTaskResult

# ウォッチドッグログを確認
Get-Content .\logs\watchdog.log -Tail 20

# 手動実行してテスト
powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy\windows\scripts\watchdog.ps1
```

## 8. アンインストール

```powershell
# サービスとファイアウォールルールを削除（ウォッチドッグも削除するか確認あり）
.\deploy\windows\scripts\uninstall-service.ps1

# ウォッチドッグのみ削除
.\deploy\windows\scripts\uninstall-watchdog.ps1
```

> `data/` および `logs/` ディレクトリは手動で削除してください。

## 自動復旧の仕組み

本システムは二重の監視体制で無人運用を実現します:

```
[WinSW サービスラッパー]
  └─ プロセスクラッシュ → 自動再起動（10s → 30s → 60s）
  └─ OS 起動 → 遅延自動起動

[ウォッチドッグ（5 分間隔）]
  └─ サービス停止 → Start-Service
  └─ ヘルスチェック失敗 × 3 → Restart-Service
```
