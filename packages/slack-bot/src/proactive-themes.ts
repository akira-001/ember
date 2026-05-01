import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

export interface ThemeRule {
  path: string[];
  label: string;
  keywords: string[];
}

export interface ThemeClassification {
  path: string[];
  key: string;
  label: string;
  matchedKeywords: string[];
  confidence: number;
}

interface ThemePromotionRecord {
  signature: string;
  fallbackPath: string[];
  promotedPath: string[];
  label: string;
  count: number;
  firstObservedAt: string;
  promotedAt: string;
  sampleText: string;
}

interface ThemePromotionStore {
  records: ThemePromotionRecord[];
}

export interface ThemeInput {
  text?: string;
  topic?: string;
  preview?: string;
  fullText?: string;
  category?: string;
  interestCategory?: string;
  source?: string;
  sourceType?: string;
  skill?: string;
}

function normalizeThemeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[（）()【】「」『』｢｣﹁﹂﹃﹄\-:：|｜,、。."'"'!！?？・]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeKeyword(text: string): string {
  return normalizeThemeText(text);
}

function leaf(prefix: string, suffix: string, label: string, keywords: string[]): ThemeRule {
  return {
    path: [...prefix.split('/').filter(Boolean), ...suffix.split('/').filter(Boolean)],
    label,
    keywords,
  };
}

function buildGroup(prefix: string, items: Array<[string, string, string[]]>): ThemeRule[] {
  return items.map(([suffix, label, keywords]) => leaf(prefix, suffix, label, keywords));
}

const PROMOTION_FILE = join(process.cwd(), 'data', 'proactive-theme-promotions.json');
const PROMOTION_THRESHOLD = 2;

