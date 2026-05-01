import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

export type Lang = 'ja' | 'en';

const translations = {
  // Sidebar
  'sidebar.dashboard': { ja: 'ダッシュボード', en: 'DASHBOARD' },
  'sidebar.overview': { ja: 'オーバービュー', en: 'Overview' },
  'sidebar.activity': { ja: 'アクティビティ', en: 'Activity Log' },
  'sidebar.botSettings': { ja: 'ボット設定', en: 'BOT SETTINGS' },
  'sidebar.personality': { ja: 'パーソナリティ', en: 'Personality' },
  'sidebar.models': { ja: 'モデル & 制限', en: 'Models & Limits' },
  'sidebar.proactive': { ja: 'AI秘書', en: 'AI Secretary' },
  'sidebar.supportLog': { ja: '支援ログ', en: 'Support Log' },
  'sidebar.cronJobs': { ja: '定期実行', en: 'Cron Jobs' },
  'sidebar.mcpServers': { ja: '連携アプリ', en: 'MCP Servers' },
  'sidebar.knowledge': { ja: 'ナレッジ', en: 'KNOWLEDGE' },
  'sidebar.insights': { ja: 'ユーザーインサイト', en: 'User Insights' },
  'sidebar.weights': { ja: 'カテゴリウェイト', en: 'Category Weights' },
  'sidebar.constants': { ja: '定数', en: 'Constants' },
  'sidebar.tools': { ja: 'ツール', en: 'TOOLS' },
  'sidebar.emberChat': { ja: 'Ember Chat', en: 'Ember Chat' },
  'sidebar.voiceEnroll': { ja: '声紋登録', en: 'Voice Enroll' },
  'sidebar.system': { ja: 'システム', en: 'SYSTEM' },
  'sidebar.botManagement': { ja: 'ボット管理', en: 'Bot Management' },
  'sidebar.stamps': { ja: '報酬履歴', en: 'Reward History' },
  'sidebar.localModels': { ja: 'ローカルモデル', en: 'Local Models' },
  'sidebar.globalConfig': { ja: 'グローバル設定', en: 'Global Config' },
  'sidebar.profile': { ja: 'プロファイル', en: 'Profile' },
  'sidebar.thoughtTrace': { ja: '思考トレース', en: 'Thought Trace' },
  'sidebar.footer': { ja: 'Multi-Agent Ember', en: 'Multi-Agent Ember' },

  // Overview
  'overview.title': { ja: 'ダッシュボード', en: 'Dashboard' },
  'overview.cooldown': { ja: 'クールダウン', en: 'Cooldown' },
  'overview.cooldown.active': { ja: 'アクティブ', en: 'Active' },
  'overview.cooldown.cleared': { ja: '解除', en: 'Cleared' },
  'overview.lastCheck': { ja: '最終チェック', en: 'Last Check' },
  'overview.lastCheck.none': { ja: '未実行', en: 'Not run' },
  'overview.nextCheck': { ja: '次回チェック', en: 'Next Check' },
  'overview.backoff': { ja: 'バックオフ', en: 'Backoff' },
  'overview.sent': { ja: '送信数', en: 'Sent' },
  'overview.positive': { ja: 'ポジティブ反応', en: 'Positive' },
  'overview.negative': { ja: 'ネガティブ反応', en: 'Negative' },
  'overview.reactionRate': { ja: '反応率', en: 'Reaction Rate' },
  'overview.trend': { ja: '反応トレンド', en: 'Reaction Trend' },
  'overview.recentHistory': { ja: '直近の履歴', en: 'Recent History' },
  'overview.sentAt': { ja: '送信日時', en: 'Sent At' },
  'overview.category': { ja: 'カテゴリ', en: 'Category' },
  'overview.reaction': { ja: '反応', en: 'Reaction' },
  'overview.delta': { ja: 'デルタ', en: 'Delta' },
  'overview.noHistory': { ja: '履歴なし', en: 'No history' },
  'overview.nextTomorrow': { ja: '明日 9:00 JST', en: 'Tomorrow 9:00 JST' },
  'overview.cleared': { ja: '解除済み', en: 'Cleared' },
  'overview.eventSources': { ja: 'イベントソース', en: 'Event Sources' },

  // Bot Management
  'bots.title': { ja: 'ボット管理', en: 'Bot Management' },
  'bots.newBot': { ja: '+ 新規ボット', en: '+ New Bot' },
  'bots.empty': { ja: 'ボットがまだありません', en: 'No bots yet' },
  'bots.createFirst': { ja: '最初のボットを作成', en: 'Create First Bot' },
  'bots.model': { ja: 'モデル', en: 'Model' },
  'bots.personality': { ja: 'パーソナリティ', en: 'Personality' },
  'bots.confirmDelete': { ja: '本当に削除する？', en: 'Really delete?' },
  'bots.delete': { ja: '削除', en: 'Delete' },
  'bots.cancel': { ja: 'キャンセル', en: 'Cancel' },

  // Bot Wizard
  'wizard.title': { ja: '新規ボット作成', en: 'Create New Bot' },
  'wizard.step.slackApp': { ja: 'Slack App', en: 'Slack App' },
  'wizard.step.credentials': { ja: '認証情報', en: 'Credentials' },
  'wizard.step.personality': { ja: 'パーソナリティ', en: 'Personality' },
  'wizard.step.confirm': { ja: '確認', en: 'Confirm' },
  'wizard.slack.title': { ja: 'Slack App を作成する', en: 'Create a Slack App' },
  'wizard.slack.step1': { ja: 'にアクセスし「Create New App」をクリック', en: 'and click "Create New App"' },
  'wizard.slack.step2': { ja: '「From scratch」を選択し、App名とワークスペースを設定', en: 'Select "From scratch" and set the App name and workspace' },
  'wizard.slack.step3': { ja: '「Socket Mode」を有効化し、App-Level Token を生成（scope: ', en: 'Enable "Socket Mode" and generate App-Level Token (scope: ' },
  'wizard.slack.step4': { ja: '「Event Subscriptions」を有効化し、以下のBot Eventsを追加:', en: 'Enable "Event Subscriptions" and add these Bot Events:' },
  'wizard.slack.step5': { ja: '「OAuth & Permissions」で以下のBot Token Scopesを追加:', en: 'Add these Bot Token Scopes under "OAuth & Permissions":' },
  'wizard.slack.step6': { ja: '「Install to Workspace」でアプリをインストール', en: 'Install the app via "Install to Workspace"' },
  'wizard.slack.step7': { ja: 'Bot Token、App Token、Signing Secret をメモ', en: 'Note the Bot Token, App Token, and Signing Secret' },
  'wizard.cred.title': { ja: '認証情報', en: 'Credentials' },
  'wizard.cred.tokenError': { ja: 'トークンの検証に失敗しました', en: 'Failed to validate token' },
  'wizard.cred.botId': { ja: 'Bot ID', en: 'Bot ID' },
  'wizard.cred.botIdError': { ja: 'Bot ID は必須です', en: 'Bot ID is required' },
  'wizard.cred.botIdFormat': { ja: '英小文字・数字・ハイフンのみ（英字始まり）', en: 'Lowercase letters, numbers, and hyphens only (start with letter)' },
  'wizard.cred.displayName': { ja: '表示名', en: 'Display Name' },
  'wizard.cred.botToken': { ja: 'Bot Token', en: 'Bot Token' },
  'wizard.cred.appToken': { ja: 'App Token', en: 'App Token' },
  'wizard.cred.signingSecret': { ja: 'Signing Secret', en: 'Signing Secret' },
  'wizard.personality.title': { ja: 'パーソナリティ', en: 'Personality' },
  'wizard.personality.type': { ja: 'パーソナリティタイプ', en: 'Personality Type' },
  'wizard.personality.motif': { ja: 'バックグラウンドモチーフ', en: 'Background Motif' },
  'wizard.personality.chatModel': { ja: 'チャットモデル', en: 'Chat Model' },
  'wizard.personality.proactive': { ja: 'プロアクティブエージェント', en: 'Proactive Agent' },
  'wizard.personality.promptPreview': { ja: '生成プロンプトプレビュー', en: 'Generated Prompt Preview' },
  'wizard.personality.generating': { ja: '生成中...', en: 'generating...' },
  'wizard.confirm.title': { ja: '設定確認', en: 'Confirm Settings' },
  'wizard.nav.back': { ja: '戻る', en: 'Back' },
  'wizard.nav.next': { ja: '次へ', en: 'Next' },
  'wizard.nav.creating': { ja: '作成中...', en: 'Creating...' },
  'wizard.nav.create': { ja: '作成 & 起動', en: 'Create & Start Bot' },

  // Profile
  'profile.title': { ja: 'ユーザープロファイル', en: 'User Profile' },
  'profile.completionRate': { ja: '充足率', en: 'Completion Rate' },
  'profile.priorityLayer': { ja: '最優先収集', en: 'Priority Layer' },
  'profile.nextQuestion': { ja: '次の問いかけ', en: 'Next Question' },
  'profile.collectionConfig': { ja: '収集設定', en: 'Collection Config' },
  'profile.layerWeights': { ja: 'Layer報酬ウェイト', en: 'Layer Reward Weights' },
  'profile.frequency': { ja: '問いかけ頻度', en: 'Question Frequency' },
  'profile.choiceCount': { ja: '選択肢数', en: 'Choice Count' },
  'profile.save': { ja: '保存して反映', en: 'Save & Apply' },
  'profile.confidence.high': { ja: '高', en: 'High' },
  'profile.confidence.medium': { ja: '中', en: 'Medium' },
  'profile.confidence.low': { ja: '低', en: 'Low' },
  'profile.confidence.hypothesis': { ja: '仮説', en: 'Hypothesis' },
  'profile.uncollected': { ja: '未収集', en: 'Uncollected' },
  'profile.example': { ja: '例', en: 'e.g.' },
  'layer.identity': { ja: 'アイデンティティ', en: 'Identity' },
  'layer.vision': { ja: 'ビジョン', en: 'Vision' },
  'layer.strategy': { ja: '戦略', en: 'Strategy' },
  'layer.execution': { ja: '実行', en: 'Execution' },
  'layer.state': { ja: '状態', en: 'State' },

  // Common
  'common.loading': { ja: '読み込み中...', en: 'Loading...' },
  'common.error': { ja: 'エラー', en: 'Error' },
  'common.save': { ja: '保存', en: 'Save' },
  'common.saved': { ja: '保存しました', en: 'Saved' },
  'common.enabled': { ja: '有効', en: 'Enabled' },
  'common.disabled': { ja: '無効', en: 'Disabled' },
  'common.on': { ja: 'ON', en: 'ON' },
  'common.off': { ja: 'OFF', en: 'OFF' },
  'common.minutes': { ja: '分', en: 'min' },
  'common.hours': { ja: '時間', en: 'h' },
} as const;

type TranslationKey = keyof typeof translations;

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: TranslationKey) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = localStorage.getItem('dashboard-lang');
    return (saved === 'en' || saved === 'ja') ? saved : 'ja';
  });

  const setLang = useCallback((newLang: Lang) => {
    setLangState(newLang);
    localStorage.setItem('dashboard-lang', newLang);
  }, []);

  const t = useCallback((key: TranslationKey): string => {
    const entry = translations[key];
    return entry ? entry[lang] : key;
  }, [lang]);

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
