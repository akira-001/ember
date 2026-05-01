import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Logger } from './logger';

interface CmuxNotification {
  id: string;
  workspace: string;
  surface: string;
  status: string;
  title: string;
  subtitle: string;
  body: string;
}

const BRIDGE_DIR = path.join(process.env.HOME || '/Users/akira', '.cmux-bridge');

export class CmuxHandler {
  private logger = new Logger('CmuxHandler');
  private pendingReplies: Map<string, string> = new Map();

  /**
   * Execute a cmux command via file-based bridge.
   * Each request gets a unique ID to prevent response file races.
   */
  private execCmux(command: string): string {
    if (!fs.existsSync(BRIDGE_DIR)) fs.mkdirSync(BRIDGE_DIR, { recursive: true });

    const reqId = crypto.randomBytes(4).toString('hex');
    const requestFile = path.join(BRIDGE_DIR, `request-${reqId}`);
    const responseFile = path.join(BRIDGE_DIR, `response-${reqId}`);

    fs.writeFileSync(requestFile, command);

    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      try {
        if (fs.existsSync(responseFile) && fs.statSync(responseFile).size > 0) {
          const result = fs.readFileSync(responseFile, 'utf-8');
          try { fs.unlinkSync(responseFile); } catch {}
          try { fs.unlinkSync(requestFile); } catch {}
          return result;
        }
      } catch {}
      execSync('sleep 0.3');
    }

    try { fs.unlinkSync(requestFile); } catch {}
    throw new Error('cmux bridge timeout');
  }

  isCmuxCommand(text: string): boolean {
    const t = text.trim().toLowerCase();
    return t === 'cmux' || t.startsWith('cmux ');
  }

  hasPendingReply(threadTs: string): boolean {
    return this.pendingReplies.has(threadTs);
  }

  async getNotifications(): Promise<{ message: string; surfaces: Array<{ surface: string; content: string }> }> {
    // Auto-start bridge if not running
    if (!this.isBridgeRunning()) {
      this.logger.info('Bridge not running, attempting auto-start via nohup');
      this.startBridgeProcess();
      const bridgeDeadline = Date.now() + 5000;
      while (Date.now() < bridgeDeadline && !this.isBridgeRunning()) {
        execSync('sleep 0.5');
      }
      if (!this.isBridgeRunning()) {
        return { message: 'cmuxブリッジの自動起動に失敗した。cmuxで新しいタブを開いてみて。', surfaces: [] };
      }
    }

    let notifOutput: string;
    try {
      notifOutput = this.execCmux('list-notifications');
    } catch (error) {
      this.logger.error('Failed to get cmux notifications', error);
      return { message: 'cmuxブリッジに接続できなかった。', surfaces: [] };
    }

    const notifications = this.parseNotificationOutput(notifOutput);
    if (notifications.length === 0) {
      return { message: 'cmux通知なし。', surfaces: [] };
    }

    const terminalNotifs: Array<{ surface: string; content: string }> = [];

    for (const notif of notifications) {
      try {
        const screen = this.execCmux(`read-screen --surface ${notif.surface} --lines 30`);
        if (screen.includes('Error:')) continue; // not a terminal
        terminalNotifs.push({ surface: notif.surface, content: screen.trim() });
      } catch {
        // timeout or error, skip
      }
    }

    if (terminalNotifs.length === 0) {
      return { message: `cmux通知 ${notifications.length}件あるけど、ターミナルの入力待ちはなし。`, surfaces: [] };
    }

    let message = `*cmux入力待ち: ${terminalNotifs.length}件*\n\n`;
    for (let i = 0; i < terminalNotifs.length; i++) {
      const t = terminalNotifs[i];
      const lines = t.content.split('\n').filter(l => l.trim());
      const preview = lines.slice(-15).join('\n');
      message += `*[${i + 1}] Surface: \`${t.surface.substring(0, 8)}...\`*\n\`\`\`\n${preview}\n\`\`\`\n\n`;
    }
    message += 'スレッドに返信すると最初のセッションに送信するよ。\n番号指定もできる: `2 A` で2番目のセッションにAを送信。';

    return { message, surfaces: terminalNotifs };
  }

  registerThread(threadTs: string, surfaces: Array<{ surface: string; content: string }>) {
    if (surfaces.length > 0) {
      this.pendingReplies.set(threadTs, surfaces[0].surface);
      for (let i = 0; i < surfaces.length; i++) {
        this.pendingReplies.set(`${threadTs}:${i + 1}`, surfaces[i].surface);
      }
    }
  }

  async sendNumberedReply(threadTs: string, text: string): Promise<string> {
    let surface: string | undefined;
    let replyText = text;

    const match = text.match(/^(\d+)\s+(.+)$/);
    if (match) {
      surface = this.pendingReplies.get(`${threadTs}:${match[1]}`);
      if (surface) replyText = match[2];
    }
    if (!surface) surface = this.pendingReplies.get(threadTs);
    if (!surface) return 'このスレッドに紐付いたcmuxセッションが見つからない。';

    try {
      this.execCmux(`send --surface ${surface} -- ${replyText}`);
      this.logger.info('Sent reply to cmux', { surface, text: replyText });
      return `送信した: \`${replyText}\` → \`${surface.substring(0, 8)}...\``;
    } catch (error) {
      this.logger.error('Failed to send to cmux', error);
      return 'cmuxへの送信に失敗した。';
    }
  }

  private isBridgeRunning(): boolean {
    try {
      const out = execSync("pgrep -f 'cmux-bridge/bridge.sh'", { encoding: 'utf-8', timeout: 3000 }).trim();
      return out.length > 0;
    } catch { return false; }
  }

  private startBridgeProcess(): void {
    try {
      const bridgeScript = path.join(BRIDGE_DIR, 'bridge.sh');
      const logFile = path.join(BRIDGE_DIR, 'bridge.log');
      execSync(`nohup "${bridgeScript}" > "${logFile}" 2>&1 &`, { timeout: 5000 });
      this.logger.info('Bridge process started via nohup');
    } catch (error) {
      this.logger.error('Failed to start bridge process', error);
    }
  }

  private parseNotificationOutput(output: string): CmuxNotification[] {
    if (!output.trim()) return [];

    return output.trim().split('\n').map(line => {
      const parts = line.split('|');
      const idPart = parts[0] || '';
      const id = idPart.includes(':') ? idPart.split(':').slice(1).join(':') : idPart;
      return {
        id,
        workspace: parts[1] || '',
        surface: parts[2] || '',
        status: parts[3] || '',
        title: parts[4] || '',
        subtitle: parts[5] || '',
        body: parts[6] || '',
      };
    });
  }
}
