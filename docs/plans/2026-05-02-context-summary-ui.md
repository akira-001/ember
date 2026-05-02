# Context Summary UI 改善プラン

**作成日**: 2026-05-02  
**担当**: architect  
**前提**: サーバ側 API 調査完了（Task #1）

---

## 全体方針

6フェーズを独立した小PR単位で順次ship。フェーズ間の依存関係は最小化し、各フェーズは単独でマージ・動作確認できる構成にする。

```
D（バグ修正）→ A（鮮度UX）→ B（部分修正UI）→ C（根拠可視化）→ E（次元追加）→ F（学習ループ）
          ↑                                            ↑
     ウォームアップ                            サーバ・UI 並列開発
```

**推定総工数**: 3〜5日（フェーズ別は各節に記載）

---

## 前提知識：現状の構造

### UI側（`packages/dashboard/src/components/ember-chat/`）

- `ContextSummaryPanel.tsx` — パネル全体（独立コンポーネント、ローカルに`ContextSummary`インターフェースを定義）
- `types.ts` — 共有型定義（`ContextSummary`型は**ここにない**、Panel内にローカル定義されている）
- `useEmberChat.ts` — WebSocketハンドラ（`context_summary`メッセージタイプの処理が**存在しない**）

### サーバ側（`packages/voice-chat/app.py`）

- `ContextSummary` dataclass（1055行〜）— `evidence_snippets`含む全フィールドあり
- `_context_summary_to_dict()`（1313行）— GET API・WebSocketブロードキャスト両方で使用
- `_broadcast_context_summary()`（1328行）— 更新のたびに`context_summary`メッセージを全クライアントへ送信
- `GET /api/context-summary` — `_context_summary_to_dict()`をそのまま返す（`evidence_snippets`含む）

---

## Phase D: スナップショット送信バグ修正

**概要**: Yes押下時、フィードバックPOSTにsummaryスナップショットを含めていないため、サーバーはどの推測に対するYesかを記録できない。  
**推定工数**: 0.5日  
**前提**: なし（最初にship）

### バグの所在

`ContextSummaryPanel.tsx:141` — `handleYes`がPOSTボディに `{ label: 'yes' }` のみ送信。  
`submitCorrection`（159行）も同様に `{ label: 'no', correction }` のみ。

サーバー側（POST `/api/context-summary/feedback`）はpayloadに `summary` フィールドがあれば保存できる設計になっているか要確認。確認後、サーバー側に`summary`フィールドを受け入れる処理を追加する。

### 変更ファイル

| ファイル | 変更内容 |
|---------|---------|
| `packages/dashboard/src/components/ember-chat/ContextSummaryPanel.tsx` | handleYes・submitCorrectionのPOSTボディにsummaryスナップショットを追加 |
| `packages/voice-chat/app.py` | POST `/api/context-summary/feedback` ハンドラでsummaryフィールドをJSONLに保存 |

### 実装ステップ

1. `app.py`のfeedbackエンドポイントを確認し、受け取ったpayloadの保存ロジックを読む
2. feedbackエンドポイントがpayloadに`summary`フィールドを受け入れるよう拡張（既存`correction`との共存確認）
3. 保存するJSONLエントリに`summary`フィールドを追加
4. `handleYes`を修正：`body: JSON.stringify({ label: 'yes', summary })`
5. `submitCorrection`を修正：`body: JSON.stringify({ label: 'no', correction, summary })`
6. `summary`が`null`の場合のガード（`updated_at`チェックは既存、問題なし）
7. `test_context_summary.py`内のfeedbackエンドポイントテストに`summary`フィールドを追加してアサート

### テスト戦略

- `test_context_summary.py`の既存feedbackテストを拡張（summaryフィールド含むリクエスト → JSONL保存確認）
- UIはブラウザで手動確認（Yes押下後、`context_summary_feedback.jsonl`に`summary`が記録されていることをcatで確認）

### 並列化可能な箇所

- サーバー側（app.py修正）とUI側（Panel修正）は独立して開発可能。ただしシンプルなのでシーケンシャルで十分。

