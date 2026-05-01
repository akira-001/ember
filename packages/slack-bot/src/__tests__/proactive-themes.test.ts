import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { classifyProactiveTheme, observeProactiveTheme } from '../proactive-themes';
import { createDefaultState, validateCandidateDedup } from '../proactive-state';

const PROMOTION_FILE = join(process.cwd(), 'data', 'proactive-theme-promotions.json');

function cleanupPromotions() {
  if (existsSync(PROMOTION_FILE)) unlinkSync(PROMOTION_FILE);
}

describe('proactive theme taxonomy', () => {
  beforeEach(() => cleanupPromotions());
  afterEach(() => cleanupPromotions());

  it('classifies Tokorozawa food-fair and flower topics into different leaf themes', () => {
    const food = classifyProactiveTheme({
      text: '所沢 北海道・九州物産展',
      topic: '所沢 北海道・九州物産展',
      interestCategory: 'local_tokorozawa',
    });
    const flower = classifyProactiveTheme({
      text: '所沢 芝桜と菜の花が見頃',
      topic: '所沢 芝桜と菜の花が見頃',
      interestCategory: 'local_tokorozawa',
    });

    expect(food.key).toBe('local/saitama/tokorozawa/event/food-fair');
    expect(flower.key).toBe('local/saitama/tokorozawa/event/flower-sakura');
    expect(food.path.slice(0, 4)).toEqual(flower.path.slice(0, 4));
  });

  it('classifies more detailed local, sports, AI, business, entertainment, lifestyle, and personal branches', () => {
    const market = classifyProactiveTheme({
      text: '所沢のマルシェと催事が気になる',
      topic: '所沢のマルシェと催事が気になる',
      interestCategory: 'local_tokorozawa',
    });
    const ohtani = classifyProactiveTheme({
      text: '大谷の今季成績と記録が伸びている',
      topic: '大谷の今季成績と記録が伸びている',
      interestCategory: 'dodgers',
    });
    const rag = classifyProactiveTheme({
      text: 'RAGで検索拡張するローカルLLM構成',
      topic: 'RAGで検索拡張するローカルLLM構成',
      interestCategory: 'llm_local',
    });
    const kyoceraProposal = classifyProactiveTheme({
      text: '京セラ向けの提案と見積をまとめる',
      topic: '京セラ向けの提案と見積をまとめる',
    });
    const accenture = classifyProactiveTheme({
      text: 'アクセンチュアの実行力をベンチマークしたい',
      topic: 'アクセンチュアの実行力をベンチマークしたい',
    });
    const documentary = classifyProactiveTheme({
      text: 'ドキュメンタリー番組の密着特集が面白い',
      topic: 'ドキュメンタリー番組の密着特集が面白い',
    });
    const sauna = classifyProactiveTheme({
      text: 'サウナで整うのが最近の楽しみ',
      topic: 'サウナで整うのが最近の楽しみ',
    });
    const privacy = classifyProactiveTheme({
      text: 'ブラウザのプライバシー設定を見直したい',
      topic: 'ブラウザのプライバシー設定を見直したい',
    });

    expect(market.key).toBe('local/saitama/tokorozawa/event/market');
    expect(ohtani.key).toBe('sports/mlb/dodgers/ohtani/stats');
    expect(rag.key).toBe('ai/local-llm/rag');
    expect(kyoceraProposal.key).toBe('business/client/kyocera/proposal');
    expect(accenture.key).toBe('business/benchmark/accenture/delivery');
    expect(documentary.key).toBe('entertainment/movie-drama/tv/documentary');
    expect(sauna.key).toBe('lifestyle/food-wellness/wellness/sauna');
    expect(privacy.key).toBe('personal/travel-tech/browser/privacy');
  });

  it('classifies Dodgers and AI topics into their own branches', () => {
    const dodgers = classifyProactiveTheme({
      text: '大谷、今日もリードオフホームラン',
      topic: '大谷、今日もリードオフホームラン',
      interestCategory: 'dodgers',
    });
    const ai = classifyProactiveTheme({
      text: 'AnthropicのProject Glasswingで重要ソフトウェアのセキュリティを強化',
      topic: 'AnthropicのProject Glasswingで重要ソフトウェアのセキュリティを強化',
      interestCategory: 'ai_agent',
    });

    expect(dodgers.key).toBe('sports/mlb/dodgers/ohtani/home-run');
    expect(ai.key).toBe('ai/enterprise/anthropic/security');
  });

  it('classifies gourmet, entertainment, client, and benchmark topics into the added branches', () => {
    const gourmet = classifyProactiveTheme({
      text: '週末は新しいグルメを食べ歩きしたい',
      topic: '週末は新しいグルメを食べ歩きしたい',
    });
    const ramen = classifyProactiveTheme({
      text: '駅前でラーメンを食べたい',
      topic: '駅前でラーメンを食べたい',
    });
    const sushi = classifyProactiveTheme({
      text: '寿司の新店が気になる',
      topic: '寿司の新店が気になる',
    });
    const sweets = classifyProactiveTheme({
      text: '週末はスイーツ巡りをしたい',
      topic: '週末はスイーツ巡りをしたい',
    });
    const anime = classifyProactiveTheme({
      text: '新作アニメのPVが公開された',
      topic: '新作アニメのPVが公開された',
    });
    const adaptation = classifyProactiveTheme({
      text: '人気漫画のアニメ化が発表された',
      topic: '人気漫画のアニメ化が発表された',
    });
    const tv = classifyProactiveTheme({
      text: 'テレビ番組の特集で取り上げられていた',
      topic: 'テレビ番組の特集で取り上げられていた',
    });
    const drama = classifyProactiveTheme({
      text: '連続ドラマの新作が始まる',
      topic: '連続ドラマの新作が始まる',
    });
    const variety = classifyProactiveTheme({
      text: 'バラエティ番組の特番が面白かった',
      topic: 'バラエティ番組の特番が面白かった',
    });
    const kyocera = classifyProactiveTheme({
      text: '京セラの案件が動きそう',
      topic: '京セラの案件が動きそう',
    });
    const astemo = classifyProactiveTheme({
      text: 'アステモの話が出てきた',
      topic: 'アステモの話が出てきた',
    });
    const nichias = classifyProactiveTheme({
      text: 'ニチアスの保守更新を進める',
      topic: 'ニチアスの保守更新を進める',
    });
    const sanki = classifyProactiveTheme({
      text: '三機工業の案件について確認',
      topic: '三機工業の案件について確認',
    });
    const gmo = classifyProactiveTheme({
      text: 'GMOの案件が戻ってきた',
      topic: 'GMOの案件が戻ってきた',
    });
    const asia = classifyProactiveTheme({
      text: 'アジア航測のGISと測量データを確認したい',
      topic: 'アジア航測のGISと測量データを確認したい',
    });
    const avant = classifyProactiveTheme({
      text: 'アバントの連結会計まわり',
      topic: 'アバントの連結会計まわり',
    });
    const bcg = classifyProactiveTheme({
      text: 'BCGのベンチマークを参考にしたい',
      topic: 'BCGのベンチマークを参考にしたい',
    });

    expect(gourmet.key).toBe('lifestyle/food-wellness/gourmet');
    expect(ramen.key).toBe('lifestyle/food-wellness/gourmet/ramen');
    expect(sushi.key).toBe('lifestyle/food-wellness/gourmet/sushi');
    expect(sweets.key).toBe('lifestyle/food-wellness/gourmet/sweets');
    expect(anime.key).toBe('entertainment/movie-drama/anime/series');
    expect(adaptation.key).toBe('entertainment/movie-drama/anime/adaptation');
    expect(tv.key).toBe('entertainment/movie-drama/tv/program');
    expect(drama.key).toBe('entertainment/movie-drama/tv/drama');
    expect(variety.key).toBe('entertainment/movie-drama/tv/variety');
    expect(kyocera.key).toBe('business/client/kyocera/proposal');
    expect(astemo.key).toBe('business/client/astemo/prototype');
    expect(nichias.key).toBe('business/client/nichias/maintenance');
    expect(sanki.key).toBe('business/client/sanki/site');
    expect(gmo.key).toBe('business/client/gmo/platform');
    expect(asia.key).toBe('business/client/asia-kokuso/gis');
    expect(avant.key).toBe('business/client/avant/reporting');
    expect(bcg.key).toBe('business/benchmark/bcg');
  });

  it('promotes an unseen theme after the second observation', () => {
    const input = {
      text: '銀色のしずくについて考えた',
      topic: '銀色のしずくについて考えた',
    };

    const first = observeProactiveTheme(input);
    expect(first.path[0]).toBe('misc');

    const second = observeProactiveTheme(input);
    expect(second.path[0]).toBe('promoted');

    const third = classifyProactiveTheme(input);
    expect(third.path[0]).toBe('promoted');
    expect(third.key).toBe(second.key);
  });
});

