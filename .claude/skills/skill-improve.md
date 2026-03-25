---
description: |
  スキルの振り返り・改善を実行する。「スキルを改善して」「スキルの振り返り」
  「skill review」「improve skill」「スキルを見直して」等で起動。
  cogmem skills review → skill-creator 連携の一発オーケストレーション。
---

# /skill-improve — スキル振り返り・改善ループ

## 概要

cogmem の学習データと skill-creator の品質保証を組み合わせた、
スキルの振り返り・改善ワークフロー。

## 手順

### Step 1: 現状レビュー

```bash
cd /Users/akira/workspace/open-claude && cogmem skills review --json
```

結果をユーザーに報告:
- 各スキルの健康状態（healthy / needs_attention / critical / new）
- トレンド（improving / stable / declining）
- 改善推奨があるスキル

### Step 2: 改善対象の確認

推奨がある場合、ユーザーに確認:
- 「[スキル名] の effectiveness が低い（X.XX）。改善する？」
- 未カバーパターンがある場合: 「[パターン] が N 回繰り返されてるけど、スキル化する？」
- ユーザーが対象を指定した場合はそれに従う

推奨がない場合: 「全スキル健全。特定のスキルを改善したい場合は名前を指定して」

### Step 3: 改善実行

対象が決まったら:

**既存スキルの改善:**
1. `/skill-creator` を起動して対象スキルの eval → 改善ループを実行
2. 改善完了後に結果を取り込む:
   ```bash
   cd /Users/akira/workspace/open-claude && cogmem skills ingest \
     --benchmark <workspace-path> --skill-name <skill-name>
   ```

**新規スキルの作成:**
1. `/skill-creator` を起動して新規スキルを作成
2. 作成完了後に cogmem に登録:
   ```bash
   cd /Users/akira/workspace/open-claude && cogmem skills import .claude/skills/
   ```

### Step 4: 結果確認

```bash
cd /Users/akira/workspace/open-claude && cogmem skills review
```

改善前後の effectiveness を比較して報告。

### Step 5: 学習記録

```bash
cd /Users/akira/workspace/open-claude && cogmem skills learn \
  --context "スキル改善: <対象スキル名>" \
  --effectiveness <改善後の値> \
  --user-satisfaction <ユーザー満足度>
```
