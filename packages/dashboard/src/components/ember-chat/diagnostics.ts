import type { ChatMessage, DiagnosticEvent, DiagnosticKind } from './types';

function normalizeKind(label: string): DiagnosticKind {
  const lower = label.toLowerCase();
  if (lower.startsWith('stt/')) return 'stt';
  if (lower === 'stt_correct') return 'stt_correction';
  if (lower === 'ambient') return 'ambient';
  if (lower === 'batch') return 'batch';
  if (lower === 'hallucination') return 'hallucination';
  if (lower.startsWith('tts')) return 'tts_eval';
  if (lower.includes('audio')) return 'audio';
  return 'unknown';
}

function trimQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, '').trim();
}

function parseLatency(detail: string): number | undefined {
  const match = detail.match(/\+(\d+(?:\.\d+)?)s\)/);
  return match ? Number(match[1]) : undefined;
}

function parseSimilarity(detail: string): number | undefined {
  const match = detail.match(/similarity[=:](\d+(?:\.\d+)?)/i);
  return match ? Number(match[1]) : undefined;
}

function parseRisk(detail: string): 'low' | 'medium' | 'high' | undefined {
  const match = detail.match(/risk[=:](low|medium|high)/i);
  return match ? match[1].toLowerCase() as 'low' | 'medium' | 'high' : undefined;
}

function parseReading(detail: string): 'ok' | 'warn' | 'fail' | undefined {
  const match = detail.match(/reading[=:](ok|warn|fail)/i);
  return match ? match[1].toLowerCase() as 'ok' | 'warn' | 'fail' : undefined;
}

export function parseDiagnosticLine(raw: string): DiagnosticEvent | null {
  const text = raw.trim();
  const match = text.match(/^(?:(\d{2}:\d{2}:\d{2})\s+)?\[([^\]]+)\]\s*(.*)$/);
  if (!match) return null;

  const [, timeLabel, label, detail] = match;
  const kind = normalizeKind(label);
  const event: DiagnosticEvent = {
    kind,
    label,
    timeLabel,
    summary: detail || label,
    raw: text,
  };

  if (kind === 'stt_correction') {
    const correction = detail.match(/'(.+?)'\s*→\s*'(.+?)'/);
    if (correction) {
      event.originalText = correction[1];
      event.correctedText = correction[2];
      event.summary = 'STT補正が適用されたよ';
      event.reason = 'rawと補正後を比較して確認';
    }
    return event;
  }

  if (kind === 'stt') {
    const transcriptMatch = detail.match(/'(.+?)'/);
    if (transcriptMatch) event.transcript = transcriptMatch[1];
    event.latencySec = parseLatency(detail);
    event.summary = event.transcript || detail || 'STT結果';
    event.potentialFalseTrigger = false;
    return event;
  }

  if (kind === 'ambient') {
    event.source = detail.match(/source=([^\s]+)/)?.[1];
    event.model = detail.match(/model=([^\s]+)/)?.[1];
    event.method = detail.match(/method=([^\s]+)/)?.[1];
    const quotedText = detail.match(/text='(.+?)'/);
    if (quotedText) event.transcript = quotedText[1];

    if (/buffered/i.test(detail)) {
      event.action = 'buffer';
      event.summary = '判定保留でバッファ中';
    } else if (/SKIP/i.test(detail)) {
      event.action = 'skip';
      event.reason = detail.match(/\((.+?)\)/)?.[1];
      event.summary = event.reason ? `${event.reason}として除外` : '介入をスキップ';
    } else if (/reply/i.test(detail)) {
      event.action = 'reply';
      event.summary = '会話として応答候補に進んだ';
    } else if (/backchannel/i.test(detail)) {
      event.action = 'backchannel';
      event.summary = '相槌として応答候補に進んだ';
    } else {
      event.action = 'unknown';
      event.summary = detail || 'ambient判定';
    }

    const sourceDetail = `${event.source || ''} ${event.reason || ''} ${event.transcript || ''}`.toLowerCase();
    event.potentialFalseTrigger =
      event.action === 'reply' ||
      event.action === 'backchannel' ||
      sourceDetail.includes('media') ||
      sourceDetail.includes('music') ||
      sourceDetail.includes('tv');
    return event;
  }

  if (kind === 'batch') {
    event.summary = detail || 'バッチ判定';
    return event;
  }

  if (kind === 'hallucination') {
    const audioBytes = detail.match(/audio=(\d+)bytes/i);
    event.audioBytes = audioBytes ? Number(audioBytes[1]) : undefined;
    event.action = 'skip';
    event.summary = /no text/i.test(detail)
      ? 'テキストなし音声をフィルタ'
      : detail || 'hallucinationをフィルタ';
    return event;
  }

  if (kind === 'tts_eval') {
    const inputText = detail.match(/input='(.+?)'/)?.[1];
    const retranscribedText = detail.match(/retranscribed='(.+?)'/)?.[1];
    const durationSec = detail.match(/duration[=:](\d+(?:\.\d+)?)/i);
    const peakDb = detail.match(/peak_db[=:](-?\d+(?:\.\d+)?)/i);
    event.summary = '発声品質を評価';
    event.tts = {
      inputText,
      retranscribedText,
      similarity: parseSimilarity(detail),
      readingMatch: parseReading(detail),
      durationSec: durationSec ? Number(durationSec[1]) : undefined,
      peakDb: peakDb ? Number(peakDb[1]) : undefined,
      clipped: /clipped[=:](true|1|yes)/i.test(detail),
      risk: parseRisk(detail),
    };
    return event;
  }

  return event;
}

