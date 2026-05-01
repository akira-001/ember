import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const INDEX_SOURCE = readFileSync(
  join(__dirname, '../index.ts'),
  'utf-8'
);

describe('index.ts BotOrchestrator integration', () => {
  it('should import BotOrchestrator', () => {
    expect(INDEX_SOURCE).toContain('BotOrchestrator');
  });

  it('should instantiate BotOrchestrator', () => {
    expect(INDEX_SOURCE).toContain('new BotOrchestrator');
  });

  it('should load bot configs', () => {
    expect(INDEX_SOURCE).toContain('loadBotConfigs');
  });

  it('should call orchestrator.start()', () => {
    expect(INDEX_SOURCE).toContain('orchestrator.start()');
  });
});
