---
name: deploy-check
description: |
  Windows デプロイ前の検証を実行する。
  dist/ のビルド成果物確認、config.json スキーマ検証、WinSW テンプレートの整合性チェック、
  プリンター設定の妥当性チェックなどを行い、デプロイ可能かどうかを判定する。
  "deploy check", "deployment verification", "pre-deploy validation", "デプロイ確認" で発動。
disable-model-invocation: true
---

# Windows デプロイ前検証

本番デプロイ前に以下の項目を順番にチェックし、結果を報告する。

## 検証項目

### 1. ビルド成果物チェック

以下のファイルが存在し、空でないことを確認:

```bash
# 必須ファイル
dist/cli.js           # メインエントリーポイント
dist/ui/index.html    # UI フロントエンド
dist/ui/main.js       # UI バンドル
```

ファイルサイズも表示して異常に小さいビルド成果物を検出する。

### 2. config.json スキーマ検証

`config.json` が存在する場合、以下を検証:

- JSON として valid であること
- `server.port` が数値であること
- `server.host` が文字列であること
- `printer.type` が有効なプリンタータイプであること
  - 有効値: `mock`, `cups`, `native`, `escpos`, `serial`, `pdf-to-printer`
- `printer.options` がオブジェクトであること

`config.json` が存在しない場合は WARNING として報告（`config.example.json` からのコピーを推奨）。

### 3. WinSW テンプレート整合性

`deploy/windows/winsw/log-dot-print-service.xml.template` を検証:

- ファイルが存在すること
- `{{PROJECT_ROOT}}` プレースホルダが含まれていること
- `{{BUN_PATH}}` プレースホルダが含まれていること
- プレースホルダが実パスに置換されていないこと（前回 install で上書きされていないか）

### 4. PowerShell スクリプト整合性

`deploy/windows/scripts/` 配下の全 `.ps1` ファイルについて:

- 全 13 スクリプトが存在すること
- 各ファイルが空でないこと
- UTF-8 エンコーディングであること

必須スクリプト一覧:

```
setup-environment.ps1
build-production.ps1
install-service.ps1
uninstall-service.ps1
start-service.ps1
stop-service.ps1
enable-service.ps1
disable-service.ps1
status-service.ps1
restart-service.ps1
watchdog.ps1
install-watchdog.ps1
uninstall-watchdog.ps1
```

### 5. package.json の start スクリプト確認

`package.json` の `scripts.start` が `bun dist/cli.js` であることを確認。
`node` になっている場合は ERROR（`bun:sqlite` が動作しない）。

### 6. .gitignore 検証

以下のエントリが `.gitignore` に含まれていることを確認:

- `deploy/windows/winsw/*.exe`（WinSW バイナリ）
- `deploy/windows/winsw/log-dot-print-service.xml`（生成された XML）
- `logs/`（ランタイムログ）
- `data/`（ランタイムデータ）

## 出力フォーマット

```
=== Deploy Check Results ===

[PASS] Build artifacts: dist/cli.js (42.3 KB), dist/ui/ (3 files)
[PASS] config.json: valid (port=3000, printer=native)
[PASS] WinSW template: placeholders intact
[PASS] PowerShell scripts: 13/13 present
[PASS] package.json start: "bun dist/cli.js"
[PASS] .gitignore: all deploy entries present

Result: READY FOR DEPLOY
```

エラーがある場合:

```
[FAIL] Build artifacts: dist/cli.js not found — run `bun run build` first
[WARN] config.json: not found — copy from config.example.json

Result: NOT READY (1 error, 1 warning)
```

## 実行方法

ユーザーが `/deploy-check` を実行すると、上記の検証を順番に実行して結果を報告する。
ファイルの修正は行わず、問題がある場合は具体的な修正手順を提示する。
