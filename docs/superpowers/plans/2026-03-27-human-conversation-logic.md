# 人間の会話ロジック再現 — Proactive Agent v3

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** proactive agent の話題選択を、人間が「気になる人に配慮しながら話しかける時」の思考プロセスに忠実に再現する

**Architecture:** 6つのスコア軸（タイムリーさ、新鮮さ、会話の流れ、感情フィット、ユーザー親和性、意外性）で候補をスコアリングし、Claude には最終判断のみを委ねる。スコアリングはコード側で決定論的に行い、ダッシュボードで全候補の内訳が可視化される。

**Tech Stack:** TypeScript (proactive agent), Python (interest scanner), React (dashboard)

---

## 人間の会話ロジックとは何か

人間が気になる人に話しかける時、無意識にやっていること:

1. **「今何してるかな？」** — 相手の状態を推し量る
2. **「これ、あの人喜ぶかな？」** — 相手のフィルターを通す
3. **「最近この話したっけ？」** — 同じ話をしないか確認
4. **「昨日のあの件、どうなったかな？」** — 会話の続きを考える
5. **「今これ言って大丈夫？」** — タイミングを判断
6. **「これ意外と面白いかも」** — サプライズ要素

静的な「優先度リスト」では再現できない。**同じ情報でも、文脈によってスコアが変わる**のが人間の会話。

---

## スコアリングモデル: 6軸

各候補に対して0.0〜1.0のスコアを6軸で算出:

| 軸 | 何を測るか | 高い例 | 低い例 |
|----|-----------|--------|--------|
| **timeliness** | 時間的な旬 | 今日の試合結果、さっき出た記事 | 1週間前のニュース |
| **novelty** | 会話での新鮮さ | 今日まだ触れてない話題 | 今日3回目のドジャースの話 |
| **continuity** | 会話の流れ | 昨日のゴルフレッスンの感想聞く | 脈絡なく温泉の話 |
| **emotional_fit** | 今の状態への適合 | 休日にリラックスした話題 | 忙しい日に重い経営の話 |
| **affinity** | ユーザーの好み | 反応が良かったカテゴリ | 無視されがちなカテゴリ |
| **surprise** | 意外な面白さ | AIとゴルフの交差点記事 | いつものドジャーススコア |

### 重み（動的に調整）

```
base_weights = {
  timeliness: 0.25,
  novelty: 0.20,
  continuity: 0.20,
  emotional_fit: 0.15,
  affinity: 0.10,
  surprise: 0.10,
}
```

状況による動的調整:
- 朝一番 → timeliness +0.10（今日の情報を優先）
- 前回の話題から2時間以内 → continuity +0.10（フォローアップの機会）
- 直近3回無反応 → surprise +0.15（マンネリ打破）
- 週末 → emotional_fit +0.10（リラックスした話題を重視）

### 最終スコア
```
final_score = Σ (axis_score × dynamic_weight) for each axis
```

---

## ファイル構成

| ファイル | 役割 | 変更 |
|---------|------|------|
| `src/conversation-scorer.ts` | **NEW** — 6軸スコアリングエンジン | 作成 |
| `src/skill-enhanced-proactive-agent.ts` | run() でスコアラーを呼び出し、候補リストを構築 | 修正 |
| `src/proactive-state.ts` | buildCronPrompt() にスコア付き候補を渡す | 修正 |
| `interest_scanner.py` | timeliness スコアをキャッシュに含める | 修正 |
| `dashboard/src/pages/ProactiveConfig.tsx` | 判断ログにスコア内訳を表示 | 修正 |
| `dashboard/server/api.ts` | stats API にスコア情報を含める | 修正 |

---

## Task 1: conversation-scorer.ts — スコアリングエンジン

**Files:**
- Create: `src/conversation-scorer.ts`

### スコアリング関数の設計

```typescript
interface ScoredCandidate {
  topic: string;
  source: string;          // 'interest-cache' | 'calendar' | 'cogmem' | 'email' | 'follow-up'
  category: string;        // interest category ID
  scores: {
    timeliness: number;    // 0-1
    novelty: number;       // 0-1
    continuity: number;    // 0-1
    emotional_fit: number; // 0-1
    affinity: number;      // 0-1
    surprise: number;      // 0-1
  };
  finalScore: number;
  reasoning: string;       // なぜこのスコアか（1行）
}

interface ConversationContext {
  currentHour: number;
  dayOfWeek: number;       // 0=日, 6=土
  todayMessages: Array<{ time: string; summary: string; source: string }>;
  recentHistory: Array<{ category: string; interestCategory?: string; sentAt: string; reaction: string | null; reactionDelta: number }>;
  calendarDensity: number; // 0=空, 1=普通, 2=忙しい
  lastSentMinutesAgo: number;
  consecutiveNoReaction: number; // 直近で連続して無反応の数
}
```