const THEME_RULES: ThemeRule[] = [
  ...buildGroup('local/saitama/tokorozawa', [
    ['event/food-fair', '所沢 物産展', ['所沢', '物産展', 'グルメ', '北海道', '九州']],
    ['event/market', '所沢 マルシェ・催事', ['所沢', 'マルシェ', '催事', 'イベント']],
    ['event/flower-sakura', '所沢 芝桜・菜の花', ['所沢', '芝桜', '菜の花', '花見', '桜']],
    ['street/prope-dori', '所沢 プロぺ通り', ['所沢', 'プロぺ通り', 'プロペ通り', '商店街']],
    ['recreation/park-walk', '所沢 公園散歩', ['所沢', '公園', '散歩', 'ウォーク']],
    ['recreation/nature', '所沢 自然・緑地', ['所沢', '自然', '緑地', '森', '緑']],
    ['cafe/sweets', '所沢 カフェ・スイーツ', ['所沢', 'カフェ', 'スイーツ', '喫茶']],
    ['food/ramen', '所沢 ラーメン', ['所沢', 'ラーメン', 'つけ麺', '麺']],
    ['food/sweets', '所沢 スイーツ巡り', ['所沢', 'スイーツ', 'ケーキ', 'パフェ']],
    ['station/access', '所沢 駅前・アクセス', ['所沢駅', '駅前', 'アクセス', '徒歩']],
    ['station/commute', '所沢 通勤・乗り換え', ['所沢', '通勤', '乗り換え', '電車']],
    ['culture/art', '所沢 アート・展示', ['所沢', 'アート', '展示', '美術', 'ギャラリー']],
    ['community/sports', '所沢 地域スポーツ', ['所沢', '地域', 'スポーツ', 'サークル']],
    ['family/event', '所沢 家族イベント', ['所沢', 'ファミリー', '親子', 'イベント']],
    ['history/museum', '所沢 博物館・資料館', ['所沢', '博物館', '資料館', '歴史']],
    ['history/landmark', '所沢 名所・史跡', ['所沢', '名所', '史跡', '記念館', '歴史']],
  ]),
  ...buildGroup('local/saitama/other', [
    ['kawagoe/festival', '川越 祭り・蔵造り', ['川越', '祭', '蔵造り', '時の鐘']],
    ['kawagoe/food', '川越 食べ歩き', ['川越', '食べ歩き', 'グルメ', '芋']],
    ['sayama/tea', '狭山茶・茶畑', ['狭山茶', '茶畑', 'お茶', '新茶']],
    ['sayama/cafe', '狭山 カフェ', ['狭山', 'カフェ', '喫茶', 'スイーツ']],
    ['iruma/air-base', '入間 航空祭・基地', ['入間', '航空祭', '基地', 'ブルーインパルス']],
    ['kumagaya/heat', '熊谷 暑さ・気温', ['熊谷', '暑い', '猛暑', '気温']],
    ['chichibu/nature', '秩父 自然・渓谷', ['秩父', '渓谷', '自然', '山', '川']],
    ['chichibu/hike', '秩父 ハイキング', ['秩父', 'ハイキング', '登山', 'トレッキング']],
    ['honjo/craft', '本庄 ものづくり', ['本庄', '工芸', 'ものづくり', '職人']],
    ['koshigaya/shopping', '越谷 ショッピング', ['越谷', 'ショッピング', 'モール', '買い物']],
    ['koshigaya/family', '越谷 家族おでかけ', ['越谷', '家族', 'おでかけ', '子ども']],
    ['asaka/commute', '朝霞 通勤・駅前', ['朝霞', '駅前', '通勤', '路線']],
    ['saitama-city/urban', 'さいたま市 都市イベント', ['さいたま市', '都市', 'イベント', 'アリーナ']],
    ['road-trip', '埼玉 ドライブ', ['埼玉', 'ドライブ', '道の駅', '郊外']],
  ]),
  ...buildGroup('sports/mlb/dodgers', [
    ['opening-day', 'ドジャース 開幕戦', ['ドジャース', '開幕戦', 'オープニング', '勝利']],
    ['ohtani/home-run', '大谷 ホームラン', ['大谷', 'ホームラン', 'HR', 'リードオフ']],
    ['ohtani/stats', '大谷 成績・記録', ['大谷', '成績', '記録', '打率', 'OPS']],
    ['roki/support', '朗希 援護', ['朗希', '援護', '投手', 'バックアップ']],
    ['roki/rotation', '朗希 ローテーション', ['朗希', 'ローテーション', '先発', '登板']],
    ['lineup/balance', '打線のつながり', ['打線', 'つながり', '連打', '得点圏']],
    ['back-to-back', '連発・連続アーチ', ['連続', 'バックトゥバック', '2試合連続', '連発']],
    ['pitching/analysis', '投手分析', ['投手', '配球', '球種', '球速']],
    ['pitching/bullpen', 'ブルペン・救援', ['ブルペン', '救援', '抑え', 'セットアッパー']],
    ['road-trip/west-coast', '西海岸ロードゲーム', ['ロード', '西海岸', '遠征', 'アウェー']],
    ['fan-reaction', 'ファン反応', ['ファン', 'コメント', 'SNS', '話題']],
    ['highlights/video', 'ハイライト動画', ['ハイライト', '動画', 'YouTube', '映像']],
    ['news/injury', 'ケガ・登録情報', ['ケガ', '故障', '登録', 'ロースター']],
    ['schedule/preview', '試合予定・見どころ', ['予定', '見どころ', '次戦', '対戦']],
  ]),
  ...buildGroup('sports/golf', [
    ['driver/long-shot', 'ドライバー飛距離', ['ドライバー', '飛距離', 'ティーショット']],
    ['driver/equipment', 'ドライバー・機材', ['ドライバー', 'ヘッド', 'シャフト', '機材']],
    ['swing/form', 'スイング改善', ['スイング', 'フォーム', 'トップ', '軌道']],
    ['lesson/coach', 'レッスン・指導', ['レッスン', 'コーチ', '指導', '練習']],
    ['round/report', 'ラウンド報告', ['ラウンド', 'スコア', '結果', '回った']],
    ['round/course', 'コース・戦略', ['コース', '戦略', 'グリーン', 'バンカー']],
    ['youtube/tips', 'YouTube ゴルフ解説', ['YouTube', '解説', 'ゴルフ', '参考']],
    ['club/selection', 'クラブ選び', ['クラブ', '選び', 'シャフト', 'ヘッド']],
    ['short-game', 'ショートゲーム', ['アプローチ', 'パット', 'ショートゲーム', '寄せ']],
    ['tournament/news', 'ゴルフ大会ニュース', ['大会', 'ツアー', '優勝', 'ニュース']],
    ['practice/range', '練習場・打ちっぱなし', ['練習場', '打ちっぱなし', '練習', 'レンジ']],
    ['practice/scorecard', 'スコアカード分析', ['スコアカード', '分析', 'パー', 'ボギー']],
    ['score/review', 'スコア振り返り', ['スコア', '振り返り', 'ミス', '改善']],
  ]),
  ...buildGroup('ai/enterprise', [
    ['anthropic/security', 'Anthropic セキュリティ', ['Anthropic', 'Glasswing', 'security', 'セキュリティ']],
    ['openai/models', 'OpenAI モデル', ['OpenAI', 'GPT', 'モデル', 'API']],
    ['pwc/genai-quality', 'PwC 生成AIの質', ['PwC', '生成AI', '可視化', '質']],
    ['kpmg/report', 'KPMG レポート', ['KPMG', 'レポート', '調査', 'テックトレンド']],
    ['workstyle/hybrid', 'AI 時代の働き方', ['出社回帰', '働き方', '対面', 'ハイブリッド']],
    ['hr/ai-evaluation', 'AI 時代の人事評価', ['人材評価', '評価基準', 'ヒューマンリソース', '人事']],
    ['governance/compliance', 'AI ガバナンス', ['ガバナンス', '規制', 'コンプライアンス', '監査']],
    ['security/procurement', 'AI 調達・セキュリティ', ['調達', 'ベンダー', 'セキュリティ', '審査']],
    ['agent/orchestration', 'エージェント運用', ['エージェント', '運用', 'オーケストレーション', 'ワークフロー']],
    ['automation/workflow', '業務自動化', ['自動化', 'ワークフロー', '業務効率化', 'オートメーション']],
    ['evaluation/metrics', 'AI 評価指標', ['評価', '指標', 'ベンチマーク', '測定']],
    ['adoption/enterprise', '企業導入・実装', ['企業', '導入', '実装', '業務活用']],
  ]),
  ...buildGroup('ai/local-llm', [
    ['browser/webgpu', 'ブラウザLLM・WebGPU', ['WebGPU', 'ブラウザ', 'ローカルLLM', 'Gemma']],
    ['ollama', 'Ollama', ['Ollama', 'ローカル', '推論', 'サーバ']],
    ['mlx', 'MLX', ['MLX', 'Mac', 'Apple Silicon', 'ローカル']],
    ['gemma', 'Gemma', ['Gemma', 'Google', '軽量', 'ローカル']],
    ['qwen', 'Qwen', ['Qwen', '中国', 'モデル', 'ローカル']],
    ['whisper/local', 'ローカル音声認識', ['Whisper', '音声認識', 'ローカル', 'STT']],
    ['embeddings', '埋め込み', ['埋め込み', 'embedding', 'ベクトル', '類似度']],
    ['rag', 'RAG', ['RAG', '検索拡張', 'retrieval', '知識ベース']],
    ['fine-tuning', 'ファインチューニング', ['fine-tuning', '学習', '調整', 'finetune']],
    ['offline/tools', 'オフライン運用', ['オフライン', 'ローカル', 'ツール', '自前']],
    ['deploy/server', 'デプロイ・配信', ['デプロイ', 'サーバ', '配信', '公開']],
    ['model/comparison', 'モデル比較', ['比較', 'モデル', '精度', '速度']],
    ['prompt/engineering', 'プロンプト設計', ['プロンプト', '設計', '改善', '指示']],
  ]),
  ...buildGroup('business/consulting', [
    ['cfo', 'CFO・財務', ['CFO', '財務', '資本政策', '経営']],
    ['ma', 'M&A', ['M&A', '買収', 'デューデリジェンス', '統合']],
    ['strategy', '経営戦略', ['戦略', '経営', '方針', '意思決定']],
    ['sales/growth', '営業・成長戦略', ['営業', '成長', '拡大', '売上']],
    ['pricing', '価格戦略', ['価格', '値付け', 'プライシング', '単価']],
    ['market/report', '市場レポート', ['市場', 'レポート', '調査', 'トレンド']],
    ['transformation', '業務変革', ['変革', '業務', '改革', 'DX']],
    ['operations', 'オペレーション改善', ['オペレーション', '改善', '業務効率', '現場']],
    ['risk', 'リスク管理', ['リスク', '管理', '不確実性', '対策']],
    ['finance/kpi', '財務KPI', ['KPI', '財務', 'LTV', 'CAC']],
    ['competitive/analysis', '競合分析', ['競合', '分析', '比較', 'ベンチマーク']],
    ['org/design', '組織設計', ['組織', '設計', '役割', '権限']],
    ['ipo', 'IPO', ['IPO', '上場', '準備', '投資家']],
    ['pmi', 'PMI・統合', ['PMI', '統合', '吸収', 'シナジー']],
    ['restructuring', '事業再建', ['再建', '不採算', '撤退', '黒字化']],
  ]),
  ...buildGroup('business/client', [
    ['kyocera/proposal', '京セラ 提案・見積', ['京セラ', 'Kyocera', '見積', 'RFP', '提案書']],
    ['kyocera', '京セラ クライアント', ['京セラ', 'Kyocera', 'セラミック', '電子部品']],
    ['astemo/prototype', 'アステモ 試作・検証', ['アステモ', 'Astemo', '試作', '検証']],
    ['astemo', 'アステモ クライアント', ['アステモ', 'Astemo', 'モビリティ', '自動車部品']],
    ['nichias/maintenance', 'ニチアス 保守・更新', ['ニチアス', 'Nichias', '保守', '更新']],
    ['nichias', 'ニチアス クライアント', ['ニチアス', 'Nichias', '断熱', '保温']],
    ['sanki/site', '三機工業 現場・施工', ['三機工業', '施工', '現場', '工事']],
    ['sanki', '三機工業 クライアント', ['三機工業', 'サンキ', '設備', '空調']],
    ['gmo/platform', 'GMO プラットフォーム', ['GMO', 'プラットフォーム', 'インフラ', 'クラウド']],
    ['gmo', 'GMO クライアント', ['GMO', 'グローバルメディアオンライン', 'インターネット', 'クラウド']],
    ['asia-kokuso/gis', 'アジア航測 GIS・測量', ['アジア航測', 'GIS', '測量', '地図']],
    ['asia-kokuso', 'アジア航測 クライアント', ['アジア航測', '航空測量', '地理情報', 'GIS']],
    ['avant/reporting', 'アバント 管理会計', ['アバント', '管理会計', '連結', 'レポーティング']],
    ['avant', 'アバント クライアント', ['アバント', 'Avant', '連結会計', '経営管理']],
  ]),
  ...buildGroup('business/benchmark', [
    ['accenture/delivery', 'アクセンチュア 実行力', ['アクセンチュア', 'Accenture', '実行', 'デリバリー']],
    ['accenture', 'アクセンチュア ベンチマーク', ['アクセンチュア', 'Accenture', 'ベンチマーク', '比較']],
    ['bcg/strategy', 'BCG 戦略', ['BCG', 'Boston Consulting Group', '戦略', '提言']],
    ['bcg', 'BCG ベンチマーク', ['BCG', 'Boston Consulting Group', 'ベンチマーク', '比較']],
  ]),
  ...buildGroup('entertainment/movie-drama', [
    ['blue-giant', 'BLUE GIANT', ['BLUE GIANT', 'ジャズ', 'ライブシーン', '映画']],
    ['vivant', 'VIVANT', ['VIVANT', '続編', '映像', 'キャスト']],
    ['hamnet', 'ハムネット', ['ハムネット', '映画', '上映', 'つくば']],
    ['spring-drama', '春ドラマ', ['春ドラマ', '新作', 'スタート', '作品']],
    ['anime/series', 'アニメ・漫画', ['アニメ', '漫画', 'TVアニメ', '新作アニメ']],
    ['anime/adaptation', 'アニメ化・原作展開', ['アニメ化', '原作', 'コミック', '映像化', '漫画', '発表']],
    ['anime/event', 'アニメイベント・グッズ', ['アニメイベント', 'グッズ', 'コラボ', 'フィギュア']],
    ['anime/season', 'アニメ新番組', ['新番組', '放送開始', '春アニメ', '夏アニメ']],
    ['film/theater', '映画', ['映画', 'シネマ', '劇場版', '邦画', '洋画']],
    ['film/japanese', '邦画', ['邦画', '日本映画', '国内映画', '邦画作品']],
    ['film/foreign', '洋画', ['洋画', '海外映画', 'ハリウッド', '字幕版']],
    ['film/preview', '試写・先行上映', ['試写', '先行上映', 'プレミア', '完成披露']],
    ['film/award', '映画賞・受賞', ['映画賞', '受賞', 'アカデミー', 'ノミネート']],
    ['tv/program', 'テレビ番組', ['テレビ番組', '番組', '放送', '地上波', 'TVer']],
    ['tv/drama', 'テレビドラマ', ['ドラマ', '連続ドラマ', '地上波ドラマ', '配信ドラマ']],
    ['tv/variety', 'バラエティ番組', ['バラエティ', 'お笑い', 'トーク番組', '特番']],
    ['tv/news', 'ニュース番組', ['ニュース', '報道', 'ワイドショー', '情報番組']],
    ['tv/documentary', 'ドキュメンタリー番組', ['ドキュメンタリー', '密着', '記録', '特集']],
    ['youtube/trailer', 'YouTube 予告編', ['YouTube', '予告編', '動画', '公開']],
    ['film/festival', '映画祭・試写', ['映画祭', '試写', 'シネマ', '上映']],
    ['music/live', '音楽ライブ', ['ライブ', '音楽', '演奏', 'ステージ']],
    ['theater/release', '劇場公開', ['劇場', '公開', '上映', '初日']],
    ['story/franchise', 'シリーズ作品', ['続編', 'シリーズ', 'フランチャイズ', '物語']],
  ]),
  ...buildGroup('lifestyle/food-wellness', [
    ['gourmet', 'グルメ・飲食', ['グルメ', 'レストラン', '飲食', '食べ歩き', 'ディナー']],
    ['gourmet/ramen', 'ラーメン', ['ラーメン', '中華そば', 'つけ麺', '麺']],
    ['gourmet/sushi', '寿司', ['寿司', '鮨', '海鮮', '握り']],
    ['gourmet/steak', 'ステーキ', ['ステーキ', '肉料理', 'ハンバーグ', '焼肉']],
    ['gourmet/sweets', 'スイーツ', ['スイーツ', 'ケーキ', 'パフェ', 'デザート']],
    ['gourmet/cafe', 'カフェ', ['カフェ', '喫茶店', 'コーヒー', 'ブランチ']],
    ['gourmet/izakaya', '居酒屋', ['居酒屋', '焼き鳥', '酒場', '飲み会']],
    ['gourmet/udon', 'うどん', ['うどん', '讃岐', '肉うどん', '麺']],
    ['onsen', '温泉・スパ', ['温泉', 'スパ', '露天', '日帰り']],
    ['spa/king-queen', 'キング＆クイーン', ['キング＆クイーン', '温泉バルコニー', 'スパ', 'サウナ']],
    ['wellness/sauna', 'サウナ', ['サウナ', '整う', 'ロウリュ', '水風呂']],
    ['bento', '駅弁・弁当', ['駅弁', '弁当', 'ハンバーグ', 'ランチ']],
    ['steak-bowl', 'ステーキ丼', ['ステーキ丼', '丼', '肉', 'ランチ']],
    ['lunch', '昼ごはん', ['昼ごはん', 'お昼', 'ランチ', '食事']],
    ['coffee/break', 'コーヒーブレイク', ['コーヒー', '休憩', 'ひと息', 'カフェ']],
    ['sleep/rest', '休息・睡眠', ['睡眠', '休憩', '寝る', '休息']],
    ['walk/break', '散歩・軽運動', ['散歩', 'ウォーキング', '軽運動', '気分転換']],
    ['walk/fitness', '軽い運動', ['運動', 'フィットネス', 'ストレッチ', 'ジム']],
    ['spring/outing', '春のおでかけ', ['春', 'おでかけ', 'ドライブ', '花']],
    ['grocery/daily', '日用品・買い出し', ['買い出し', '日用品', 'スーパー', '生活']],
  ]),
  ...buildGroup('personal/travel-tech', [
    ['campingcar', 'キャンピングカー', ['キャンピングカー', 'モーターホーム', 'RV', '車中泊']],
    ['campingcar/route', 'キャンピングカー 旅程', ['キャンピングカー', 'ルート', '旅程', '道の駅']],
    ['pet/cat-health', '猫の健康', ['猫', 'ペット', '健康', 'シニア']],
    ['pet/vet', 'ペット・動物病院', ['ペット', '動物病院', '通院', 'ワクチン']],
    ['pet/care', 'ペットケア', ['ペット', 'ケア', 'おやつ', 'ご飯']],
    ['dev/tools', '開発ツール', ['dev', 'ツール', '開発', '便利']],
    ['dev/ai-tools', 'AI 開発ツール', ['AI', '開発', 'ツール', '補助']],
    ['browser', 'ブラウザ', ['ブラウザ', 'Web', '拡張', 'ページ']],
    ['browser/privacy', 'ブラウザ・プライバシー', ['ブラウザ', 'プライバシー', '追跡防止', '拡張']],
    ['travel', '旅行・遠出', ['旅行', '遠出', '旅', '移動']],
    ['travel/hotel', '宿泊・ホテル', ['ホテル', '宿泊', '旅館', 'チェックイン']],
    ['gadget', 'ガジェット', ['ガジェット', '端末', 'デバイス', '新製品']],
    ['gadget/wearable', 'ウェアラブル', ['ウェアラブル', '時計', 'イヤホン', '健康管理']],
    ['family', '家族・身近な人', ['家族', '身近', '友人', '生活']],
    ['hobby', '趣味全般', ['趣味', '遊び', '余暇', '楽しみ']],
    ['productivity', '生産性', ['生産性', '効率', '整理', 'タスク']],
  ]),
];

