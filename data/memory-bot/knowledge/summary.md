# プロジェクト知識サマリー

## Ember Humanization（2026-04-08 時点）

### 実装済み
- **Phase 0**: HeartbeatContext（ローリングバッファ）、SOUL.md/MEMORY.md、HEARTBEAT_OK プロトコル
- **Phase 1**: プロンプト最適化（予測トピック選択、応答長ガイドライン、連想生成）
- **Phase 2**: ReflectionEngine（自動内省）、感情モード拡張（6×4）、Thinker/Talker 分離、emotionTag メタデータ

### 未実装
- Phase 3: 自律性とコスト最適化（Thompson Sampling 等）
- emotionTag → TTS voice preset 連携（voice_chat 側）
- THINKER_MODEL による本番検証

### アーキテクチャ
- Thinker（Haiku）→ 判断 → Talker（メインモデル）→ メッセージ生成
- ReflectionEngine: 24h max / 6h cooldown / 強リアクション即時トリガー
- emotionTag: bright/gentle/calm/neutral → `{botId}-voice-meta.json`