- [ ] **Step 1: ファイル作成 — 型定義とスケルトン**

`src/conversation-scorer.ts` を作成。
ScoredCandidate, ConversationContext インターフェースを定義。
`scoreCandidate()` と `scoreCandidates()` のスケルトンを作成。

- [ ] **Step 2: timeliness スコア実装**

```typescript
function scoreTimeliness(candidate: RawCandidate): number {
  // pub_date があれば: 0時間=1.0, 6時間=0.75, 24時間=0.5, 48時間=0.0
  // カレンダーイベント: 今日=0.9, 明日=0.6, 来週=0.3
  // cogmem: 今日のエントリ=0.8, 今週=0.5
  // follow-up: 昨日の話題=0.9（フォローアップは旬が短い）
}
```

- [ ] **Step 3: novelty スコア実装**

```typescript
function scoreNovelty(candidate: RawCandidate, ctx: ConversationContext): number {
  // 今日同じカテゴリで送信済み → 0.0（絶対ブロック）
  // 今日同じソースで送信済み → 0.1
  // 昨日同じカテゴリ → 0.3
  // 3日以上前 → 0.7
  // 7日以上前 → 0.9
  // 一度も触れてない → 0.8

  // 注意: 「長く触れてない」と「一度も触れてない」は違う
  // 長く触れてない → 復活の新鮮さ = 0.9
  // 一度も触れてない → 未知のリスク = 0.8（少し下げる）
}
```

- [ ] **Step 4: continuity スコア実装**

```typescript
function scoreContinuity(candidate: RawCandidate, ctx: ConversationContext): number {
  // 直近の送信メッセージの interestCategory と一致
  //   → 昨日の同カテゴリ + 自然なフォローアップ質問 = 0.9
  //   → 「ゴルフレッスンどうだった？」「ドジャース勝ったね」
  // 直近の MILESTONE に関連 = 0.7
  // 2つの興味の交差点 = 0.6（AI × ゴルフ記事）
  // 脈絡なし = 0.0

  // 特殊: フォローアップ候補を自動生成
  // 昨日 hobby-trigger で送った → 今日は結果/感想を聞く候補を追加
}
```

- [ ] **Step 5: emotional_fit スコア実装**

```typescript
function scoreEmotionalFit(candidate: RawCandidate, ctx: ConversationContext): number {
  // 週末 + 趣味/レジャー → 0.9
  // 週末 + 仕事 → 0.2
  // 忙しい日（calendarDensity=2） + 軽い話題 → 0.7
  // 忙しい日 + 重い話題 → 0.3
  // 夜（20時） + リラックス系 → 0.9
  // 朝（9時） + ビジネス系 → 0.8

  // カテゴリ → 感情タイプ のマッピング
  // light: dodgers, golf, onsen, food, local, weather
  // medium: campingcar, cat_health, llm_local, dev_tools
  // heavy: ai_agent, business_strategy, ma_startup
}
```

- [ ] **Step 6: affinity スコア実装**

```typescript
function scoreAffinity(candidate: RawCandidate, ctx: ConversationContext): number {
  // proactive-state の reaction history から算出
  // カテゴリ別の反応率（positive / total）
  // 反応率 80%+ → 0.9
  // 反応率 50-80% → 0.7
  // 反応率 < 50% → 0.4
  // データなし → 0.5（中立）

  // user-insights の arousal も加味
  // arousal >= 0.8 のインサイトに関連 → +0.1
}
```

- [ ] **Step 7: surprise スコア実装**

```typescript
function scoreSurprise(candidate: RawCandidate, ctx: ConversationContext): number {
  // 2つの興味カテゴリの交差点 → 0.9
  //   例: "AIを使ったゴルフスイング分析" = ai_agent × golf
  // 普段触れないカテゴリからの高品質記事 → 0.7
  // 「去年の今頃」型の記憶 → 0.8
  // 定番カテゴリの定番情報 → 0.1

  // 実装: キーワードマッチで複数カテゴリに該当する記事を検出
}
```

- [ ] **Step 8: 動的重み調整 + 最終スコア算出**

