export interface CronFields {
  minute: number;
  hours: number[];       // [] = wildcard (*)
  daysOfWeek: number[];  // [] = wildcard (*), 0=Sun..6=Sat
}

const ALL_HOURS = Array.from({ length: 24 }, (_, i) => i);
const ALL_DAYS = Array.from({ length: 7 }, (_, i) => i);

export function parseCron(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/);
  const minuteStr = parts[0] || '0';
  const hourStr = parts[1] || '*';
  const dowStr = parts[4] || '*';

  const minute = /^\d+$/.test(minuteStr) ? Math.min(59, Math.max(0, parseInt(minuteStr, 10))) : 0;

  const hours = hourStr === '*'
    ? []
    : hourStr.split(',').map(Number).filter(n => !isNaN(n) && n >= 0 && n <= 23).sort((a, b) => a - b);

  const daysOfWeek = dowStr === '*'
    ? []
    : dowStr.split(',').map(Number).filter(n => !isNaN(n) && n >= 0 && n <= 6).sort((a, b) => a - b);

  return { minute, hours, daysOfWeek };
}

export function serializeCron(fields: CronFields): string {
  const min = Math.min(59, Math.max(0, fields.minute));
  const hrs = fields.hours.length === 0 || fields.hours.length === 24
    ? '*'
    : [...fields.hours].sort((a, b) => a - b).join(',');
  const dow = fields.daysOfWeek.length === 0 || fields.daysOfWeek.length === 7
    ? '*'
    : [...fields.daysOfWeek].sort((a, b) => a - b).join(',');
  return `${min} ${hrs} * * ${dow}`;
}

const DOW_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

export function describeCron(fields: CronFields): string {
  const { minute, hours, daysOfWeek } = fields;

  // Day part
  let dayDesc: string;
  if (daysOfWeek.length === 0 || daysOfWeek.length === 7) {
    dayDesc = '毎日';
  } else {
    dayDesc = '毎週' + daysOfWeek.map(d => DOW_NAMES[d]).join('');
  }

  // Time part
  let timeDesc: string;
  if (hours.length === 0) {
    timeDesc = `毎時${minute > 0 ? minute + '分' : ''}`;
  } else if (hours.length <= 5) {
    timeDesc = hours.map(h => `${h}:${String(minute).padStart(2, '0')}`).join(', ');
  } else {
    const min = Math.min(...hours);
    const max = Math.max(...hours);
    timeDesc = `${min}〜${max}時 (${hours.length}回)`;
    if (minute > 0) timeDesc += ` 毎時${minute}分`;
  }

  return `${dayDesc} ${timeDesc}`;
}

export function isAllHours(hours: number[]): boolean {
  return hours.length === 0 || hours.length === 24;
}

export function isAllDays(days: number[]): boolean {
  return days.length === 0 || days.length === 7;
}

export function toggleInArray(arr: number[], value: number, allValues: number[]): number[] {
  const isWildcard = arr.length === 0;
  const expanded = isWildcard ? [...allValues] : [...arr];

  const idx = expanded.indexOf(value);
  if (idx >= 0) {
    expanded.splice(idx, 1);
  } else {
    expanded.push(value);
    expanded.sort((a, b) => a - b);
  }

  // If all selected, collapse to wildcard
  if (expanded.length === allValues.length) return [];
  return expanded;
}

/**
 * Cron式を非エンジニア向けの日本語に変換する。
 * 5フィールド: 分 時 日 月 曜日
 */
export function describeCronExpr(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return expr;
  const [minStr, hourStr, domStr, monStr, dowStr] = parts;

  // 分
  const min = /^\d+$/.test(minStr) ? parseInt(minStr, 10) : -1;
  const minPad = min >= 0 ? String(min).padStart(2, '0') : '';

  // 時
  const isEveryHour = hourStr === '*';
  const hours = isEveryHour ? [] : hourStr.split(',').map(Number).filter(n => !isNaN(n));

  // 曜日
  const isEveryDow = dowStr === '*';
  const dows = isEveryDow ? [] : dowStr.split(',').map(Number).filter(n => !isNaN(n));

  // 日
  const isEveryDom = domStr === '*';
  const doms = isEveryDom ? [] : domStr.split(',').map(Number).filter(n => !isNaN(n));

  // 月
  const isEveryMon = monStr === '*';

  // --- 頻度 ---
  let freq: string;
  if (!isEveryDow && dows.length > 0) {
    freq = '毎週' + dows.map(d => DOW_NAMES[d] || String(d)).join('・') + '曜';
  } else if (!isEveryDom && doms.length > 0) {
    freq = '毎月' + doms.join('・') + '日';
  } else {
    freq = '毎日';
  }

  // --- 時刻 ---
  let time: string;
  if (isEveryHour) {
    time = min > 0 ? `毎時${min}分` : '毎時';
  } else if (hours.length === 1) {
    time = `${hours[0]}:${minPad}`;
  } else if (hours.length <= 4) {
    time = hours.map(h => `${h}:${minPad}`).join('・');
  } else {
    time = `${Math.min(...hours)}〜${Math.max(...hours)}時（${hours.length}回/日）`;
  }

  return `${freq} ${time}`;
}

export { ALL_HOURS, ALL_DAYS };
