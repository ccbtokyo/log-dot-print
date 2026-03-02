---
name: codex-review-loop
description: |
  コード変更後に検証 → codex review → 修正の改善ループを回す。
  テスト・ビルド・リントを通してから codex review --uncommitted で外部レビューを受け、
  P1/P2 指摘を修正して再検証するサイクルをクリーンになるまで繰り返す。
  "codex review", "review loop", "pre-commit review", "コミット前レビュー" で発動。
---

# Codex Review 改善ループ

コード変更完了後、コミット前に外部レビューを含む検証ループを回して品質を担保する。

## 前提条件

- コードの変更（新規ファイル作成・既存ファイル編集）が完了していること
- `codex` CLI がインストールされていること

## ループフロー

```
コード変更完了
     │
     ▼
┌─── 検証フェーズ ───┐
│ test → build →     │
│ lint → format      │
└────────┬───────────┘
         │ 全て通過
         ▼
┌─── Codex Review ───┐
│ codex review       │
│ --uncommitted      │
└────────┬───────────┘
         │
    ┌────┴────┐
    │         │
 P1/P2     P3以下
 指摘あり   or クリーン
    │         │
    ▼         ▼
  修正      コミット可
    │
    └──→ 検証フェーズに戻る
```

## 実行手順

### Step 1: プロジェクト検証

プロジェクトの CLAUDE.md / AGENTS.md に記載された検証コマンドを順番に実行する。

典型的なコマンド例:

```bash
# bun プロジェクト
bun test && bun run build && bun run lint && bun run format

# npm プロジェクト
npm test && npm run build && npm run lint

# その他（CLAUDE.md を参照して適切なコマンドを使う）
```

いずれかが失敗した場合は修正して再度すべてを実行する。

### Step 2: Codex Review 実行

検証が全て通過したら外部レビューを実行:

```bash
codex review --uncommitted
```

- timeout は 30 分（`1800000` ms）に設定すること
- レビュー完了まで待機する

### Step 3: レビュー結果の判定と対応

| 優先度              | 対応                           |
| ------------------- | ------------------------------ |
| **P1** (Critical)   | 必ず修正。修正後 Step 1 に戻る |
| **P2** (Important)  | 必ず修正。修正後 Step 1 に戻る |
| **P3** (Minor)      | 報告のみ。コミットを妨げない   |
| **P4/P5** (Trivial) | 無視してよい                   |

### Step 4: コミット

P1/P2 の指摘がすべて解消されたらコミット可能。

## ループ回数の上限

無限ループを防ぐため、ループは **最大 3 回** までとする。
3 回目の codex review でまだ P1/P2 が残る場合は、残存指摘を一覧としてユーザーに報告し判断を仰ぐ。

## 注意事項

- 検証コマンドはプロジェクトごとに異なる。CLAUDE.md / AGENTS.md を参照して正しいコマンドを使う
- codex review は外部プロセスなので十分な timeout を設定する
- P3 以下の指摘でもユーザーが修正を希望する場合は対応する
- フォーマッターが自動整形する場合、format 後の差分も検証対象に含まれる
