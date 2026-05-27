const SLACK_USER_ID = 'U3SFGQXNH';

function postSlack(text) {
  const token = PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN_EVE');
  if (!token) {
    throw new Error('Script Property SLACK_BOT_TOKEN_EVE is not set');
  }
  const res = UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
    method: 'post',
    contentType: 'application/json; charset=utf-8',
    headers: { Authorization: `Bearer ${token}` },
    payload: JSON.stringify({ channel: SLACK_USER_ID, text }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  const body = res.getContentText();
  Logger.log(`Slack response: ${code} ${body}`);
  const parsed = JSON.parse(body);
  if (code !== 200 || !parsed.ok) {
    throw new Error(`Slack post failed: ${code} ${body}`);
  }
}

function notifySuccess(summary, days) {
  const today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  const tag = days === 3 ? '同期完了' : `${days}日 backfill 完了`;

  if (summary.saved.length === 0) {
    postSlack(`Gmail → Drive ${tag}（${today}）\n新しい領収書・請求書はなかったよー :white_check_mark:`);
    return;
  }
  const lines = summary.saved.map((s) => `• \`${s.kind}/${s.year}/${s.name}\` ← ${s.from}`).join('\n');
  const errBlock = summary.errors.length > 0
    ? `\n\n:warning: ${summary.errors.length} 件失敗:\n${summary.errors.map((e) => `• ${e.file}: ${e.error}`).join('\n')}`
    : '';
  postSlack(`Gmail → Drive ${tag}（${today}）\n${summary.saved.length}件保存したよー！\n${lines}${errBlock}`);
}

function notifyFailure(err, summary, days) {
  const today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  const tag = days === 3 ? '同期' : `${days}日 backfill`;
  try {
    postSlack(
      `:warning: Gmail → Drive ${tag} 失敗（${today}）\n\n` +
      `*エラー*: ${(err && err.message) || err}\n\n` +
      `*そこまでに保存できた件数*: ${summary.saved.length} 件\n` +
      `*Akiraさんへ*: GAS の実行ログを確認してね（script.google.com → Gmail to Drive → 実行数）`
    );
  } catch (slackErr) {
    Logger.log(`Failed to notify Slack: ${slackErr}`);
  }
}
