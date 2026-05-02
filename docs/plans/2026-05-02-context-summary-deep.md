# Phase G2/G3+H 統合実装プラン

**作成日**: 2026-05-02  
**担当**: architect-2  
**対象ファイル主軸**: `packages/voice-chat/app.py`, `ambient_listener.py`, `ambient_policy.py`

---

## 全フェーズ依存関係

```
G2 ──┐
     ├──> G3 ──> H2 ──> H3 ──> H4
H1 ──┘         (独立 ship 可能)
```

- **G2** と **H1** は独立して ship 可能
- **G3** は G2 完了後が望ましい（G2 で activity=video_watching が正確に立つ前提）
- **H2** は G3 完了後に注入対象を安全に拡大できる（confidence の信頼性が上がってから）
- **H3/H4** は H2 の context_hint 拡大後に効果が出る（meeting/mood が LLM に届いてから）

---

## Phase G2 — 動画/メディア源シグナル統合

### 概要

**Why**: `_build_context_summary` は transcript のみを見るため、動画再生中でも発話パターンが「チャット」や「作業」に見え、`activity=chatting` と誤分類する。`_infer_media_content`（co_view）では `content_type=video_watching` を正確に判定しているが、その情報が context_summary に反映されない。

**What**: `_media_ctx.inferred_type` を `_build_context_summary` のプロンプトヒントとして注入し、LLM が activity を正確に推定できるようにする。

### 現状の問題

```
_media_ctx.inferred_type  →  co_view ループ（app.py:1743〜）が推定
_context_summary.activity →  _build_context_summary（app.py:1389〜）が 独立推定

  → 双方向に情報が流れていない
```

`_infer_media_content` は `context_hint = _context_summary.to_prompt_block()` を受け取る（app.py:1777）が、逆方向（co_view → context_summary）の流れは存在しない。

### 提案する変更

**対象**: `_build_context_summary` のプロンプト（app.py:1392〜1421）

```python
# Before (app.py:1389)
async def _build_context_summary(transcript: str) -> dict:
    messages = [
        {"role": "system", "content": (
            "あなたはユーザーの状況を観察する解析者です。\n"
            # ... activity の判定ヒント（media シグナルなし）
        )},
        {"role": "user", "content": f"直近30分の transcript:\n{transcript}"},
    ]

# After
async def _build_context_summary(transcript: str) -> dict:
    # co_view からのメディアシグナルを補助ヒントとして取得
    media_hint = ""
    if (_media_ctx.inferred_type not in ("unknown", "")
            and time.time() - _media_ctx.last_inferred_at < 600):
        media_hint = (
            f"\n\n[co_view シグナル] 直近の推定コンテンツ種別: {_media_ctx.inferred_type}"
            f"（信頼度 {_media_ctx.confidence:.2f}）"
            "\n※ transcript の発話量が少なくとも、このシグナルがある場合は activity を video_watching 等に補正してよい"
        )
    messages = [
        {"role": "system", "content": (
            "... 既存プロンプト ..."
            f"{media_hint}"
        )},
        {"role": "user", "content": f"直近30分の transcript:\n{transcript}"},
    ]
```

### 変更ファイル一覧

| ファイル | 変更箇所 |
|---|---|
| `app.py` | `_build_context_summary` プロンプト（app.py:1392〜1421） |

### 実装ステップ

1. `_build_context_summary` の呼び出し前に `_media_ctx` のシグナル鮮度チェック条件を確認
2. `media_hint` 文字列生成ロジックを `_build_context_summary` の先頭に追加
3. system_prompt 末尾の「判定ヒント」ブロックに `{media_hint}` を差し込む
4. `activity` の許容値リストに `video_watching` が入っているか確認（現行 JSON スキーマ: app.py:1397）
5. ログに `[context_summary] media_hint injected: type=...` を追加して注入確認できるようにする

### テスト戦略

