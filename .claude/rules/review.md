---
description: Codex review rule - run external code review before committing
---

# Codex Review ルール

作業完了時、コミット前に `codex review --uncommitted` を実行して外部レビューを受ける。

## いつ実行するか

以下の条件を **すべて** 満たすとき:

1. コードの変更（新規ファイル作成・既存ファイル編集）が完了した
2. `bun test && bun run build && bun run lint && bun run format` が全て通過した
3. まだコミットしていない

## 実行方法

```bash
codex review --uncommitted
```

- timeout: 30 分（`1800000` ms）に設定して実行すること
- レビュー結果に P1/P2 の指摘があれば修正してから再度検証ループを回す
- P3 以下は報告のみでコミットを妨げない
