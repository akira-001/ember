import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const cronJobs = JSON.parse(
  readFileSync(join(__dirname, '../../cron-jobs.json'), 'utf-8')
);

describe('cron-jobs.json proactive-checkin', () => {
  const job = cronJobs.jobs.find((j: any) => j.name === 'proactive-checkin');

  it('should have a proactive-checkin job', () => {
    expect(job).toBeDefined();
  });

  it('should run every hour from 8 to 23', () => {
    expect(job.cron).toBe('0 8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23 * * *');
  });

  it('should target Akira DM', () => {
    expect(job.slackTarget).toBe('U3SFGQXNH');
  });

  it('should be enabled', () => {
    expect(job.enabled).toBe(true);
  });

  it('should have empty message (proactive agent handles its own prompt)', () => {
    expect(job.message).toBe('');
  });

  it('should use Asia/Tokyo timezone', () => {
    expect(job.tz).toBe('Asia/Tokyo');
  });
});

describe('cron-jobs.json proactive-checkin-eve', () => {
  const job = cronJobs.jobs.find((j: any) => j.name === 'proactive-checkin-eve');

  it('should exist and be enabled', () => {
    expect(job).toBeDefined();
    expect(job.enabled).toBe(true);
  });

  it('should run every hour at :30 from 8 to 23', () => {
    expect(job.cron).toBe('30 8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23 * * *');
  });
});