- 手動: co_view が `youtube_talk` / `anime` を返している状態で `_build_context_summary` を強制呼び出しし、activity=video_watching になるか確認
- 既存テストへの影響: `_build_context_summary` の JSON parse ロジックは変化しないため既存テストは保護される

### リスク + 緩和策

| リスク | 緩和策 |
|---|---|
| co_view が誤分類（例: 会議中に youtube_talk）→ context_summary も汚染 | TTL チェック（600s 以内）＋ confidence < 0.5 なら hint を出さない |
| media_hint が transcript と矛盾 → LLM が混乱 | プロンプトに「transcript の発話内容が優先。矛盾する場合は transcript を信じる」を明記 |

### 推定工数

**半日**（実装 1h + ログ確認 1h）

---

## Phase G3 — confidence キャリブレーション

### 概要

**Why**: 短い transcript（2件）でも `confidence=0.9` を返すため、証拠が薄いコンテキストが高信頼度として扱われ、TTS プロンプトや H2 拡張への誤注入リスクが高い。

**What**: プロンプトに「証拠量・曖昧性に応じた厳格な confidence 指示」を追加し、さらに後処理で transcript 文字数と evidence_snippets 数による discount を適用する。

### 現状の問題

```python
# app.py:1403〜1408
'"confidence": 0.0から1.0,\n'
'"evidence_snippets": ["transcript からの根拠抜粋 1〜3件"],\n'
```

プロンプトに confidence の低め設定ガイドラインがなく、gemma4 はデフォルトで楽観的な値を返す傾向がある。

### 提案する変更

**対象 1**: `_build_context_summary` のプロンプト（app.py:1410〜1418 判定ヒントブロック末尾）

```python
# 追加する判定ヒント
"- confidence キャリブレーション基準:\n"
"  * transcript が 3 文以下 → confidence <= 0.5\n"
"  * transcript が 1 文以下または全体 100 文字未満 → confidence <= 0.3\n"
"  * 複数の根拠（keywords/topics/is_meeting）が揃っている → 0.7〜0.9\n"
"  * 曖昧・一般的な発話のみ → confidence <= 0.5\n"
"  * evidence_snippets を 1 件も抽出できない → confidence <= 0.3\n"
```

**対象 2**: `_build_context_summary` の後処理（app.py:1435 の confidence 設定後）

```python
# After: 後処理 discount
raw_confidence = float(result.get("confidence") or 0.0)
# 証拠量に基づく discount
transcript_chars = len(transcript)
evidence_count = len(result.get("evidence_snippets") or [])
if transcript_chars < 100 or evidence_count == 0:
    raw_confidence = min(raw_confidence, 0.3)
elif transcript_chars < 300 or evidence_count == 1:
    raw_confidence = min(raw_confidence, 0.55)
_context_summary.confidence = raw_confidence
```

### 変更ファイル一覧

| ファイル | 変更箇所 |
|---|---|
| `app.py` | `_build_context_summary` プロンプト判定ヒントブロック + 後処理 discount（app.py:1410〜1460） |

### 実装ステップ

1. プロンプト末尾の「判定ヒント」ブロックに confidence キャリブレーション基準テキストを追加
2. `_context_summary.confidence = float(...)` の直前に `transcript_chars` / `evidence_count` を計算
3. discount ロジックを実装し `raw_confidence` を上書き
4. ログに `[context_summary] conf_discount: raw={raw_confidence:.2f} → {_context_summary.confidence:.2f}` を追加
5. `CONTEXT_SUMMARY_MIN_CONF = 0.3` との整合性確認（discount 後 0.3 以下になった場合は `to_prompt_block` が空を返すため問題なし）

### テスト戦略

- 短い transcript（1〜2 件）で `_build_context_summary` を呼び出し、confidence が discount されることを確認
- `CONTEXT_SUMMARY_MIN_CONF` 境界値テスト: confidence=0.29 で `to_prompt_block` が空文字を返すことを確認

### リスク + 緩和策

