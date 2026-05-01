# Insights

## INS-001: Irodori LoRA は信号品質でGPT-SoVITSより優位
- **発生**: 2026-04-07 Session 6
- **ドメイン**: TTS / 音声品質
- **内容**: Irodori LoRA (SNR 32.0dB, Crest Factor 18.5dB) vs GPT-SoVITS (SNR 30.5dB, Crest Factor 20.0dB)。感情的テキストでGPT-SoVITSのSNRが低下する傾向
- **確信度**: Established（波形分析で実測）

## INS-002: Veo APIの正しい使い方
- **発生**: 2026-04-07 Session 8
- **ドメイン**: AI動画生成
- **内容**: Veo は `predictLongRunning` API を使う（`generateContent` ではない）。同時3リクエスト制限。base64はPython urllibで直接送信（curlの引数長制限回避）。`imageDimension` パラメータは非サポート
- **確信度**: Established（実装・動作確認済み）

## INS-003: TTS品質チェックの自動化基準
- **発生**: 2026-04-07 Session 7
- **ドメイン**: TTS / QA
- **内容**: テキスト30文字以上に対して音声3秒未満 or 50KB未満は異常と判定。`TTSQualityError` で自動検知→通知が有効
- **確信度**: Established（実装・運用中）

## INS-004: Irodori TTS高速化の実績値
- **発生**: 2026-04-05 Session 1-3
- **ドメイン**: TTS / パフォーマンス
- **内容**: codec_device CPU→MPS + num_steps 40→10 で 10.5秒→2.3秒（4.5倍高速化）。num_steps 10 で品質は十分。ただしLoRA使用時は num_steps 30+ 推奨
- **確信度**: Established（実測済み）

## INS-005: AI生成動画のキャラクター一貫性
- **発生**: 2026-04-07 Session 8
- **ドメイン**: AI動画生成
- **内容**: Gemini画像生成で参照画像を渡すとキャラクター一貫性が向上するが完璧ではない。シーン間での一貫性は今後の課題
- **確信度**: Hypothesis（初回実験のみ）

## INS-006: LLM フォールバック設計方針
- **発生**: 2026-04-11
- **ドメイン**: LLM / 可用性
- **内容**: Claude API 障害時のフォールバックは ChatGPT OAuth（`/gpt` スキル経由）を使う。ローカルモデル（Ollama）はフォールバックに使わない（品質差が大きくUX劣化）
- **確信度**: Established（`/gpt` スキル運用中）

## INS-007: スキル設計のユーザー固有値分離パターン
- **発生**: 2026-04-13
- **ドメイン**: スキル設計
- **内容**: スキル内のユーザー固有値（パス・ID・閾値）は冒頭の設定テーブルに集約し本文から分離する。他ユーザー利用時は設定テーブルのみ変更すればよい。改善履歴は `/tmp/*_history.jsonl` に最大件数FIFOで蓄積し、過去試行パターン全体を参照して改善案を生成する
- **確信度**: Established（co-view-improve で確立）

## INS-008: テストの副作用は外部プロセス起動も含む
- **発生**: 2026-04-19
- **ドメイン**: テスト設計 / CI
- **内容**: `fetch` / DB / ファイルIO のモックだけではテスト隔離は不十分。`child_process.exec` / `spawn` / `open` 経由で OS リソース（ブラウザ・別プロセス）を起動する関数は、それらも同時にモックしないとテスト実行が副作用を撒き散らす（開発者の環境で意図しないアプリが勝手に立ち上がる等）
- **確信度**: Established（`chatgpt-auth.test.ts` の Chrome 誤起動インシデントで確認）

## INS-009: 独立経路を持つシステムは全経路を計測する
- **発生**: 2026-04-19
- **ドメイン**: 観測設計 / 改善ループ
- **内容**: 音声入力系は ambient listener / wake word / 会話モードなど複数の独立経路に分岐する。改善ループや KPI ダッシュボードの計測を 1 経路に限定すると、同種の誤検知を他経路で見逃す。計測は「経路ごとに Detected / Blocked / Passed-through / Acted の件数」を並べる 2D マトリクスで設計する
- **確信度**: Established（/co-view-improve 1-D2 追加で対応）

## INS-010: 非同期リソース解放は delay + watchdog で安定化
- **発生**: 2026-04-19
- **ドメイン**: WebAudio / ストリーム管理
- **内容**: `destroy()` 直後に `new` を走らせる実装は WebAudio / MediaStream の非同期解放レースで失敗する。（1）destroy → 短い delay (300ms程度) → start の `restart()` パターンと（2）一定間隔でハートビートを監視する watchdog のペアで根治する。片方だけでは「初回は動くがまれに止まる」症状が残る
- **確信度**: Established（Always-On Listener の 3 日連続 silent fail を根治）

