import { describe, it, expect } from 'vitest';
import { parseDecisionLog } from '../src/proactive-state';

describe('topicWeight parsing', () => {
  it('parses topicWeight from decision log', () => {
    const json = JSON.stringify({
      decision: 'send',
      need: 'test',
      reason: 'test',
      candidates: [],
      message: 'hello',
      topicWeight: 'heavy',
      premise: { estimatedMode: 'test', modeReason: '', targetLayer: 1, layerReason: '', interventionType: '', interventionReason: '', reason: '', informationGap: null, collectionHint: null },
    });
    const result = parseDecisionLog(json);
    expect(result).not.toBeNull();
    expect(result!.topicWeight).toBe('heavy');
  });

  it('defaults to medium when topicWeight is missing', () => {
    const json = JSON.stringify({
      decision: 'send',
      need: 'test',
      reason: 'test',
      candidates: [],
      message: 'hello',
    });
    const result = parseDecisionLog(json);
    expect(result).not.toBeNull();
    expect(result!.topicWeight).toBe('medium');
  });

  it('defaults to medium when topicWeight is invalid', () => {
    const json = JSON.stringify({
      decision: 'send',
      need: 'test',
      reason: 'test',
      candidates: [],
      message: 'hello',
      topicWeight: 'extreme',
    });
    const result = parseDecisionLog(json);
    expect(result!.topicWeight).toBe('medium');
  });
});
