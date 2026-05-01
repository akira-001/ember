import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { exec } from 'child_process';
import { join } from 'path';
import { Logger } from './logger';

// cogmem commands run against open-claude project DB
const COGMEM_CWD = process.env.COGMEM_PROJECT || '/Users/akira/workspace/ember';

// --- Types ---

export interface SkillMatch {
  name: string;        // ファイル名（拡張子なし）
  filePath: string;    // .claude/skills/xxx.md
  score: number;       // マッチスコア 0-1
  content: string;     // markdown 全文
  triggers: string[];  // トリガー条件リスト
}

export interface SkillStats {
  effectiveness: number;
  executions: number;
  lastUsed: string | null;
}

export interface LearningLoopResult {
  action: 'update' | 'none';
  skillName?: string;
  details?: string;
}

// --- Proactive skill files (exclude capability-definition skills) ---

const PROACTIVE_SKILLS = new Set([
  'morning-checkin',
  'deadline-reminder',
  'energy-break',
  'hobby-trigger',
  'followup-nudge',
]);

// --- Core Skill Manager ---

export class MementoSkillsManager {
  private logger = new Logger('MementoSkills');
  private skillsDir: string;

  constructor(skillsDir?: string) {
    this.skillsDir = skillsDir || join(process.cwd(), '.claude', 'skills');
    this.logger.info('MementoSkillsManager initialized', { skillsDir: this.skillsDir });
  }

  /**
   * 起動時の初期化: cogmem skills import を非同期実行
   */
  init(): void {
    if (!existsSync(this.skillsDir)) {
      this.logger.warn('Skills directory does not exist', { skillsDir: this.skillsDir });
      return;
    }

    exec(
      `cogmem skills import "${this.skillsDir}" --force --quiet`,
      { timeout: 15000, cwd: COGMEM_CWD },
      (err) => {
        if (err) this.logger.warn('cogmem skills import failed (non-critical)', err);
        else this.logger.info('cogmem skills imported on init');
      },
    );
  }

  /**
   * 読み取りフェーズ: 時間帯 + キーワード + 曜日のルールベースマッチング
   */
  readPhase(context: string, currentHour: number): { matches: SkillMatch[]; analysis: string } {
    const matches: SkillMatch[] = [];

    if (!existsSync(this.skillsDir)) {
      return { matches, analysis: 'Skills directory not found' };
    }

    const files = readdirSync(this.skillsDir).filter((f) => {
      const name = f.replace('.md', '');
      return f.endsWith('.md') && PROACTIVE_SKILLS.has(name);
    });

    const dayOfWeek = new Date().getDay(); // 0=Sun, 5=Fri, 6=Sat

    for (const file of files) {
      const filePath = join(this.skillsDir, file);
      const name = file.replace('.md', '');

      try {
        const content = readFileSync(filePath, 'utf-8');
        const triggers = this.parseTriggers(content);
        let score = 0;

        // 時間帯マッチ
        for (const trigger of triggers) {
          const timeScore = this.matchTimeRange(trigger, currentHour);
          score += timeScore;
        }

        // キーワードマッチ（context にトリガーキーワードが含まれるか）
        for (const trigger of triggers) {
          score += this.matchKeywords(trigger, context);
        }

        // 曜日マッチ
        for (const trigger of triggers) {
          if (/金曜|週末前/.test(trigger) && (dayOfWeek === 5 || dayOfWeek === 6)) {
            score += 0.3;
          }
          if (/土曜|週末/.test(trigger) && dayOfWeek === 6) {
            score += 0.3;
          }
        }

        if (score > 0) {
          matches.push({ name, filePath, score: Math.min(score, 1.0), content, triggers });
        }
      } catch (err) {
        this.logger.warn(`Failed to parse skill: ${file}`, err);
      }
    }

    // スコア順でソート
    matches.sort((a, b) => b.score - a.score);

    const analysis = `readPhase: Found ${matches.length} matching skills (hour=${currentHour}, files=${files.length})`;
    this.logger.info(analysis, {
      matches: matches.map((m) => `${m.name}(${m.score.toFixed(2)})`),
    });

    return { matches, analysis };
  }