export interface DiagnosticSummary {
  corrections: number;
  mediaSkips: number;
  hallucinations: number;
  possibleFalseTriggers: number;
  ttsWarnings: number;
}

export function summarizeDiagnostics(messages: ChatMessage[]): DiagnosticSummary {
  return messages.reduce<DiagnosticSummary>((acc, msg) => {
    const diagnostic = msg.diagnostic;
    if (!diagnostic) return acc;
    if (diagnostic.kind === 'stt_correction') acc.corrections += 1;
    if (diagnostic.kind === 'hallucination') acc.hallucinations += 1;
    if (diagnostic.kind === 'ambient' && diagnostic.action === 'skip' && diagnostic.reason?.toLowerCase().includes('media')) {
      acc.mediaSkips += 1;
    }
    if (diagnostic.potentialFalseTrigger && diagnostic.action !== 'skip') {
      acc.possibleFalseTriggers += 1;
    }
    if (diagnostic.kind === 'tts_eval') {
      const tts = diagnostic.tts;
      if (tts?.risk === 'high' || tts?.readingMatch === 'fail' || tts?.clipped) {
        acc.ttsWarnings += 1;
      }
    }
    return acc;
  }, {
    corrections: 0,
    mediaSkips: 0,
    hallucinations: 0,
    possibleFalseTriggers: 0,
    ttsWarnings: 0,
  });
}

export function buildStatusDiagnostic(text: string): DiagnosticEvent | null {
  const diagnostic = parseDiagnosticLine(text);
  if (diagnostic) return diagnostic;

  const normalized = text.toLowerCase();
  if (!normalized.includes('ambient') && !normalized.includes('stt') && !normalized.includes('tts')) {
    return null;
  }

  return {
    kind: 'unknown',
    label: 'status',
    summary: text,
    raw: text,
  };
}

export function describeInterventionRisk(diagnostic: DiagnosticEvent): string | null {
  if (diagnostic.kind !== 'ambient') return null;
  if (diagnostic.action === 'skip') return '誤反応は防げているよ';
  if (diagnostic.potentialFalseTrigger) return '環境音を会話として扱うリスクあり';
  return null;
}

export function formatPercent(value?: number): string | null {
  if (value == null || Number.isNaN(value)) return null;
  const normalized = value <= 1 ? value * 100 : value;
  return `${Math.round(normalized)}%`;
}

export function formatSeconds(value?: number): string | null {
  if (value == null || Number.isNaN(value)) return null;
  return `${value.toFixed(1)}s`;
}

export function formatDb(value?: number): string | null {
  if (value == null || Number.isNaN(value)) return null;
  return `${value.toFixed(1)} dB`;
}

export function titleForDiagnostic(diagnostic: DiagnosticEvent): string {
  switch (diagnostic.kind) {
    case 'stt':
      return '音声認識';
    case 'stt_correction':
      return '認識補正';
    case 'ambient':
      return 'Ambient判定';
    case 'batch':
      return 'Batch判定';
    case 'hallucination':
      return '誤認識フィルタ';
    case 'tts_eval':
      return '発声品質';
    case 'thought':
      return '内なる声';
    default:
      return diagnostic.label;
  }
}

export function compactLabel(value: string): string {
  return trimQuotes(value);
}