| リスク | 緩和策 |
|---|---|
| discount が強すぎて通常の推定も低くなる | discount は上限のみ（`min` 適用）なので上方は変えない |
| プロンプト変更で他フィールド（activity等）の精度が下がる | プロンプト末尾への追記のみ。既存の判定ヒントブロック構造は変えない |

### 推定工数

**半日**（実装 2h）

---

## Phase H1 — TTS パラメータ動的調整

### 概要

**Why**: `synthesize_speech_voicevox`（app.py:3967）は `speedScale` のみ書き込み、`intonationScale` / `pitchScale` / `volumeScale` は audio_query のデフォルト値のまま。mood/time_context を反映すると表現力が上がる。

**What**: `_context_summary.mood` と `_context_summary.time_context` に応じて VOICEVOX audio_query のパラメータを動的に調整する。

### 現状の問題

```python
# app.py:3967〜3984
async def synthesize_speech_voicevox(text: str, speaker_id: int, speed: float = 1.0) -> bytes:
    query = resp.json()
    query["speedScale"] = speed          # ← ここしか触っていない
    # intonationScale, pitchScale, volumeScale は VOICEVOX デフォルト
```

### パラメータマッピング表

| mood / time_context | speedScale 調整 | intonationScale | pitchScale |
|---|---|---|---|
| mood=excited | +0.05 | 1.2 | +0.03 |
| mood=stressed | -0.05 | 0.9 | -0.02 |
| mood=calm | ±0 | 1.0 | ±0 |
| mood=focused | -0.03 | 0.95 | ±0 |
| time_context=night | -0.08 | 0.85 | -0.03 |
| time_context=morning | +0.03 | 1.05 | ±0 |

※ 調整値は加算（base は audio_query のデフォルト値に対して）。複数条件は加算して clamp。

### 提案する変更

**対象**: `synthesize_speech_voicevox`（app.py:3967）に `mood` / `time_context` 引数を追加。  
**対象**: `synthesize_speech`（app.py:3908）から `_context_summary` 参照を経由して渡す。

```python
# app.py:3967 after
async def synthesize_speech_voicevox(
    text: str, speaker_id: int, speed: float = 1.0,
    mood: str = "", time_context: str = ""
) -> bytes:
    query = resp.json()
    query["speedScale"] = speed

    # Mood/time_context による動的調整
    speed_delta = 0.0
    intonation = query.get("intonationScale", 1.0)
    pitch = query.get("pitchScale", 0.0)

    if mood == "excited":
        speed_delta += 0.05; intonation = min(1.5, intonation * 1.2); pitch += 0.03
    elif mood == "stressed":
        speed_delta -= 0.05; intonation = max(0.5, intonation * 0.9); pitch -= 0.02
    elif mood == "focused":
        speed_delta -= 0.03; intonation = max(0.5, intonation * 0.95)
    if time_context == "night":
        speed_delta -= 0.08; intonation = max(0.5, intonation * 0.85); pitch -= 0.03
    elif time_context == "morning":
        speed_delta += 0.03; intonation = min(1.5, intonation * 1.05)

    if speed_delta != 0.0:
        query["speedScale"] = max(0.5, min(2.0, speed + speed_delta))
    query["intonationScale"] = intonation
    query["pitchScale"] = pitch
```

**注意**: WakeResponseCache（`wake_response.py:31`）のウォームアップ時は mood/time_context 不明のためデフォルト値を使う。TTS キャッシュキーに `mood:time_context` を含める必要がある（app.py:3918 の `cache_key`）。

### 変更ファイル一覧

| ファイル | 変更箇所 |
|---|---|
| `app.py` | `synthesize_speech_voicevox`（引数追加 + パラメータ調整ロジック） |
| `app.py` | `synthesize_speech` から voicevox 呼び出し時に mood/time_context を渡す |
| `app.py` | `cache_key` 生成に mood/time_context を含める（app.py:3918） |

### 実装ステップ

