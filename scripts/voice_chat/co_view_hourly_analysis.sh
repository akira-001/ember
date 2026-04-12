#!/bin/bash
# co_view 毎時分析: ログ分析 → Slack投稿（改善案）
# crontab: 17 * * * * /Users/akira/workspace/open-claude/scripts/voice_chat/co_view_hourly_analysis.sh

CLAUDE_BIN="/Users/akira/.local/bin/claude"
WORKDIR="/Users/akira/workspace/claude-code-slack-bot"
LOG="/tmp/co_view_cron_hourly.log"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] hourly analysis start" >> "$LOG"

"$CLAUDE_BIN" -p "
/Users/akira/.claude/skills/co-view-improve/skill.md を読んで、Step 1〜2（ログ分析 + Slack投稿）を実行して。

- Step 3（Cron登録）はスキップ（既に永続cronが動いている）
- Step 4〜6（パッチ適用）は 👍 承認後に 10分チェック側が実行するのでスキップ
- Slack投稿は必ずメインチャンネル C0AHPJMS5QE に（thread_tsは使わない）
- 投稿したメッセージの ts を /tmp/co_view_latest_slack_ts.txt に保存:
  echo \"<ts>\" > /tmp/co_view_latest_slack_ts.txt
" --allowedTools "Bash,mcp__claude_ai_Slack__slack_send_message,Read" \
  --cwd "$WORKDIR" >> "$LOG" 2>&1

echo "[$(date '+%Y-%m-%d %H:%M:%S')] hourly analysis done" >> "$LOG"