const ROOT_HINTS: Array<[string, string[]]> = [
  ['local/saitama/tokorozawa', ['local_tokorozawa', '所沢']],
  ['local/saitama/other', ['埼玉', 'saitama']],
  ['sports/mlb/dodgers', ['dodgers', '大谷', '朗希']],
  ['sports/golf', ['golf', 'ゴルフ']],
  ['ai/enterprise', ['ai_agent', 'anthropic', 'openai', 'pwc', 'kpmg', 'accenture', '生成ai', '人工知能', 'llm', 'ガバナンス', '調達', '自動化']],
  ['business/client', ['京セラ', 'アステモ', 'ニチアス', '三機工業', 'gmo', 'アジア航測', 'アバント']],
  ['business/benchmark', ['benchmark', 'アクセンチュア', 'bcg']],
  ['ai/local-llm', ['llm_local', 'webgpu', 'ollama', 'mlx', 'gemma', 'qwen', 'rag', 'fine-tuning', 'デプロイ']],
  ['business/consulting', ['business_strategy', 'strategy', 'cfo', 'ma_startup', 'pricing', 'sales', 'operations']],
  ['entertainment/movie-drama', ['movie_theater', 'youtube', 'ドラマ', '映画', 'アニメ', 'テレビ番組', 'ドキュメンタリー']],
  ['lifestyle/food-wellness', ['onsen', '温泉', 'food', 'lunch', 'break', 'グルメ', 'ラーメン', '寿司', 'カフェ', 'スイーツ', 'サウナ']],
  ['personal/travel-tech', ['campingcar', 'cat_health', 'dev_tools', 'browser', '車中泊', '旅行', 'ガジェット']],
];

