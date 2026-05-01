import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const BOT_CONFIGS_PATH = join(process.cwd(), 'data', 'bot-configs.json');
const DEFAULT_TIMEZONE = 'Asia/Tokyo';

export function getTimezone(): string {
  try {
    if (existsSync(BOT_CONFIGS_PATH)) {
      const configs = JSON.parse(readFileSync(BOT_CONFIGS_PATH, 'utf-8'));
      return configs?.global?.timezone || DEFAULT_TIMEZONE;
    }
  } catch {}
  return DEFAULT_TIMEZONE;
}

export function getDateInTz(date?: Date): string {
  return (date || new Date()).toLocaleDateString('sv-SE', { timeZone: getTimezone() });
}

export function getTimeInTz(date?: Date): string {
  return (date || new Date()).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: getTimezone() });
}

export function getDateTimeInTz(date?: Date, options?: Intl.DateTimeFormatOptions): string {
  return (date || new Date()).toLocaleString('ja-JP', { timeZone: getTimezone(), ...options });
}