```typescript
function getDynamicWeights(ctx: ConversationContext): Record<string, number> {
  const weights = { ...BASE_WEIGHTS };

  // 朝一番: タイムリーさ重視
  if (ctx.currentHour >= 8 && ctx.currentHour <= 10) weights.timeliness += 0.10;

  // フォローアップ機会: 前回から2時間以内
  if (ctx.lastSentMinutesAgo < 120) weights.continuity += 0.10;

  // マンネリ打破: 3回連続無反応
  if (ctx.consecutiveNoReaction >= 3) weights.surprise += 0.15;

  // 週末: 感情フィット重視
  if (ctx.dayOfWeek === 0 || ctx.dayOfWeek === 6) weights.emotional_fit += 0.10;

  // 正規化（合計1.0に）
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  for (const k of Object.keys(weights)) weights[k] /= sum;

  return weights;
}

function scoreCandidates(
  rawCandidates: RawCandidate[],
  ctx: ConversationContext
): ScoredCandidate[] {
  const weights = getDynamicWeights(ctx);

  return rawCandidates.map(c => {
    const scores = {
      timeliness: scoreTimeliness(c),
      novelty: scoreNovelty(c, ctx),
      continuity: scoreContinuity(c, ctx),
      emotional_fit: scoreEmotionalFit(c, ctx),
      affinity: scoreAffinity(c, ctx),
      surprise: scoreSurprise(c, ctx),
    };

    const finalScore = Object.entries(scores).reduce(
      (sum, [axis, score]) => sum + score * weights[axis], 0
    );

    return { ...c, scores, finalScore, reasoning: buildReasoning(c, scores) };
  }).sort((a, b) => b.finalScore - a.finalScore);
}
```

- [ ] **Step 9: フォローアップ候補の自動生成**

```typescript
function generateFollowUpCandidates(ctx: ConversationContext): RawCandidate[] {
  // 昨日のメッセージから自然なフォローアップを生成
  // 例: 昨日「ゴルフレッスン楽しんで」→ 今日「レッスンどうだった？」
  // 例: 昨日「ドジャース開幕戦」→ 今日「試合楽しめた？」

  const followUps: RawCandidate[] = [];
  const yesterday = // 昨日の todayMessages を取得

  for (const msg of yesterday) {
    followUps.push({
      topic: `${msg.summary} のフォローアップ`,
      source: 'follow-up',
      category: msg.source,
      pub_date: null,
      metadata: { originalMessage: msg.summary },
    });
  }

  return followUps;
}
```

- [ ] **Step 10: コミット**

```bash
git add src/conversation-scorer.ts
git commit -m "feat: add 6-axis conversation scoring engine"
```

---

## Task 2: interest_scanner.py — timeliness メタデータ強化

**Files:**
- Modify: `interest_scanner.py`

- [ ] **Step 1: 各アイテムに timeliness_score を追加**

score_item() の結果に timeliness を分離して保存:

```python
item["timeliness"] = freshness  # 0-1, 時間ベースの鮮度
item["score"] = ...             # 従来の総合スコア
```

- [ ] **Step 2: カテゴリに感情タイプを追加**

```python
INTEREST_CATEGORIES = {
    "dodgers": {
        ...
        "emotion_type": "light",  # light | medium | heavy
    },
    "ai_agent": {
        ...
        "emotion_type": "heavy",
    },
}
```

キャッシュに emotion_type を含めて保存。

- [ ] **Step 3: コミット**

```bash
git add interest_scanner.py
git commit -m "feat: add timeliness and emotion_type to interest cache"
```

---

## Task 3: proactive agent — スコアラー統合

**Files:**
- Modify: `src/skill-enhanced-proactive-agent.ts`
- Modify: `src/proactive-state.ts`

- [ ] **Step 1: run() にスコアリングパイプラインを追加**

gatherMemoryContext() の後、buildSkillEnhancedPrompt() の前に:

```typescript
// Build conversation context
const conversationCtx = this.buildConversationContext(state);

// Gather raw candidates from all sources
const rawCandidates = this.buildRawCandidates(collectedData, memoryContext);

// Score candidates with 6-axis model
const scoredCandidates = scoreCandidates(rawCandidates, conversationCtx);

// Store scored candidates in state for dashboard
state.lastScoredCandidates = scoredCandidates.slice(0, 10);
```

- [ ] **Step 2: buildRawCandidates() 実装**

interest-cache.json, カレンダー, cogmem, フォローアップ候補を統合して RawCandidate[] を構築。

- [ ] **Step 3: buildConversationContext() 実装**

proactive-state から ConversationContext を構築。calendarDensity はカレンダーデータから算出。

- [ ] **Step 4: buildCronPrompt() を修正 — スコア付き候補を含める**