function getPreferredRoots(input: ThemeInput): string[] {
  const hints = [
    input.interestCategory || '',
    input.category || '',
    input.source || '',
    input.sourceType || '',
    input.skill || '',
    input.text || '',
    input.topic || '',
    input.preview || '',
    input.fullText || '',
  ].join(' ').toLowerCase();

  const roots: string[] = [];
  for (const [root, needles] of ROOT_HINTS) {
    if (needles.some((needle) => hints.includes(needle.toLowerCase()))) {
      roots.push(root);
    }
  }
  return roots;
}

function buildFallbackPath(input: ThemeInput, preferredRoots: string[]): string[] {
  const base = preferredRoots[0] || 'misc';
  const source = normalizeThemeText(input.source || input.sourceType || input.skill || input.category || 'general')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .join('-') || 'general';
  const topicSeed = normalizeThemeText(input.topic || input.preview || input.fullText || input.text || 'topic')
    .split(' ')
    .filter(Boolean)
    .slice(0, 3)
    .join('-') || 'topic';
  return [base, source, topicSeed];
}

function buildFallbackSignature(input: ThemeInput): string {
  return buildFallbackPath(input, getPreferredRoots(input)).join('/');
}

function buildPromotedPath(fallbackPath: string[]): string[] {
  return ['promoted', ...fallbackPath];
}