## INS-011: Slack 一時ファイルURLの有効期限切れ
- **発生**: 2026-04-21（mei bot が同日中に 2 回連続で遭遇）
- **ドメイン**: Slack Bot / ファイル処理
- **内容**: ユーザーが画像を先にアップロードし、しばらく経ってから「カレンダー登録して」のような後続コマンドで参照すると、Slack の `files.*` URL が期限切れで取得できず、bot が「画像ファイルがもう消えてしまってる」と応答する現象が発生する。対策はメッセージ受信イベントの時点で即座にダウンロードしてローカルにキャッシュし、後続コマンドは保存済みパスを参照する設計。`file-handler.ts` の処理タイミングを後続 prompt 評価ではなく upload event に前倒しする必要あり
- **確信度**: Hypothesis（根本改修は未実施。現状は「再送してください」と返している）

## INS-012: MCP コネクタは API カバレッジを事前確認
- **発生**: 2026-04-24
- **ドメイン**: MCP / リモート移行
- **内容**: claude.ai の MCP コネクタは元 SaaS の機能をフルカバーしていない。例: Gmail コネクタには添付ファイルバイナリ取得 API がなく、`get_thread` の FULL_CONTENT もテキスト本文のみ。Drive コネクタは write 可能だが、原 OAuth スコープに比べると操作が限定的。/schedule リモート移行の可否を判断する前に、必ず ToolSearch でコネクタが提供するツール一覧を確認し、必要な操作（特に write / バイナリ取得）が揃っているか検証する
- **確信度**: Established（gmail-to-drive 移行検討で確認）

## INS-013: claude.ai Slack コネクタの制約
- **発生**: 2026-04-24
- **ドメイン**: Slack / リモート routine
- **内容**: claude.ai Slack コネクタの `slack_send_message` は (1) markdown 限定（attachments / blocks 非対応、Tech News のカラーバー再現不可）、(2) user 名義でのみ投稿可（bot identity 不可）、(3) セルフDM (自分→自分) は Slack 仕様で通知が飛ばない。bot identity 維持や attachments デザインが必要なら Slack Incoming Webhook + Bash curl にフォールバックする。通知が必要なら必ず channel + 明示的 `<@user_id>` メンション
- **確信度**: Established（ir-news-check / daily-arxiv-digest 移行で確認）

## INS-014: Claude は長文 Slack を自発的にスレッド分割する
- **発生**: 2026-04-24
- **ドメイン**: プロンプト設計 / Slack 投稿
- **内容**: Claude (Sonnet 4.6) は `slack_send_message` で長文を投稿する際、明示指示が無いと自発的に親メッセージ＋スレッド返信に分割してしまう（thread_ts を勝手に付ける）。チャンネルメイン投稿を強制したい場合は「`thread_ts` パラメータは絶対に指定しない。スレッド返信厳禁。文字数オーバー時は複数メイン投稿に分割」とプロンプトで明示する必要がある
- **確信度**: Established（daily-arxiv-digest で2回再現確認）

## INS-015: Inner Thoughts schema は prompt example の提示で即座に充填される
- **発生**: 2026-04-26（#1 完了直後の Eve / Mei 実発火 6 件中 6 件で `inner_thought` 100% 充填）
- **ドメイン**: LLM プロンプト設計 / proactive bot
- **内容**: Inner Thoughts paper (arxiv 2501.00383) の `inner_thought` / `plan` (3 案) / `generate_score` / `evaluate_score` は、JSON 出力例にダミー値付きで明示するだけで bot が自然に生成する。事前に内省フィールドを書く設計は decisionReason の事後説明型より一段階抽象が高く、Anthropic Plan-Generate-Evaluate と直接統合可能。observation-only モードで shadow データを蓄積するのが rebuild 判断の核データになる
- **確信度**: Established（実発火 100% 充填、設計フィードバックループも稼働開始）

## INS-016: ファイルパス定数モジュールは env override + lazy resolve を最初から仕込む
- **発生**: 2026-04-26（reminiscence-notes.test.ts 初版が production data ファイルを上書き）
- **ドメイン**: テスト隔離 / モジュール設計
- **内容**: `const NOTES_FILE = join(process.cwd(), '...')` のようにモジュール load 時に確定させると、テスト環境変数を beforeAll で設定しても遅すぎる。最初から `function notesFilePath() { return process.env.X || ... }` で call 時 lazy 評価、env override 経路を仕込んでおく。新規モジュール作成時のチェックリスト項目化
- **確信度**: Established（同パターンの既存モジュール shared-proactive-history.ts も同じ穴あり、要 retrofit 候補）
