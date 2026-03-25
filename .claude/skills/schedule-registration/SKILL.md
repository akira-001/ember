---
description: カレンダー予定の登録・取得。画像からの読み取り、gcalcliでの登録・検証を含む。「予定登録して」「今日の予定は？」「カレンダーに入れて」等で発動。
---

# スケジュール登録スキル

## ツール

- gcalcli（カレンダーMCPは使わない）
- カレンダー名: `Akira_public`

## 手順

### Step 0: 日付確定

```bash
date "+%Y-%m-%d %A"
```

この結果を「今日の日付」として以降の全ステップで使う。システムプロンプトの日付や思い込みに頼らない。

### Step 1: 予定の読み取り

- 画像が添付されている場合: Read ツールで画像を読み取り、予定を抽出する
- テキストで指示された場合: そのまま使う
- 対象日を YYYY-MM-DD 形式で明示する（「明日」「金曜」等の相対表現は Step 0 の日付から算出して YYYY-MM-DD に変換）
- 昼食・夕食も含めて全て抽出する

### Step 2: 登録

```bash
gcalcli add --calendar "Akira_public" \
  --title "<タイトル>" \
  --when "YYYY-MM-DD HH:MM" \
  --duration <分> \
  --noprompt
```

- `--when` には必ず YYYY-MM-DD を含める（相対表現禁止）
- 昼食・夕食は duration 60 で登録
- 場所がある場合は `--where` を追加
- 2分前リマインダー: `--reminder 2`

### Step 3: 検証と報告

登録後、agenda で取得して検証する:

```bash
gcalcli agenda "YYYY-MM-DD" "YYYY-MM-DD+1" --calendar "Akira_public" --nodeclined
```

- 出力の日付ヘッダー（「木 3月26日」等）が対象日と一致するか必ず確認する
- 一致しない場合はユーザーに報告する
- 登録件数と内容をユーザーに報告する

## 予定取得（「今日の予定は？」等）

1. Step 0 で今日の日付を確定
2. `gcalcli agenda "YYYY-MM-DD" "YYYY-MM-DD+1" --calendar "Akira_public" --nodeclined` で取得
3. 出力の日付ヘッダーが指定日と一致するか検証
4. 一致しない場合はユーザーに報告（「昨日の予定を今日と間違える」防止）

## ルール

- 相対日付表現（tomorrow, 明日等）は `--when` に使わない。必ず YYYY-MM-DD
- gcalcli agenda 実行時は必ず start/end を YYYY-MM-DD 形式で明示指定
- 出力の日付ヘッダーを必ず検証する
- 既存予定との競合がある場合はユーザーに確認する
- 不明な項目は推測せずユーザーに確認する