---

## Phase A: 鮮度UX

**概要**: 3分超でstaleバッジ表示・警告色強化・手動更新ボタン追加。WebSocket `context_summary`メッセージをuseEmberChatで受信してexternalSummaryとして渡す。  
**推定工数**: 1日

### 現状の問題

1. `useEmberChat.ts`のWebSocketハンドラに`context_summary`メッセージタイプが存在しない → WebSocket経由のリアルタイム更新が機能していない
2. ageTimerが30秒間隔 → UI更新が粗い（古さ表示が不正確）
3. 3分超でもビジュアル変化なし → ユーザーが古い情報を信頼してしまう

### 変更ファイル

| ファイル | 変更内容 |
|---------|---------|
| `packages/dashboard/src/components/ember-chat/types.ts` | `ContextSummary`インターフェースを追加（Panel内のローカル定義を移動・拡充） |
| `packages/dashboard/src/components/ember-chat/useEmberChat.ts` | WebSocketハンドラに`context_summary`ケース追加、`contextSummary`state管理 |
| `packages/dashboard/src/components/ember-chat/ContextSummaryPanel.tsx` | staleバッジ・警告色・手動更新ボタン・ageTimer間隔短縮（30s→10s）、ローカルContextSummary定義を削除してtypes.tsから import |

### 実装ステップ

1. `types.ts`に`ContextSummary`インターフェースを追加（`subtopics`, `language_register`, `evidence_snippets`を含む全フィールド）
2. `useEmberChat.ts`に`contextSummary`state（`useState<ContextSummary | null>(null)`）を追加
3. WebSocketハンドラの`else if`チェーンに`context_summary`ケースを追加→`setContextSummary(msg.summary)`
4. `useEmberChat`の戻り値に`contextSummary`を追加
5. `ContextSummaryPanel.tsx`のローカル`ContextSummary`定義を削除し`types.ts`からimport
6. ageTimerを10秒間隔に変更（30,000→10,000）
7. `ageText()`に3分超判定を追加し「STALE」バッジ用のboolean/styleを返す
8. staleバッジ（赤系バッジ）をheaderRowに追加
9. 手動更新ボタン（「更新」）をheaderRowに追加→クリックで`refresh()`呼び出し
10. `externalSummary` propの型を`ContextSummary | null`に更新し、Panelを利用する親コンポーネントで`contextSummary`を渡す

### テスト戦略

- WebSocketメッセージ`context_summary`が届いた場合のstate更新はブラウザのdevtoolsで確認
- staleバッジ：サーバー停止状態で3分待機して表示を目視確認（または`updated_at`を古い値にモックして確認）
- 手動更新：ボタン押下後に`/api/context-summary`がfetchされることをNetworkタブで確認

### 並列化可能な箇所

- `types.ts`追加 と `useEmberChat.ts`修正は独立（後者が前者のimportに依存するが、型定義なので実装開始は並列可能）
- staleバッジUI と WebSocket受信ロジックは独立して開発可能

---

## Phase B: 部分修正UI

**概要**: 現状は「No→全フィールド修正フォーム表示」だが、フィールド別Yes/Noチップに変更。APIは既にフィールド単位の`correction`に対応済み。  
**推定工数**: 1日

### 現状の問題

修正フォームが全フィールドの一括入力。ユーザーが「活動だけ違う」場合でも全フォームを見る必要がある。

### 変更ファイル

| ファイル | 変更内容 |
|---------|---------|
| `packages/dashboard/src/components/ember-chat/ContextSummaryPanel.tsx` | フィールド別チップUI実装、修正フォーム廃止または省略表示化 |

### 実装ステップ

1. フィールドリストの定義（`activity`, `topic`, `is_meeting`, `keywords`, `named_entities`）
2. 各フィールドの現在値表示に「このフィールドだけ違う」ボタン（チップ形式）を追加
3. チップ押下で当該フィールドの修正入力欄をインラインexpand表示（既存の修正フォームロジックを流用）
4. フィールド別submitで`correction: { [field]: newValue }`をPOST
5. 全体Noボタンは残す（全フィールド一括修正ユースケースのため）
6. チップのスタイル定義（押下前：グレー系、押下後：オレンジ系）
7. インライン入力欄のキャンセル処理（ESCまたはキャンセルボタン）