```
## 話題候補（スコア順）
| # | 話題 | ソース | 総合 | 旬 | 新鮮 | 流れ | 状態 | 好み | 意外 |
|---|------|--------|------|----|----|------|------|------|------|
| 1 | ドジャース開幕戦結果 | interest-cache | 0.82 | 0.9 | 0.8 | 0.9 | 0.8 | 0.7 | 0.3 |
| 2 | Claude Code検証記事 | interest-cache | 0.71 | 0.8 | 0.7 | 0.3 | 0.5 | 0.9 | 0.6 |
| 3 | ゴルフレッスンの感想 | follow-up | 0.68 | 0.5 | 0.9 | 1.0 | 0.7 | 0.5 | 0.2 |
...

上記の候補から最適なものを1つ選ぶか、NO_REPLY を判断してください。
スコアは参考値です。あなたの直感で最終判断してください。
```

- [ ] **Step 5: decision log にスコア内訳を保存**

```typescript
state.lastDecisionLog = {
  ...decisionLog,
  scoredCandidates: scoredCandidates.slice(0, 10).map(c => ({
    topic: c.topic,
    source: c.source,
    category: c.category,
    scores: c.scores,
    finalScore: c.finalScore,
    reasoning: c.reasoning,
  })),
};
```

- [ ] **Step 6: コミット**

```bash
git add src/skill-enhanced-proactive-agent.ts src/proactive-state.ts
git commit -m "feat: integrate 6-axis scoring into proactive agent"
```

---

## Task 4: ダッシュボード — スコア内訳の可視化

**Files:**
- Modify: `dashboard/src/pages/ProactiveConfig.tsx`
- Modify: `dashboard/server/api.ts`

- [ ] **Step 1: API に scoredCandidates を含める**

stats API で `lastScoredCandidates` を返す。

- [ ] **Step 2: 判断ログセクションにレーダーチャート風のスコア表示**

各候補のスコア内訳を6軸のバーチャートで表示:

```
#1 ドジャース開幕戦結果 [0.82]
  旬  ████████░░ 0.9
  新鮮 ████████░░ 0.8
  流れ █████████░ 0.9
  状態 ████████░░ 0.8
  好み █████████░ 0.7
  意外 ███░░░░░░░ 0.3

#2 Claude Code検証記事 [0.71]
  旬  ████████░░ 0.8
  ...
```

- [ ] **Step 3: スコア軸のラベルを日本語で表示**

```typescript
const AXIS_LABELS: Record<string, string> = {
  timeliness: '旬',
  novelty: '新鮮さ',
  continuity: '流れ',
  emotional_fit: '状態',
  affinity: '好み',
  surprise: '意外性',
};
```

- [ ] **Step 4: 動的重みの表示**

「今回の重み配分」セクションを追加。なぜこの重みになったか（朝だから、週末だから、等）を表示。

- [ ] **Step 5: コミット**

```bash
git add dashboard/
git commit -m "feat: add 6-axis score visualization to proactive dashboard"
```

---

## Task 5: ビルドとテスト

- [ ] **Step 1: ダッシュボードビルド**

```bash
cd /Users/akira/workspace/claude-code-slack-bot/dashboard && npm run build
```

- [ ] **Step 2: pm2 restart + dashboard restart**

```bash
pm2 restart claude-slack-bot
pkill -f "tsx server/api.ts"; cd dashboard && nohup npx tsx server/api.ts &
```

- [ ] **Step 3: 手動実行で動作確認**

```bash
curl -s -X POST http://127.0.0.1:3457/internal/run-proactive
```

ダッシュボードで判断ログのスコア内訳が表示されることを確認。

- [ ] **Step 4: ブラウザで確認（スクリーンショットで内容を検証）**

```bash
$B goto http://localhost:3456/bot/proactive
$B screenshot /tmp/proactive-v3.png
```

スクリーンショットを読んで、スコア内訳が妥当な値か、表示が正しいかを確認。

---

## 設計の核心: なぜこれが「人間らしい」か

1. **同じ情報でも文脈で価値が変わる** — ドジャースの試合結果は試合当日は timeliness=1.0 だが翌々日は 0.2。でも「昨日観た試合」のフォローアップなら continuity=0.9 で救われる

2. **低優先カテゴリでもタイムリーなら浮上する** — 普段 Tier C の「天気」でも、ゴルフレッスンの日に雨予報なら timeliness=1.0 + emotional_fit=0.9 で一気にトップに

3. **飽きを検知して変化をつける** — 3回連続無反応 → surprise の重みが上がり、普段と違うカテゴリの話題が選ばれる

4. **会話の流れを大切にする** — 昨日ゴルフの話をしたら、今日はゴルフの話題よりゴルフのフォローアップ（「どうだった？」）の方がスコアが高い

5. **相手の状態を想像する** — 忙しい日に重い話はしない、週末は楽しい話題を選ぶ
