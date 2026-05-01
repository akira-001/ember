import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import crypto from 'crypto';
import { EventBus } from '../src/event-bus';
import { GitHubWebhook } from '../src/event-sources/github-webhook';

function sign(payload: string, secret: string): string {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload, 'utf8');
  return `sha256=${hmac.digest('hex')}`;
}

describe('GitHubWebhook', () => {
  const SECRET = 'test-webhook-secret';
  let bus: EventBus;
  let webhook: GitHubWebhook;
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    bus = new EventBus();
    webhook = new GitHubWebhook(bus, { enabled: true, webhookSecret: SECRET });
    app = express();
    webhook.mountRoutes(app);
  });

  it('has correct source metadata', () => {
    const status = webhook.getStatus();
    expect(status.name).toBe('github');
    expect(status.type).toBe('webhook');
    expect(status.enabled).toBe(true);
  });

  it('rejects requests with invalid signature (401)', async () => {
    const body = JSON.stringify({ action: 'opened' });

    const res = await request(app)
      .post('/api/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', 'sha256=invalidsignature')
      .set('X-GitHub-Event', 'issues')
      .set('X-GitHub-Delivery', 'delivery-bad')
      .send(body);

    expect(res.status).toBe(401);
  });

  it('handles pr_merged event (pull_request closed + merged)', async () => {
    const handler = vi.fn();
    bus.on('pr_merged', handler);

    const body = JSON.stringify({
      action: 'closed',
      pull_request: {
        merged: true,
        number: 42,
        title: 'Fix bug',
        html_url: 'https://github.com/foo/bar/pull/42',
      },
      repository: { full_name: 'foo/bar' },
    });

    const res = await request(app)
      .post('/api/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign(body, SECRET))
      .set('X-GitHub-Event', 'pull_request')
      .set('X-GitHub-Delivery', 'delivery-1')
      .send(body);

    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0];
    expect(event.source).toBe('github');
    expect(event.type).toBe('pr_merged');
    expect(event.priority).toBe('high');
    expect(event.dedupKey).toBe('github:delivery-1');
    expect(event.data.number).toBe(42);
  });

  it('handles push event', async () => {
    const handler = vi.fn();
    bus.on('push', handler);

    const body = JSON.stringify({
      ref: 'refs/heads/main',
      commits: [{ message: 'update' }],
      repository: { full_name: 'foo/bar' },
      pusher: { name: 'octocat' },
    });

    const res = await request(app)
      .post('/api/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign(body, SECRET))
      .set('X-GitHub-Event', 'push')
      .set('X-GitHub-Delivery', 'delivery-2')
      .send(body);

    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0];
    expect(event.type).toBe('push');
    expect(event.priority).toBe('low');
  });

  it('handles issues event', async () => {
    const handler = vi.fn();
    bus.on('issue_opened', handler);

    const body = JSON.stringify({
      action: 'opened',
      issue: {
        number: 10,
        title: 'Bug report',
        html_url: 'https://github.com/foo/bar/issues/10',
      },
      repository: { full_name: 'foo/bar' },
    });

    const res = await request(app)
      .post('/api/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign(body, SECRET))
      .set('X-GitHub-Event', 'issues')
      .set('X-GitHub-Delivery', 'delivery-3')
      .send(body);

    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0];
    expect(event.type).toBe('issue_opened');
    expect(event.priority).toBe('medium');
  });

  it('ignores unhandled events with 200', async () => {
    const handler = vi.fn();
    bus.on('*', handler);

    const body = JSON.stringify({ action: 'created' });

    const res = await request(app)
      .post('/api/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign(body, SECRET))
      .set('X-GitHub-Event', 'star')
      .set('X-GitHub-Delivery', 'delivery-4')
      .send(body);

    expect(res.status).toBe(200);
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not emit for non-merged PR close', async () => {
    const handler = vi.fn();
    bus.on('pr_merged', handler);

    const body = JSON.stringify({
      action: 'closed',
      pull_request: {
        merged: false,
        number: 99,
        title: 'Rejected PR',
        html_url: 'https://github.com/foo/bar/pull/99',
      },
      repository: { full_name: 'foo/bar' },
    });

    const res = await request(app)
      .post('/api/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign(body, SECRET))
      .set('X-GitHub-Event', 'pull_request')
      .set('X-GitHub-Delivery', 'delivery-5')
      .send(body);

    expect(res.status).toBe(200);
    expect(handler).not.toHaveBeenCalled();
  });
});