1. `synthesize_speech_voicevox` に `mood` / `time_context` 引数を追加（デフォルト空文字）
2. audio_query 取得後のパラメータ調整ブロックを実装
3. `synthesize_speech`（app.py:3908）の voicevox 分岐で `_context_summary.mood` / `time_context` を渡す
4. `cache_key` に `mood:time_context` サフィックスを追加
5. WakeResponseCache の warmup 呼び出し（app.py:3848〜）は引数変化なしのため影響なし
6. ログに調整値を出力: `[TTS] mood={mood} time={time_context} speed_delta={speed_delta:+.2f} intonation={intonation:.2f}`

### テスト戦略

- `_context_summary.mood = "excited"` でチャット応答を生成し、speedScale の変化を `synthesize_speech_voicevox` のログで確認
- TTS キャッシュが mood 変化で無効化されることを確認

### リスク + 緩和策

| リスク | 緩和策 |
|---|---|
| pitchScale の値域が VOICEVOX スピーカーによって異なる | clamp 実装（speed: 0.5〜2.0, intonation: 0.5〜1.5, pitch: -0.15〜0.15） |
| TTS キャッシュが細分化されてヒット率低下 | mood/time_context が空のキャッシュと有値のキャッシュを分けるだけなので影響軽微 |

### 推定工数

**1日**（実装 3h + キャッシュキー設計確認 1h + 動作確認 2h）

---

## Phase H2 — system_prompt 注入の対象拡大

### 概要

**Why**: `to_prompt_block` は `_infer_media_content` にしか注入されていない（app.py:1777）。チャット応答・soliloquy・ambient バッチ判定にも注入すれば、LLM がユーザーの現状を把握した上で回答できる。

**What**: `_context_summary.to_prompt_block()` の注入先を拡大する。

### 現在の注入箇所

```
_infer_media_content (app.py:1777)  ← 唯一の注入先
```

### 拡大対象と優先順位

| 優先度 | 対象 | 場所 | 効果 |
|---|---|---|---|
| 高 | チャット応答 system_prompt | app.py:3231〜 | 会議中/動画視聴中を把握した上での回答 |
| 高 | ambient バッチ判定プロンプト | app.py 内 ambient LLM 呼び出し | activity=meeting 時の発火抑制（H3 前段） |
| 中 | soliloquy プロンプト | app.py:6378〜 | 時間帯/mood を反映した独り言 |
| 低 | proactive TTS の前処理 | app.py:6792 | 夜間のみ（H4 で別途制御） |

### 提案する変更

**対象 1**: チャット応答 system_prompt（app.py:3231）

```python
# 既存の system_prompt 構築の末尾に追加
context_hint = _context_summary.to_prompt_block()
if context_hint:
    system_prompt += context_hint
```

**対象 2**: soliloquy system_prompt（app.py:6378）

```python
# user_prompt の生成前に context_hint を追加
context_hint = _context_summary.to_prompt_block()
user_prompt = f"現在 {time_str} {weekday_jp}曜日{context_part}"
if context_hint:
    user_prompt += f"\n{context_hint}"
```

### 変更ファイル一覧

| ファイル | 変更箇所 |
|---|---|
| `app.py` | チャット応答 system_prompt 末尾（app.py:3231〜3500 の構築ブロック末尾） |
| `app.py` | `_generate_soliloquy` の user_prompt（app.py:6396） |

### 実装ステップ

1. チャット応答の system_prompt 構築末尾（app.py の co_view system_prompt 組み立て完了後）に `context_hint` を追加
2. soliloquy の `user_prompt` に `context_hint` を追加
3. ambient バッチ判定の LLM プロンプトを grep で特定し同様に追加
4. 各追加箇所でログを出力（`[H2] context_hint injected to {target}`）
5. `CONTEXT_SUMMARY_MIN_CONF` 未満の場合は `to_prompt_block` が空文字を返すため、if ガードは不要（既存実装が安全）

### テスト戦略

- `_context_summary.activity = "meeting"` 状態でチャットを送り、system_prompt に「会議モード」が含まれることをログで確認
- confidence が低い状態（< 0.3）で注入されないことを確認