  /**
   * スキル使用開始/終了を cogmem skills track に記録
   */
  trackSkillUsage(skillName: string, event: 'skill_start' | 'skill_end', description: string): void {
    const safeDesc = description.replace(/"/g, '\\"').substring(0, 200);
    exec(
      `cogmem skills track "${skillName}" --event ${event} --description "${safeDesc}"`,
      { timeout: 15000, cwd: COGMEM_CWD },
      (err) => {
        if (err) this.logger.debug(`cogmem skills track ${event} failed`, err);
      },
    );
  }

  /**
   * 書き込みフェーズ: Stats 更新
   */
  async writePhase(
    skillName: string | null,
    context: string,
    effectiveness: number,
    userSatisfaction: number,
    feedback: string,
  ): Promise<LearningLoopResult> {
    if (skillName) {
      this.updateSkillStats(skillName, effectiveness);
    }

    const result: LearningLoopResult = skillName
      ? { action: 'update', skillName, details: `effectiveness=${effectiveness.toFixed(2)}` }
      : { action: 'none', details: 'No skill to update' };

    this.logger.info('writePhase completed', result);
    return result;
  }

  // --- Markdown Parsing ---

  private parseTriggers(content: string): string[] {
    const match = content.match(/## トリガー\n([\s\S]*?)(?=\n## |\n$)/);
    if (!match) return [];

    return match[1]
      .split('\n')
      .map((line) => line.replace(/^- /, '').trim())
      .filter((line) => line.length > 0);
  }

  parseStats(content: string): SkillStats {
    const defaults: SkillStats = { effectiveness: 0.5, executions: 0, lastUsed: null };

    const statsMatch = content.match(/## Stats\n([\s\S]*?)(?=\n## |\n$)/);
    if (!statsMatch) return defaults;

    const section = statsMatch[1];
    const effMatch = section.match(/effectiveness:\s*([\d.]+)/);
    const execMatch = section.match(/executions:\s*(\d+)/);
    const lastMatch = section.match(/last_used:\s*(\S+)/);

    return {
      effectiveness: effMatch ? parseFloat(effMatch[1]) : defaults.effectiveness,
      executions: execMatch ? parseInt(execMatch[1], 10) : defaults.executions,
      lastUsed: lastMatch && lastMatch[1] !== 'null' ? lastMatch[1] : null,
    };
  }

  private replaceStatsSection(content: string, stats: SkillStats): string {
    const newStats = `## Stats
- effectiveness: ${stats.effectiveness.toFixed(2)}
- executions: ${stats.executions}
- last_used: ${stats.lastUsed || 'null'}`;

    if (content.includes('## Stats')) {
      return content.replace(/## Stats\n[\s\S]*?(?=\n## |\s*$)/, newStats);
    }
    return content.trimEnd() + '\n\n' + newStats + '\n';
  }

  private updateSkillStats(skillName: string, effectiveness: number): void {
    const filePath = join(this.skillsDir, `${skillName}.md`);
    if (!existsSync(filePath)) {
      this.logger.warn(`Skill file not found: ${skillName}`);
      return;
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      const stats = this.parseStats(content);

      // 移動平均で effectiveness 更新
      const alpha = 0.3;
      stats.effectiveness = alpha * effectiveness + (1 - alpha) * stats.effectiveness;
      stats.executions += 1;
      stats.lastUsed = new Date().toISOString();

      const updated = this.replaceStatsSection(content, stats);
      writeFileSync(filePath, updated);

      this.logger.info(`Updated skill stats: ${skillName}`, {
        effectiveness: stats.effectiveness.toFixed(2),
        executions: stats.executions,
      });

      // 非同期で cogmem に再インデックス
      exec(
        `cogmem skills import "${this.skillsDir}" --force --quiet`,
        { timeout: 15000, cwd: COGMEM_CWD },
        () => {},
      );
    } catch (err) {
      this.logger.error(`Failed to update skill stats: ${skillName}`, err);
    }
  }

  // --- Rule-based Matching ---

  private matchTimeRange(triggerText: string, hour: number): number {
    // "朝9-10時" "14-17時" "9時" "17時" 等をパース
    const rangeMatch = triggerText.match(/(\d{1,2})[時\-][-~]?(\d{1,2})時/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      if (hour >= start && hour < end) return 0.4;
      // 1時間前後の近接ボーナス
      if (hour === start - 1 || hour === end) return 0.1;
      return 0;
    }

    // "11時" 単体
    const singleMatch = triggerText.match(/(\d{1,2})時/);
    if (singleMatch) {
      const target = parseInt(singleMatch[1], 10);
      if (hour === target) return 0.4;
      if (Math.abs(hour - target) === 1) return 0.1;
    }

    // "朝" "午後" 等の曖昧な時間表現
    if (/朝/.test(triggerText) && hour >= 7 && hour <= 10) return 0.2;
    if (/午後/.test(triggerText) && hour >= 12 && hour <= 17) return 0.2;
    if (/夕方/.test(triggerText) && hour >= 16 && hour <= 19) return 0.2;

    return 0;
  }

  private matchKeywords(triggerText: string, context: string): number {
    const contextLower = context.toLowerCase();
    const keywords = [
      'メール', 'mail', 'email', '未返信', '返信',
      'カレンダー', 'calendar', '予定', '会議', 'meeting',
      'deadline', '締切', '期限', '納期',
      'ドジャース', 'dodgers', '温泉', 'キャンプ', '猫',
      'slack', 'メッセージ', '未読',
      '休憩', 'break', '疲',
    ];

    let matchCount = 0;
    for (const kw of keywords) {
      if (triggerText.includes(kw) && contextLower.includes(kw.toLowerCase())) {
        matchCount++;
      }
    }

    return Math.min(matchCount * 0.15, 0.6);
  }
}