### テスト戦略

- 各フィールドのチップ押下→インライン入力→submit→`/api/context-summary/feedback` POSTボディのNetwork確認
- `correction`に当該フィールドのみ含まれることをアサート
- ブラウザ目視でチップのトグル動作確認

### 並列化可能な箇所

- Phase A完了後に着手（`ContextSummary`型の拡張が前提）
- UIのチップロジックとスタイルは独立して分担可能

---

## Phase C: 根拠可視化

**概要**: `evidence_snippets`をexpand表示。GETレスポンスに既に含まれている（確認済み）。  
**推定工数**: 0.5日

### 確認済み事項

- `_context_summary_to_dict()`（1313行）は`evidence_snippets`フィールドを返している
- WebSocketブロードキャスト（`_broadcast_context_summary`）にも含まれる
- **サーバー側の追加作業は不要**

### 変更ファイル

| ファイル | 変更内容 |
|---------|---------|
| `packages/dashboard/src/components/ember-chat/types.ts` | `ContextSummary`に`evidence_snippets?: string[]`追加（Phase Aで実施済みならスキップ） |
| `packages/dashboard/src/components/ember-chat/ContextSummaryPanel.tsx` | evidence_snippetsのexpand表示UI追加 |

### 実装ステップ

1. Phase Aで`types.ts`に`evidence_snippets`が追加されていることを確認（されていなければ追加）
2. Panelに「根拠を見る ▼」トグルボタンを追加（`showEvidence` state）
3. expand時に`evidence_snippets`をリスト表示（各snippetは1行、薄グレーの小テキスト）
4. `evidence_snippets`が空配列の場合はトグルボタンを非表示

### テスト戦略

- GETレスポンスの`evidence_snippets`フィールド存在確認（curlまたはbrowser Network tab）
- expand/collapseのトグル動作確認（目視）
- snippets空の場合にトグルボタンが非表示になることを確認

### 並列化可能な箇所

- Phase Aと並列でUI部分を開発可能（`evidence_snippets`がすでに型に含まれている前提）

---

## Phase E: 次元追加（mood / location / time-context）

**概要**: サーバー側`ContextSummary` dataclassにフィールド追加 + LLMプロンプト修正 + UIに表示。  
**推定工数**: 1.5日（サーバー・UI並列で1日に短縮可能）

### 変更ファイル

| ファイル | 変更内容 |
|---------|---------|
| `packages/voice-chat/app.py` | `ContextSummary` dataclassにフィールド追加、`_build_context_summary`プロンプト修正、`_context_summary_to_dict`に追加フィールド、`to_prompt_block`にrender追加 |
| `packages/voice-chat/tests/test_context_summary.py` | 新フィールドのテストケース追加 |
| `packages/dashboard/src/components/ember-chat/types.ts` | `ContextSummary`インターフェースに新フィールド追加 |
| `packages/dashboard/src/components/ember-chat/ContextSummaryPanel.tsx` | 新フィールドの表示追加 |

### 追加フィールド定義

```python
# app.py ContextSummary dataclass に追加
mood: str = ""           # ラベルセット: calm, focused, excited, stressed, neutral
location: str = ""       # ラベルセット: home, office, cafe, commute, unknown  
time_context: str = ""   # ラベルセット: morning, afternoon, evening, night, unknown
```

```typescript
// types.ts ContextSummary に追加
mood?: string;
location?: string;
time_context?: string;
```

### 実装ステップ（サーバー側）

1. `ContextSummary` dataclass（1055行）に`mood`, `location`, `time_context`フィールドを追加
2. `_build_context_summary`のLLMプロンプト（1338行〜）に3フィールドの推論指示を追加（ラベルセット明示）
3. `_context_summary_to_dict()`（1313行）に3フィールドを追加
4. `to_prompt_block()`（1070行）に3フィールドのrender追加
5. `test_context_summary.py`の`TestBuildContextSummary`に新フィールドのアサートを追加
6. `test_context_summary.py`の`TestContextSummaryPromptBlock`に新フィールドのrender確認を追加

