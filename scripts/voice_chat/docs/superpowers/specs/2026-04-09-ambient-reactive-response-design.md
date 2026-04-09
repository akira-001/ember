# Ambient Reactive Response — Design Spec

## Goal

MEI が周囲の音声（TV、会話、環境音）を聞き取り、文脈に応じて自然に声をかける「同居人」的な振る舞いを実現する。

## Architecture

ハイブリッド判定方式: 軽量キーワード検出（常時）+ 定期 LLM バッチ判定（30秒周期）を組み合わせる。既存の always-on STT パイプライン（Whisper）の "no wake word" 分岐に接続し、新規ファイル `ambient_listener.py` がメインロジックを担う。

## Tech Stack

- Python (FastAPI backend, 既存 app.py に統合)
- Whisper STT (既存)
- Ollama LLM (ローカル推論)
- Irodori TTS (既存)
- Vanilla JS dashboard (既存 index.html に Ambient タブ追加)

---

## 1. ハイブリッド判定

### 1.1 キーワード即応レイヤー

STT テキストに対して regex マッチ。ヒット時は即座に LLM で応答生成。

カテゴリ例:
- 天気系: `天気|雨|晴|台風|気温`
- 食事系: `ご飯|お腹すいた|何食べ`
- 時間系: `何時|遅刻|もう夜`
- 感情系: `疲れた|つまらない|楽しい|すごい`

キーワードリストは `ambient_rules.json` で管理し、ダッシュボードから編集可能。

### 1.2 LLM バッチ判定レイヤー

30秒間の STT テキストをバッファに蓄積し、周期的に LLM へ送信。LLM は「反応すべきか」「何と言うか」を判定する。

LLM プロンプト構成:
```
あなたはMEI。同居人として部屋にいる。
現在のリアクティビティレベル: {level} ({label})
以下は直近30秒間に聞こえた音声テキスト:
---
{buffered_texts}
---
学習済みルール:
{rules}
参考事例:
{few_shot_examples}

判定: 反応する場合は発話内容を返す。しない場合は "SKIP" を返す。
```

レスポンス形式: `SKIP` または発話テキスト（1-2文）

### 1.3 クールダウン

- キーワード即応: 同一キーワードカテゴリは 60秒間再発火しない
- LLM バッチ: 発話後 90秒間は次のバッチ判定をスキップ
- レベルに応じてクールダウンを調整（レベル5は短縮、レベル1は延長）

---

## 2. 5段階リアクティビティ

| Level | 名前 | 挙動 |
|-------|------|------|
| 1 | 静か | LLM バッチ判定 OFF。キーワードもほぼ無視（緊急のみ） |
| 2 | 控えめ | LLM バッチ 120秒周期。キーワードは半数のみ有効 |
| 3 | 普通 | LLM バッチ 30秒周期。全キーワード有効（デフォルト） |
| 4 | 積極的 | LLM バッチ 15秒周期。判定しきい値を下げる |
| 5 | おしゃべり | LLM バッチ 10秒周期。ほぼ全てに反応 |

設定は `settings.json` の `ambient_reactivity` フィールドに保存。ダッシュボードおよび音声コマンドから変更可能。

---

## 3. 学習システム

### 3.1 ルール蓄積（プロンプトチューニング）

ユーザーのフィードバックからルールを生成・蓄積する。

保存先: `ambient_rules.json`
```json
{
  "rules": [
    {
      "id": "r001",
      "text": "食事中は話しかけない",
      "enabled": true,
      "source": "explicit",
      "created_at": "2026-04-09T10:00:00"
    }
  ],
  "keywords": [
    {
      "id": "k001",
      "category": "weather",
      "pattern": "天気|雨|晴|台風",
      "enabled": true
    }
  ]
}
```

### 3.2 Few-shot 事例

良い反応・悪い反応の具体例を保存し、LLM プロンプトに含める。

保存先: `ambient_examples.json`
```json
{
  "examples": [
    {
      "id": "e001",
      "context": "TVで「明日は雨です」と流れている",
      "response": "傘持っていった方がいいかも",
      "rating": "positive",
      "created_at": "2026-04-09T10:00:00"
    }
  ]
}
```

### 3.3 ダッシュボードからの手動追加

ルール・事例ともにダッシュボードの Ambient タブから追加・削除・有効/無効切り替えが可能。

---

## 4. フィードバックループ

### 4.1 暗黙フィードバック

- MEI の発話後にユーザーが無反応 → ネガティブスコア加算
- MEI の発話にユーザーが応答 → ポジティブスコア加算
- スコアは統計として蓄積（即座のルール変更はしない）

### 4.2 明示フィードバック

- 「うるさい」「それはいらない」→ ネガティブルール候補を自動生成
- 「それいいね」「ありがとう」→ 現在の発話を few-shot positive 事例として保存候補に
- ルール候補はダッシュボードに表示し、ユーザーが確認して確定する

---

## 5. 音声コマンドモード制御

STT テキストから検出。wake_detect と同じレイヤー（regex）で最優先判定。

