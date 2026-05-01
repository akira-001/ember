# Error Patterns

## EP-001: TTSへの未処理テキスト投入
- **発生**: 2026-04-07 Session 7
- **事象**: URL/絵文字を含むテキストがそのままTTSに渡され、2秒の異常音声を生成
- **根本原因**: テキスト前処理（URL除去、絵文字除去）がなかった
- **対策**: `_clean_text_for_tts()` を `synthesize_speech()` の先頭に追加
- **教訓**: TTSの入力は常にサニタイズする。LLM出力にはURL・絵文字が頻出する
- **出現回数**: 1

## EP-002: GPU並列推論によるTTS品質劣化
- **発生**: 2026-04-05 Session 4
- **事象**: 複数WSクライアントが同時にIrodori TTSへリクエスト → 機械音
- **根本原因**: GPU推論の並列実行で品質が崩壊
- **対策**: `asyncio.Lock` で直列化
- **教訓**: GPU推論系サービスは排他制御が必須
- **出現回数**: 1

## EP-003: FFmpeg concat -c copy で黒画面
- **発生**: 2026-04-07 Session 8
- **事象**: FFmpeg の `-c copy` で結合すると真っ黒動画
- **根本原因**: 異なるエンコード設定の動画をストリームコピーで結合
- **対策**: `libx264 -crf 18` で再エンコード
- **教訓**: AI生成動画のconcat は常に再エンコード
- **出現回数**: 1

## EP-004: 文字列IDのint変換でWS切断
- **発生**: 2026-04-05 Session 1-3
- **事象**: `int("irodori-calm-female")` が ValueError でWebSocket即切断
- **根本原因**: speaker_id が文字列のケースを想定していない（2箇所）
- **対策**: int変換前の型チェック
- **教訓**: 外部入力のint変換は必ずtry-catchまたは事前チェック
- **出現回数**: 1

## EP-005: 設定読み込みのレースコンディション
- **発生**: 2026-04-05 Session 1-3
- **事象**: Voice選択がリロードでデフォルトに戻る
- **根本原因**: `loadSpeakers()` がハードコードデフォルトで初期化後、WebSocket sync が非同期で後から上書き
- **対策**: HTTP同期取得 (`GET /api/settings`) で初期化してからspeakersをロード
- **教訓**: 初期化時の設定読み込みは同期優先。非同期イベントに初期値を依存させない
- **出現回数**: 1

## EP-006: UIフィードバック認識ズレの繰り返し
- **発生**: 2026-04-05 Session 4
- **事象**: UI修正を5回やり直し（ドロップダウン vs ボタン、ラベル表記等）
- **根本原因**: デザイン仕様の確認不足のまま実装に着手
- **対策**: UI変更前にモックアップ or テキスト仕様を確認する
- **教訓**: UIは「だいたいこう」で始めると手戻りが多い
- **出現回数**: 1

## EP-007: LaunchAgent 重複起動による CLI 接続ミス
- **発生**: 2026-04-10
- **事象**: `ollama ps` で起動中モデルが表示されない（API `/api/ps` には表示される）
- **根本原因**: `com.ollama.serve.plist` と `local.ollama.serve2.plist` の2つのserve processが同時起動。CLIが空の方に接続していた
- **対策**: LaunchAgent は1つに一本化。不要な plist は `.disabled` にリネーム
- **教訓**: LaunchAgent は重複起動しないよう登録状況を定期確認する。CLI と API で状態が乖離したら serve プロセス重複を疑う
- **出現回数**: 1

## EP-008: Whisper 先頭記号でウェイクワード正規表現マッチ失敗
- **発生**: 2026-04-10
- **事象**: ウェイクワード「メイ」が検出されず ambient に流れる
- **根本原因**: faster-whisper small が先頭に `※` を付加していた。`^メイ` の正規表現がマッチせず
- **対策**: `wake_detect.py` に先頭記号ストリップ処理を追加（※♪★等）
- **教訓**: 音声認識の出力は先頭記号・句読点が混入しうる。正規表現で `^` アンカーを使う前にサニタイズ
- **出現回数**: 1

## EP-009: ChatGPT OAuth フロー実装の試行錯誤
- **発生**: 2026-04-11
- **事象**: ChatGPT OAuth フォールバック実装で 6回修正が発生
- **根本原因**: OAuth フロー仕様の事前調査不足。トークンリフレッシュ・スコープ・コールバック形式を個別に試行錯誤
- **対策**: 外部OAuth実装前に公式ドキュメントとサンプル実装を精読してから着手
- **教訓**: OAuth実装は「動かしながら調整」ではなく仕様確認が先。スコープ/リダイレクトURI/PKCEの組み合わせは先に決める
- **出現回数**: 1

## EP-010: child_process モック漏れでテストがブラウザ起動
- **発生**: 2026-04-19
- **事象**: `npm test` を叩くと Chrome が `https://auth.openai.com/log-in` を実際に開く
- **根本原因**: `src/__tests__/chatgpt-auth.test.ts` の login テストが `global.fetch` のみモックし、`child_process.exec` を未モック。login() 内の `exec('open -a Google Chrome ...')` が実走
- **対策**: `vi.mock('child_process', () => ({ exec: vi.fn() }))` をテスト冒頭で宣言。fetch モックも login フロー 3 段（usercode / poll / token 交換）に合わせて拡張
- **教訓**: `exec` / `spawn` / `open` / shell 呼び出しを含む関数をテストするときは、fetch だけでなく `child_process` も常にモックする
- **出現回数**: 1

## EP-011: WebAudio destroy→new 即時連続でリソース競合
- **発生**: 2026-04-19（断続的には 3日間）
- **事象**: Always-On Listener が WebSocket 再接続 / 再起動後に VAD silent fail で停止。co_view 無音警告が連日発生
- **根本原因**: `destroy()` 直後に `new` を走らせると WebAudio/MediaStream の非同期解放と新規取得が競合し、入力が silently 止まる
- **対策**: `restart()` メソッドで destroy → 300ms delay → start に分離し、`_startWatchdog()` で 2分 stale / 10分 auto restart を監視
- **教訓**: 非同期リソース解放 (WebAudio / MediaStream 等) は「短い delay + watchdog」のペアで安定化する
- **出現回数**: 1

## EP-012: 独立経路のある音声入力で計測漏れ
- **発生**: 2026-04-19
- **事象**: `/co-view-improve` 自動改善レポートが wake word 誤発火 (YouTube 音声で `WAKE DETECTED` → LLM reply) を計測できていなかった
- **根本原因**: 計測 grep が `[ambient] source: unknown intervention=reply` 1 経路のみ。wake 経路は ambient をバイパスするため集計外
- **対策**: skill.md に 1-D2 (wake word 誤発火分析) を追加。`WAKE DETECTED` / `WAKE BLOCKED` / unknown 話者到達 / LLM reply をそれぞれ集計
- **教訓**: 音声入力系は ambient / wake / 会話モード等の独立経路を持つ。改善ループの計測を 1 経路に絞ると同種バグを見逃す
- **出現回数**: 1