### 実装ステップ（UI側）— サーバー側と並列可能

7. `types.ts`の`ContextSummary`に`mood?`, `location?`, `time_context?`を追加
8. Panelに新フィールドの表示行を追加（`mood`, `location`, `time_context`をラベル付きで）
9. 修正フォーム（Phase Bのチップ）に新フィールドを追加（selectまたはinput）

### テスト戦略

- `test_context_summary.py`実行で既存テストが壊れないことを確認
- LLMプロンプト変更後、実際の推論結果に新フィールドが含まれることをログで確認
- UIでの表示確認（mood/location/time_contextが表示される）

### 並列化可能な箇所

- **サーバー側ステップ1〜6** と **UI側ステップ7〜9** は完全に並列開発可能
- ただし統合テスト（実際のWebSocket経由での新フィールド受信）はサーバー完了後

---

## Phase F: 学習ループ可視化

**概要**: 信頼度推移グラフ・`feedback.jsonl`件数・フィードバック反映マーカーを表示。  
**推定工数**: 1日

### 変更ファイル

| ファイル | 変更内容 |
|---------|---------|
| `packages/voice-chat/app.py` | `GET /api/context-summary/history`エンドポイント追加（confidence推移・feedback件数を返す） |
| `packages/dashboard/src/components/ember-chat/ContextSummaryPanel.tsx` | 信頼度推移グラフ・フィードバック件数表示、グラフコンポーネント追加 |

### 新規APIエンドポイント

```
GET /api/context-summary/history
Response: {
  ok: bool,
  confidence_history: [{ts: float, confidence: float}],  // 直近N件
  feedback_count: {yes: int, no: int, total: int},
  last_feedback_ts: float | null
}
```

データソース:
- `confidence_history`: インメモリのリングバッファで管理（最新50件程度）
- `feedback_count`: `context_summary_feedback.jsonl`をカウント

### 実装ステップ

1. `app.py`にconfidence履歴のリングバッファ（`deque(maxlen=50)`）を追加
2. `_build_context_summary`実行のたびにバッファへ`{ts, confidence}`を追記
3. `context_summary_feedback.jsonl`のyes/noカウントを集計するヘルパー関数を追加
4. `GET /api/context-summary/history`エンドポイントを実装
5. Panelに「学習状況 ▼」トグルセクションを追加（`showHistory` state）
6. expand時にconfidence推移をSVGまたはCSS barチャートで表示（軽量に実装、外部ライブラリ不使用）
7. フィードバック件数（Yes: N件 / No: N件）を表示
8. `last_feedback_ts`があれば「最終フィードバック: N分前」を表示

### テスト戦略

- `/api/context-summary/history`のレスポンス形式確認（curl）
- `feedback.jsonl`のyes/noカウントが正確か確認（既存のjsonlに対してテスト）
- グラフ表示の目視確認（データあり・なし両ケース）

### 並列化可能な箇所

- サーバー側（ステップ1〜4）とUI側（ステップ5〜8）は並列開発可能
- ただしUIのAPI呼び出しはサーバー完了が前提

---

## フェーズ間依存関係まとめ

```
D（独立）
A（独立。types.tsのContextSummary型定義を確立する重要フェーズ）
B（A完了後推奨。ContextSummary型に依存）
C（A完了後推奨。evidence_snippets型に依存。サーバー変更不要）
E（A完了後推奨。サーバー・UI並列可）
F（任意の順。サーバー変更が独立）
```

## 次の判断ポイント

1. **Phase D完了後**: フィードバックデータの品質確認（スナップショット込みのJSONLを目視）
2. **Phase E着手前**: LLMプロンプト変更の影響範囲確認（既存フィールドの推論精度が下がらないか）
3. **Phase F**: confidence履歴をインメモリで持つかDB/ファイルで永続化するかの決定（現状はインメモリで十分）
