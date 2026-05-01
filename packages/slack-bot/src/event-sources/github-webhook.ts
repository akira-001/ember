import { randomUUID, createHmac, timingSafeEqual } from 'crypto';
import type { Express, Request, Response } from 'express';
import express from 'express';
import { Logger } from '../logger';
import type { EventBus } from '../event-bus';
import type { EventSource, EventSourceConfig, EventSourceStatus, ProactiveEvent } from './types';

export class GitHubWebhook implements EventSource {
  name = 'github';
  type = 'webhook' as const;
  enabled: boolean;

  private bus: EventBus;
  private webhookSecret: string;
  private logger = new Logger('GitHubWebhook');
  private lastEventAt: string | null = null;
  private errorCount = 0;
  private lastError: string | null = null;
  private running = false;

  constructor(bus: EventBus, config: EventSourceConfig['github']) {
    this.bus = bus;
    this.webhookSecret = config.webhookSecret;
    this.enabled = config.enabled;
  }

  mountRoutes(app: Express): void {
    app.post(
      '/api/webhooks/github',
      express.json({
        verify: (req: Request, _res: Response, buf: Buffer) => {
          // Stash raw body for signature verification
          (req as any).rawBody = buf;
        },
      }),
      (req: Request, res: Response) => {
        try {
          // Verify signature
          const signature = req.headers['x-hub-signature-256'] as string | undefined;
          const rawBody = (req as any).rawBody as Buffer;

          if (!signature || !rawBody) {
            res.status(401).json({ error: 'Missing signature' });
            return;
          }

          const expected = `sha256=${createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex')}`;

          const sigBuf = Buffer.from(signature);
          const expectedBuf = Buffer.from(expected);
          if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
            res.status(401).json({ error: 'Invalid signature' });
            return;
          }

          const eventType = req.headers['x-github-event'] as string;
          const deliveryId = req.headers['x-github-delivery'] as string;
          const payload = req.body;

          this.handleEvent(eventType, deliveryId, payload);
          res.status(200).json({ ok: true });
        } catch (err) {
          this.errorCount++;
          this.lastError = err instanceof Error ? err.message : String(err);
          this.logger.error('GitHub webhook handler error', err);
          res.status(500).json({ error: 'Internal error' });
        }
      },
    );
    this.running = true;
  }

  private handleEvent(eventType: string, deliveryId: string, payload: any): void {
    const dedupKey = `github:${deliveryId}`;
    const repo = payload.repository?.full_name ?? 'unknown';

    if (eventType === 'pull_request') {
      if (payload.action === 'closed' && payload.pull_request?.merged) {
        const pr = payload.pull_request;
        const event: ProactiveEvent = {
          id: randomUUID(),
          source: 'github',
          type: 'pr_merged',
          data: {
            number: pr.number,
            title: pr.title,
            url: pr.html_url,
            repo,
          },
          timestamp: new Date().toISOString(),
          priority: 'high',
          dedupKey,
        };
        this.lastEventAt = event.timestamp;
        this.bus.emit(event);
      }
      // Non-merged close: ignore
    } else if (eventType === 'push') {
      const event: ProactiveEvent = {
        id: randomUUID(),
        source: 'github',
        type: 'push',
        data: {
          ref: payload.ref,
          commits: payload.commits?.length ?? 0,
          pusher: payload.pusher?.name ?? 'unknown',
          repo,
        },
        timestamp: new Date().toISOString(),
        priority: 'low',
        dedupKey,
      };
      this.lastEventAt = event.timestamp;
      this.bus.emit(event);
    } else if (eventType === 'issues') {
      const issue = payload.issue;
      const action = payload.action;
      const event: ProactiveEvent = {
        id: randomUUID(),
        source: 'github',
        type: `issue_${action}`,
        data: {
          number: issue?.number,
          title: issue?.title,
          url: issue?.html_url,
          action,
          repo,
        },
        timestamp: new Date().toISOString(),
        priority: 'medium',
        dedupKey,
      };
      this.lastEventAt = event.timestamp;
      this.bus.emit(event);
    } else {
      this.logger.debug(`Ignoring GitHub event: ${eventType}`);
    }
  }

  async start(): Promise<void> {
    // Webhook routes are mounted separately via mountRoutes()
    this.logger.info('GitHub webhook source started (routes must be mounted on Express app)');
  }

  async stop(): Promise<void> {
    this.running = false;
    this.logger.info('GitHub webhook source stopped');
  }

  getStatus(): EventSourceStatus {
    return {
      name: this.name,
      type: this.type,
      enabled: this.enabled,
      running: this.running,
      lastFetchAt: null,
      lastEventAt: this.lastEventAt,
      errorCount: this.errorCount,
      lastError: this.lastError,
    };
  }
}
