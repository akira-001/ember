# Ember Dashboard Design Unification

**Date:** 2026-03-27
**Status:** Draft
**Scope:** claude-code-slack-bot/dashboard (Ember Dashboard)

## Goal

Ember ダッシュボードのビジュアルを cogmem ダッシュボードのアーストーンに寄せつつ、アクセントカラーは Ember ロゴ（オレンジ系）由来で独立させる。両ダッシュボードが「兄弟プロダクト」として認識できるトーンの統一。

## Decisions

| Item | Decision |
|------|----------|
| 方向性 | cogmem のアーストーン基調、各ダッシュボードのアクセントはロゴ由来で独立 |
| パレット | Ember Glow — サンドストーン背景 + ダークチョコレートサイドバー |
| ステータスカラー | Ember トーンに馴染む調整版（フォレストグリーン/アンバー/テラコッタ/スレートブルー） |
| レイアウト構成 | サイドバー: ウォームダーク、メイン: ウォームクリーム（cogmem と同じ構成） |
| 変更スコープ | カラー + タイポグラフィ + カード・バッジ・テーブルのスタイル |
| 実装方式 | ハイブリッド — CSS Custom Properties でカラートークン定義、Tailwind のレイアウトユーティリティは維持 |

## Color Palette: Ember Glow

### Main Content Area

```css
:root {
  --bg: #f5ede4;
  --surface: #ede4d8;
  --surface-hover: #e4d8ca;
  --border: #d4c8b8;
  --text: #3a2e28;
  --text-dim: #8a7060;
}
```

### Accent (from Ember logo)

```css
:root {
  --accent: #E8854A;
  --accent-hover: #D4763A;
  --accent-dim: #C06830;
}
```

### Sidebar

```css
:root {
  --sidebar-bg: #31241e;
  --sidebar-surface: #3e3028;
  --sidebar-border: #4a3e34;
  --sidebar-text: #a89888;
  --sidebar-text-active: #f0e8e0;
  --sidebar-active-bg: rgba(232, 133, 74, 0.1);
  --sidebar-active-dot: #E8854A;
}
```

### Status Colors

```css
:root {
  --success: #4a8a4a;
  --warning: #c08a30;
  --error: #b85040;
  --info: #5070a0;
}
```

### cogmem との比較

| Token | cogmem | Ember Glow | Notes |
|-------|--------|------------|-------|
| --bg | #f0ebe3 | #f5ede4 | Ember はやや暖かい |
| --surface | #e8e1d6 | #ede4d8 | 同上 |
| --border | #d0c9be | #d4c8b8 | 同上 |
| --text | #2c2826 | #3a2e28 | 微調整 |
| --accent | #6b8a6b (sage) | #E8854A (orange) | ロゴ由来で独立 |
| --sidebar-bg | #2a2726 | #31241e | Ember はチョコレート寄り |
| --success | #5a9e5a | #4a8a4a | やや落ち着いた緑 |
| --warning | #c08a30 | #c08a30 | 共通 |
| --error | #c05050 | #b85040 | テラコッタ寄り |
| --info | #5070b0 | #5070a0 | 微調整 |

## Typography

### Changes from current

| Property | Before (Tailwind) | After (cogmem-aligned) |
|----------|-------------------|------------------------|
| Page title | text-2xl (24px) bold | 1.5rem (24px) font-weight: 600 |
| Section heading | text-lg (18px) semibold | 0.875rem (14px) font-weight: 600, uppercase, letter-spacing: 0.05em |
| Body text | text-sm (14px) | 0.8125rem (13px) line-height: 1.6 |
| Labels | text-xs (12px) gray-400 | 0.75rem (12px) uppercase, letter-spacing: 0.05em, font-weight: 500 |
| Stat values | text-2xl (24px) bold | 1.75rem (28px) font-weight: 700, font-variant-numeric: tabular-nums |
| Font family | No change | -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif |

### Key principles
- font-size は rem 単位で統一
- section heading に uppercase + letter-spacing（cogmem パターン）
- 数値には font-variant-numeric: tabular-nums（等幅数字）
- line-height: 1.6 をデフォルトに

## Card Styles

### Stat Card
```css
.stat-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1.25rem;
  transition: all 0.15s;
}
```

### Content Card
```css
.content-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1.25rem;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  transition: all 0.15s;
}
```

### Card Label
```css
.card-label {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
```

## Badge Styles

### Base Badge
```css
.badge {
  display: inline-block;
  padding: 0.125rem 0.5rem;
  border-radius: 9999px;  /* pill shape */
  font-size: 0.75rem;
  font-weight: 500;
}
```

### Category Badge Colors

| Category | Background | Text |
|----------|-----------|------|
| email_reply | rgba(80, 112, 160, 0.10) | #405a8a |
| meeting_prep | rgba(120, 90, 160, 0.10) | #6a5a9a |
| deadline_risk | rgba(184, 80, 64, 0.10) | #984030 |
| slack_followup | rgba(232, 133, 74, 0.12) | #C06830 |
| energy_break | rgba(74, 138, 74, 0.12) | #3a7a3a |
| personal_event | rgba(192, 138, 48, 0.12) | #8a6a20 |
| hobby_leisure | rgba(180, 90, 130, 0.10) | #8a4a6a |
| flashback | rgba(120, 90, 160, 0.10) | #6a5a9a |

### Status Badge Colors

| Status | Background | Text |
|--------|-----------|------|
| enabled | rgba(74, 138, 74, 0.12) | #3a7a3a |
| disabled | rgba(138, 112, 96, 0.15) | #8a7060 |

## Table Styles

```css
/* Table header */
th {
  padding: 0.75rem 1rem;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid var(--border);
}

/* Table cell */
td {
  padding: 0.75rem 1rem;
  font-size: 0.8125rem;
  color: var(--text);
  border-bottom: 1px solid var(--border);
  font-variant-numeric: tabular-nums;  /* for numeric cells */
}

/* Row hover */
tr:hover td {
  background: var(--surface-hover);
  transition: background 0.15s;
}
```

## Button Styles

```css
/* Primary button */
.btn-primary {
  padding: 0.625rem 1.25rem;
  border-radius: 6px;
  background: var(--accent);
  color: white;
  font-size: 0.8125rem;
  font-weight: 500;
  transition: background 0.15s;
}
.btn-primary:hover {
  background: var(--accent-hover);
}
```

## Implementation Approach

### Strategy: Hybrid (CSS Custom Properties + Tailwind)

1. **CSS Custom Properties を `src/index.css` に定義** — 上記の全カラートークン
2. **Tailwind の色クラスを CSS 変数参照に置換** — `bg-gray-800` → `bg-[var(--surface)]`
3. **レイアウトユーティリティは維持** — flex, grid, gap, p-*, m-* はそのまま
4. **コンポーネント単位で順次移行** — Sidebar → Layout → Cards → Badges → Tables → Charts

### File changes

| File | Change |
|------|--------|
| `src/index.css` | CSS Custom Properties 定義を追加 |
| `tailwind.config.js` | 変更なし（カスタムテーマ不要） |
| `src/components/Sidebar.tsx` | サイドバーの色クラスを CSS 変数に |
| `src/components/Layout.tsx` | メイン背景の色クラスを CSS 変数に |
| `src/pages/*.tsx` | カード、バッジ、テーブルの色・タイポグラフィを更新 |
| `src/types.ts` | CATEGORY_COLORS を Ember Glow パレットに更新 |
| `public/favicon.svg` | 変更なし（既にロゴカラー） |

### Out of scope

- cogmem ダッシュボード側の変更（既に完成しているため触らない）
- チャートライブラリ（Recharts）の色変更（カラートークンを参照するだけで対応可能、実装時に自然に適用）
- レスポンシブブレークポイントの変更
- 機能追加・削除