function buildLabelFromPath(path: string[]): string {
  return path
    .slice(1)
    .map((part) => part.replace(/[-_/]/g, ' '))
    .join(' > ');
}

function loadPromotionStore(): ThemePromotionStore {
  try {
    if (existsSync(PROMOTION_FILE)) {
      const raw = JSON.parse(readFileSync(PROMOTION_FILE, 'utf-8')) as Partial<ThemePromotionStore>;
      return {
        records: Array.isArray(raw.records) ? raw.records : [],
      };
    }
  } catch {
    // Corrupt promotion file — ignore and rebuild lazily.
  }
  return { records: [] };
}

function savePromotionStore(store: ThemePromotionStore): void {
  const dir = dirname(PROMOTION_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(PROMOTION_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

function findPromotedRecord(signature: string): ThemePromotionRecord | null {
  const store = loadPromotionStore();
  return store.records.find((record) => record.signature === signature) || null;
}

function registerThemeObservation(input: ThemeInput): ThemeClassification {
  const staticClassification = classifyStaticProactiveTheme(input);
  if (staticClassification.path[0] !== 'misc') return staticClassification;

  const signature = buildFallbackSignature(input);
  const store = loadPromotionStore();
  const existing = store.records.find((record) => record.signature === signature);
  const now = new Date().toISOString();

  if (!existing) {
    store.records.push({
      signature,
      fallbackPath: staticClassification.path,
      promotedPath: buildPromotedPath(staticClassification.path),
      label: staticClassification.label,
      count: 1,
      firstObservedAt: now,
      promotedAt: '',
      sampleText: input.topic || input.preview || input.text || input.fullText || '',
    });
    savePromotionStore(store);
    return staticClassification;
  }

  existing.count += 1;
  existing.sampleText = existing.sampleText || input.topic || input.preview || input.text || input.fullText || '';
  if (existing.count >= PROMOTION_THRESHOLD && !existing.promotedAt) {
    existing.promotedAt = now;
    savePromotionStore(store);
    return {
      path: existing.promotedPath,
      key: existing.promotedPath.join('/'),
      label: buildLabelFromPath(existing.promotedPath),
      matchedKeywords: [],
      confidence: 0.85,
    };
  }

  savePromotionStore(store);
  if (existing.promotedAt) {
    return {
      path: existing.promotedPath,
      key: existing.promotedPath.join('/'),
      label: buildLabelFromPath(existing.promotedPath),
      matchedKeywords: [],
      confidence: 0.85,
    };
  }

  return staticClassification;
}

function classifyStaticProactiveTheme(input: ThemeInput): ThemeClassification {
  const normalizedText = normalizeThemeText([
    input.text,
    input.topic,
    input.preview,
    input.fullText,
    input.category,
    input.interestCategory,
    input.source,
    input.sourceType,
    input.skill,
  ].filter(Boolean).join(' '));

  const preferredRoots = getPreferredRoots(input);
  let bestRule: ThemeRule | null = null;
  let bestScore = 0;
  let bestMatchedKeywords: string[] = [];

  for (const rule of THEME_RULES) {
    const { score, matchedKeywords } = scoreRule(rule, normalizedText, preferredRoots);
    if (
      score > bestScore ||
      (score === bestScore && matchedKeywords.length > bestMatchedKeywords.length) ||
      (
        score === bestScore &&
        matchedKeywords.length === bestMatchedKeywords.length &&
        bestRule &&
        rule.path.length > bestRule.path.length
      )
    ) {
      bestRule = rule;
      bestScore = score;
      bestMatchedKeywords = matchedKeywords;
    }
  }

  if (!bestRule || bestScore < 2 || bestMatchedKeywords.length === 0) {
    const fallbackPath = buildFallbackPath(input, preferredRoots);
    return {
      path: fallbackPath,
      key: fallbackPath.join('/'),
      label: fallbackPath.join(' > '),
      matchedKeywords: [],
      confidence: 0.2,
    };
  }

  return {
    path: bestRule.path,
    key: bestRule.path.join('/'),
    label: bestRule.label,
    matchedKeywords: bestMatchedKeywords,
    confidence: Math.min(1, 0.4 + bestScore / 10),
  };
}

function scoreRule(rule: ThemeRule, normalizedText: string, preferredRoots: string[]): { score: number; matchedKeywords: string[] } {
  let score = 0;
  const matchedKeywords: string[] = [];
  const normalizedKeywords = rule.keywords.map(normalizeKeyword);

  for (const keyword of normalizedKeywords) {
    if (!keyword) continue;
    if (normalizedText.includes(keyword)) {
      score += 2;
      matchedKeywords.push(keyword);
    }
  }

  if (preferredRoots.some((root) => rule.path.join('/').startsWith(root))) {
    score += 1;
  }

  const labelTokens = normalizeKeyword(rule.label).split(' ').filter(Boolean);
  if (labelTokens.length > 0 && labelTokens.some((token) => normalizedText.includes(token))) {
    score += 1;
  }

  return { score, matchedKeywords };
}

export function classifyProactiveTheme(input: ThemeInput): ThemeClassification {
  const staticClassification = classifyStaticProactiveTheme(input);
  if (staticClassification.path[0] !== 'misc') return staticClassification;

  const signature = buildFallbackSignature(input);
  const promoted = findPromotedRecord(signature);
  if (promoted) {
    return {
      path: promoted.promotedPath,
      key: promoted.promotedPath.join('/'),
      label: buildLabelFromPath(promoted.promotedPath),
      matchedKeywords: [],
      confidence: 0.9,
    };
  }

  return staticClassification;
}

export function observeProactiveTheme(input: ThemeInput): ThemeClassification {
  return registerThemeObservation(input);
}

export function buildThemeTrail(path: string[]): string[] {
  const trail: string[] = [];
  for (let i = 1; i <= path.length; i++) {
    trail.push(path.slice(0, i).join('/'));
  }
  return trail;
}

export function commonThemeDepth(a: string[], b: string[]): number {
  const max = Math.min(a.length, b.length);
  let depth = 0;
  for (let i = 0; i < max; i++) {
    if (a[i] !== b[i]) break;
    depth++;
  }
  return depth;
}

export function themeDedupWindowHours(depth: number): number {
  if (depth >= 5) return 168;
  if (depth >= 4) return 72;
  if (depth >= 3) return 24;
  if (depth >= 2) return 12;
  return 0;
}

export function hasThemeOverlap(
  a: string[] | undefined,
  b: string[] | undefined,
): { overlap: boolean; depth: number; windowHours: number } {
  if (!a || !b || a.length === 0 || b.length === 0) {
    return { overlap: false, depth: 0, windowHours: 0 };
  }
  const depth = commonThemeDepth(a, b);
  const windowHours = themeDedupWindowHours(depth);
  return {
    overlap: windowHours > 0,
    depth,
    windowHours,
  };
}

export function themeKeyForInput(input: ThemeInput): string {
  return classifyProactiveTheme(input).key;
}

export function getThemePromotions(): ThemePromotionRecord[] {
  return loadPromotionStore().records;
}