### リスク + 緩和策

| リスク | 緩和策 |
|---|---|
| プロンプト長増大でレイテンシ悪化 | `to_prompt_block` は最大 10 行程度（〜300 トークン）。gemma4 は 8k context で余裕あり |
| 古いコンテキスト（10分前更新）が誤注入 | `is_stale(600s)` が既に実装済み。追加の保護不要 |

### 推定工数

**半日**（実装 2h）

---

## Phase H3 — Ambient 静粛ルール

### 概要

**Why**: `is_meeting=true` または `activity=idle` の状態で ambient が発火するのは不適切。会議の妨害や静かな時間への割り込みになる。

**What**: ambient バッチ判定の前段に context_summary チェックを入れ、meeting/idle 時はバッチをスキップする。

### 現状の問題

`AmbientListener.effective_reactivity`（ambient_listener.py:115）は reactivity レベルのみを管理し、context_summary との連携がない。

### 提案する変更

**対象**: ambient バッチ判定を呼び出す app.py 内のループ（grep で特定: ambient LLM batch）

```python
# ambient バッチ判定の前段に追加
# H3: meeting 中 or idle 中は ambient 発火を抑制
_cs = _context_summary
_cs_active = (
    not _cs.is_stale()
    and _cs.confidence >= CONTEXT_SUMMARY_MIN_CONF
)
if _cs_active:
    if _cs.is_meeting and _cs.confidence >= 0.6:
        logger.info(f"[H3] ambient skip: is_meeting=True (conf={_cs.confidence:.2f})")
        continue  # or return
    if _cs.activity == "idle" and _cs.confidence >= 0.5:
        logger.info(f"[H3] ambient skip: activity=idle (conf={_cs.confidence:.2f})")
        continue
```

**重要な設計判断**: `is_meeting=true` の短時間誤判定で会話が遮断されるリスクがあるため、confidence 閾値（0.6）を設ける。G3 で confidence が適切にキャリブレーションされた後に H3 が最大効果を発揮する。

### 変更ファイル一覧

| ファイル | 変更箇所 |
|---|---|
| `app.py` | ambient バッチ判定ループの前段 |

### 実装ステップ

1. ambient バッチ判定を呼び出している箇所を grep で特定
2. バッチ開始前に `_context_summary.is_meeting` / `activity` のチェックを追加
3. スキップ時のログを追加（理由・confidence 値を含める）
4. confidence 閾値（0.6 for meeting, 0.5 for idle）は定数化して `AMBIENT_MEETING_SUPPRESS_CONF` / `AMBIENT_IDLE_SUPPRESS_CONF` として定義

### テスト戦略

- `_context_summary.is_meeting = True`, `confidence = 0.7` 状態でバッチが呼ばれないことを確認
- `confidence = 0.4` では抑制されないことを確認（誤判定保護）

### リスク + 緩和策

| リスク | 緩和策 |
|---|---|
| 誤 meeting 判定で長時間 ambient 停止 | confidence 閾値 0.6 以上のみ適用。`is_stale` チェックで 10 分以上古い要約は無視 |
| ambient_listener 自体の reactivity=1 設定と二重抑制 | 問題なし。既存の reactivity=1 は発火しない設計のため二重抑制でも副作用なし |

### 推定工数

**半日**（実装 2h）

---

## Phase H4 — Proactive Timing 最適化

### 概要

**Why**: proactive ポーリング（app.py:6755〜）は時間帯・mood・最終 intervention 経過を考慮せず、夜間や集中作業中でも Slack メッセージをそのまま読み上げる。

**What**: `time_context` / `mood` / 最終発話からの経過時間を組み合わせたゲートを proactive ループに追加する。

### 現状

```python
# app.py:6755〜6825
async def _proactive_polling_loop():
    while True:
        await asyncio.sleep(10)
        if not _settings.get("proactiveEnabled"):
            continue
        # ← ここに context_summary チェックがない
        for bot_id in ["mei", "eve"]:
            ...
```