describe('theme deduplication', () => {
  it('blocks a different title when it stays inside the same theme branch', () => {
    const state = createDefaultState();
    state.history.push({
      id: 'old-1',
      category: 'flashback',
      interestCategory: 'local_tokorozawa',
      sentAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      slackTs: 'old-ts-1',
      slackChannel: 'U_TEST',
      reaction: null,
      reactionDelta: 0,
      preview: '所沢 北海道・九州物産展 が開催されるみたい。',
      fullText: '所沢 北海道・九州物産展 が開催されるみたい。',
      sourceUrls: [],
      candidateTopic: '所沢 北海道・九州物産展',
      candidateSource: 'interest-cache',
      skill: 'energy-break',
      sources: [],
    } as any);

    const result = validateCandidateDedup(
      [{ topic: '所沢 芝桜と菜の花が見頃', source: 'interest-cache', score: 0.9 }],
      [{
        topic: '所沢 芝桜と菜の花が見頃',
        source: 'interest-cache',
        category: 'hobby_leisure',
        pub_date: null,
        metadata: {},
        scores: { timeliness: 1, novelty: 1, continuity: 0, emotional_fit: 0, affinity: 0, surprise: 0 },
        finalScore: 0.9,
        reasoning: '',
      } as any],
      state,
      'mei',
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('theme cluster');
  });
});