| トリガーワード | 効果 | 持続時間 |
|---|---|---|
| 「静かにして」「黙って」 | 現在レベルから -2（最低1） | 15分 |
| 「うるさい」 | 現在レベルから -1 | 10分 |
| 「もっと話して」「話しかけて」 | 現在レベルから +1（最高5） | 15分 |

- `ambient_mode_override` タイマーを設定。タイマー中は override レベルを使用
- タイマー満了で元のレベルに自動復帰
- 検出時に MEI が短い応答を返す（「わかった、静かにするね」等）

---

## 6. Stop コマンド

「Stop」「やめて」「ストップ」で進行中の応答を即座に中断。

検出優先度: Stop > 音声コマンド > wake word > ambient keyword

処理:
1. `afplay` プロセスを kill（TTS 再生停止）
2. 進行中の LLM リクエストをキャンセル（`AbortController` 相当）
3. `_always_on_conversation_until` をリセット（会話ウィンドウ終了）
4. ambient listener の状態を `listening` に戻す
5. Electron 側: WebSocket で `stop` メッセージ送信 → 再生中 audio 停止

---

## 7. Barge-in 検知

MEI の TTS 再生中にユーザーが話し始めたら、再生を中断して聞く。

仕組み:
- TTS 再生中も VAD は動作し続ける
- 再生中に VAD が発話検出 → `barge_in` イベント発火
- サーバー: クライアントに `stop_audio` WebSocket メッセージ送信
- 検出した発話を通常の always-on パイプラインに流す

エコーキャンセル対策:
- ハードウェア echoCancellation（MediaStream 設定）
- ソフトウェアしきい値: TTS 再生中は RMS threshold を 0.015 → 0.04 に上げる
- RMS が echo_threshold 未満 → エコーとして無視

---

## 8. ダッシュボード可視化

### 8.1 Ambient タブ

既存の `index.html` にタブ切り替えを追加。「Chat」「Ambient」の2タブ構成。

表示内容:
- **現在の状態**: リアクティビティレベル、オーバーライド状態（残り時間）、listener 状態、直近判定
- **リアクティビティ設定**: 5段階ボタンで即座に変更可能
- **判定ログ**: 直近20件のキーワード/LLM判定結果をリアルタイム表示
- **学習ルール一覧**: 有効/無効切り替え、削除、手動追加
- **Few-shot 事例一覧**: 削除、手動追加
- **統計**: 今日の発話数 / 判定数 / 発話率 / フィードバック集計

### 8.2 REST API（新規）

| Method | Endpoint | 用途 |
|--------|----------|------|
| GET | `/api/ambient/rules` | ルール一覧取得 |
| POST | `/api/ambient/rules` | ルール追加 |
| DELETE | `/api/ambient/rules/{id}` | ルール削除 |
| PATCH | `/api/ambient/rules/{id}` | ルール有効/無効切り替え |
| GET | `/api/ambient/examples` | few-shot 事例一覧取得 |
| POST | `/api/ambient/examples` | 事例追加 |
| DELETE | `/api/ambient/examples/{id}` | 事例削除 |
| POST | `/api/ambient/reactivity` | リアクティビティレベル変更 |
| GET | `/api/ambient/stats` | 統計取得 |

### 8.3 WebSocket メッセージ（新規）

```json
// サーバー → クライアント: 状態更新（5秒周期 + 変化時即時）
{
  "type": "ambient_state",
  "data": {
    "reactivity": 3,
    "override": { "level": 1, "remaining_sec": 754, "trigger": "静かにして" },
    "listener_state": "listening",
    "last_judgment": { "ago_sec": 3, "method": "keyword", "result": "skip" }
  }
}

// サーバー → クライアント: 判定ログエントリ（発生時）
{
  "type": "ambient_log",
  "data": {
    "timestamp": "14:23:05",
    "method": "keyword",
    "keyword": "天気",
    "result": "speak",
    "utterance": "今日は晴れるみたいだよ",
    "score": null
  }
}
```

---

## ファイル構成

### 新規作成
- `ambient_listener.py` — メインロジック（判定エンジン、モード管理、barge-in、状態管理）
- `ambient_rules.json` — 学習ルール + キーワード定義
- `ambient_examples.json` — few-shot 事例

### 既存変更
- `app.py` — `_process_always_on()` の "no wake word" 分岐から `ambient_listener` 呼び出し追加。REST API エンドポイント追加。WebSocket メッセージハンドラ追加
- `wake_detect.py` — Stop / モードコマンド用の優先パターン追加
- `index.html` — タブ切り替え UI + Ambient タブ全体の HTML/CSS/JS 追加

---

## やってはいけないこと

| NG | 理由 |
|----|------|
| 外部 API（OpenAI 等）を使う | ローカル Ollama のみ使用 |
| 常時 LLM 判定（毎発話ごと） | GPU 負荷が高すぎる。バッチ周期で制御 |
| ルールをコードにハードコード | ダッシュボードから編集可能にする |
| TTS 再生中に VAD を止める | Barge-in 検知ができなくなる |
| フィードバックから自動でルール確定 | 候補表示 → ユーザー確認のフロー |