### 提案するゲートロジック

```python
# _proactive_polling_loop 内、bot_id ループの前に追加
_cs = _context_summary
_cs_valid = not _cs.is_stale() and _cs.confidence >= CONTEXT_SUMMARY_MIN_CONF

if _cs_valid:
    # 夜間は proactive を抑制
    if _cs.time_context == "night":
        logger.debug("[H4] proactive suppressed: time_context=night")
        continue
    # 集中作業中は proactive 間隔を延ばす（20分以内に発火済みならスキップ）
    if _cs.mood == "focused":
        last_proactive = _proactive_last_at  # 新規グローバル変数
        if time.time() - last_proactive < 1200:  # 20min
            logger.debug(f"[H4] proactive throttled: mood=focused, last={time.time()-last_proactive:.0f}s ago")
            continue
    # ストレス状態では休息提案を優先メッセージに変換（拡張: 将来対応）
    if _cs.mood == "stressed":
        # TODO H4-ext: Slack Bot に「休息提案優先」フラグを送る
        pass
```

### 変更ファイル一覧

| ファイル | 変更箇所 |
|---|---|
| `app.py` | `_proactive_polling_loop`（app.py:6755〜） |
| `app.py` | `_proactive_last_at` グローバル変数の追加と更新箇所 |

### 実装ステップ

1. `_proactive_last_at: float = 0.0` グローバル変数を追加（app.py:5129 付近の他の proactive グローバルと同じ場所）
2. `_proactive_polling_loop` の bot_id ループの前に context_summary ゲートを追加
3. bot_id ループでメッセージを送信したタイミングで `_proactive_last_at = time.time()` を更新
4. night 抑制・focused スロットリングのログを追加
5. `mood=stressed` の休息提案優先は stub 実装（TODO コメントのみ）として残す

### テスト戦略

- `_context_summary.time_context = "night"` で proactive ループが continue することをログで確認
- `mood=focused` かつ前回発火が 10 分前であれば suppress、25 分前ならば通過することを確認

### リスク + 緩和策

| リスク | 緩和策 |
|---|---|
| 夜間に重要な Slack 通知が届かない | `time_context=night` の suppression は proactive TTS のみ。Slack テキスト配信（WS payload 送信）は継続 |
| context_summary が stale の場合にゲートが機能しない | `is_stale()` チェックで stale なら suppress しない（proactive は従来通り） |

### 推定工数

**半日**（実装 2h）

---

## 総工数まとめ

| フェーズ | 工数 | 優先度 | 依存 |
|---|---|---|---|
| G2 メディアシグナル統合 | 半日 | 高 | なし（独立） |
| G3 confidence キャリブレーション | 半日 | 高 | G2 完了後推奨 |
| H1 TTS パラメータ動的調整 | 1日 | 中 | なし（独立） |
| H2 system_prompt 注入拡大 | 半日 | 中 | G3 完了後推奨 |
| H3 Ambient 静粛ルール | 半日 | 高 | G3 + H2 完了後推奨 |
| H4 Proactive Timing 最適化 | 半日 | 中 | G3 完了後推奨 |

**合計**: 約 3.5〜4日

---

## 優先度推奨

**Week 1 優先**: G2 → G3 → H3  
（confidence が正確になってから H3 の meeting 抑制が安全に動く）

**Week 2**: H2 → H4 → H1  
（H2 で LLM に context が渡るようになってから、H4 で timing 制御。H1 は独立だが QA に時間がかかるため後半）

---

## 後方互換性の保証

- `ContextSummary` / `to_prompt_block` のシグネチャは変更しない
- `_build_context_summary` の JSON パース・フィールド代入ロジックは変更しない（プロンプトへの追記と後処理 discount のみ）
- `synthesize_speech` の公開シグネチャは変更しない（`synthesize_speech_voicevox` のみ引数追加）
- Phase D-F+G1 の co_view ループ（`_infer_media_content`〜enrich〜comment 生成）は無変更
