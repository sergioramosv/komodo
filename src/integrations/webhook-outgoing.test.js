import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    webhookUrl: '',
    webhookUrls: [],
    webhookEvents: '*',
    webhookHeaders: [],
    webhookMaxRetries: 3,
    defaultProjectId: 'proj-123',
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import {
  getTargetUrls,
  parseHeaders,
  shouldForward,
  sendWithRetry,
  startWebhookOutgoing,
  stopWebhookOutgoing,
} from './webhook-outgoing.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  stopWebhookOutgoing();
  config.webhookUrl = '';
  config.webhookUrls = [];
  config.webhookEvents = '*';
  config.webhookHeaders = [];
  config.webhookMaxRetries = 3;
  config.defaultProjectId = 'proj-123';
});

// ── getTargetUrls ──

describe('getTargetUrls', () => {
  it('returns empty when no URLs configured', () => {
    expect(getTargetUrls()).toEqual([]);
  });

  it('returns single WEBHOOK_URL', () => {
    config.webhookUrl = 'https://hooks.slack.com/abc';
    expect(getTargetUrls()).toEqual(['https://hooks.slack.com/abc']);
  });

  it('returns multiple WEBHOOK_URLS', () => {
    config.webhookUrls = ['https://a.com', 'https://b.com'];
    expect(getTargetUrls()).toEqual(['https://a.com', 'https://b.com']);
  });

  it('combines WEBHOOK_URL and WEBHOOK_URLS without duplicates', () => {
    config.webhookUrl = 'https://a.com';
    config.webhookUrls = ['https://a.com', 'https://b.com'];
    expect(getTargetUrls()).toEqual(['https://a.com', 'https://b.com']);
  });

  it('puts WEBHOOK_URL first when not in WEBHOOK_URLS', () => {
    config.webhookUrl = 'https://primary.com';
    config.webhookUrls = ['https://secondary.com'];
    expect(getTargetUrls()).toEqual(['https://primary.com', 'https://secondary.com']);
  });
});

// ── parseHeaders ──

describe('parseHeaders', () => {
  it('includes Content-Type by default', () => {
    const headers = parseHeaders();
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('parses custom headers from config', () => {
    config.webhookHeaders = ['Authorization:Bearer tok123', 'X-Custom:my-value'];
    const headers = parseHeaders();
    expect(headers['Authorization']).toBe('Bearer tok123');
    expect(headers['X-Custom']).toBe('my-value');
  });

  it('handles header values with colons', () => {
    config.webhookHeaders = ['X-Data:value:with:colons'];
    const headers = parseHeaders();
    expect(headers['X-Data']).toBe('value:with:colons');
  });

  it('ignores malformed headers without colon', () => {
    config.webhookHeaders = ['NoColonHere'];
    const headers = parseHeaders();
    expect(Object.keys(headers)).toEqual(['Content-Type']);
  });
});

// ── shouldForward ──

describe('shouldForward', () => {
  it('forwards all events when filter is *', () => {
    config.webhookEvents = '*';
    expect(shouldForward('task:completed')).toBe(true);
    expect(shouldForward('pr:merged')).toBe(true);
  });

  it('only forwards matching events when filter is set', () => {
    config.webhookEvents = 'task:completed,pr:merged';
    expect(shouldForward('task:completed')).toBe(true);
    expect(shouldForward('pr:merged')).toBe(true);
    expect(shouldForward('ci:failed')).toBe(false);
  });

  it('trims whitespace in filter entries', () => {
    config.webhookEvents = ' task:completed , pr:merged ';
    expect(shouldForward('task:completed')).toBe(true);
  });
});

// ── sendWithRetry ──

describe('sendWithRetry', () => {
  it('sends successfully on first attempt', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 200, ok: true });
    vi.stubGlobal('fetch', mockFetch);

    const result = await sendWithRetry('https://hook.com', { event: 'test' }, { 'Content-Type': 'application/json' }, 3);

    expect(result).toEqual({ url: 'https://hook.com', status: 200, ok: true, attempts: 1 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith('https://hook.com', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'test' }),
    }));
    expect(mockFetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('retries on network error with exponential backoff', async () => {
    const mockFetch = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce({ status: 200, ok: true });
    vi.stubGlobal('fetch', mockFetch);

    const result = await sendWithRetry('https://hook.com', {}, {}, 3);

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('exhausts retries and returns failure', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('timeout'));
    vi.stubGlobal('fetch', mockFetch);

    const result = await sendWithRetry('https://hook.com', {}, {}, 2);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.attempts).toBe(2);
    expect(result.error).toBe('timeout');
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('retries on 5xx server errors', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 500, ok: false });
    vi.stubGlobal('fetch', mockFetch);

    const result = await sendWithRetry('https://hook.com', {}, {}, 3);

    expect(result.status).toBe(0);
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(3);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledTimes(3);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('returns 4xx client error without retrying', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 422, ok: false });
    vi.stubGlobal('fetch', mockFetch);

    const result = await sendWithRetry('https://hook.com', {}, {}, 3);

    expect(result.status).toBe(422);
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

// ── startWebhookOutgoing / stopWebhookOutgoing ──

describe('startWebhookOutgoing', () => {
  it('does nothing when no URLs configured', () => {
    startWebhookOutgoing();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('subscribes to EventBus when URLs are configured', () => {
    config.webhookUrl = 'https://hook.com';
    startWebhookOutgoing();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Webhook outgoing enabled'),
      'WEBHOOK',
    );
  });

  it('forwards matching events to configured URLs', async () => {
    config.webhookUrl = 'https://hook.com';
    config.webhookEvents = 'task:completed';

    const mockFetch = vi.fn().mockResolvedValue({ status: 200, ok: true });
    vi.stubGlobal('fetch', mockFetch);

    startWebhookOutgoing();

    eventBus.emitEvent(EVENT_TYPES.TASK_COMPLETED, {
      metadata: { taskId: 'task-1', approved: true },
    });

    // Wait for async webhook send
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://hook.com');
    const body = JSON.parse(options.body);
    expect(body.event).toBe('task:completed');
    expect(body.data.taskId).toBe('task-1');
    expect(body.projectId).toBe('proj-123');
    expect(body.timestamp).toBeTruthy();
  });

  it('does not forward filtered-out events', async () => {
    config.webhookUrl = 'https://hook.com';
    config.webhookEvents = 'pr:merged';

    const mockFetch = vi.fn().mockResolvedValue({ status: 200, ok: true });
    vi.stubGlobal('fetch', mockFetch);

    startWebhookOutgoing();

    eventBus.emitEvent(EVENT_TYPES.TASK_STARTED, {
      metadata: { taskId: 'task-1' },
    });

    // Give time for any potential async calls
    await new Promise(r => setTimeout(r, 50));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('sends to multiple URLs', async () => {
    config.webhookUrls = ['https://a.com', 'https://b.com'];

    const mockFetch = vi.fn().mockResolvedValue({ status: 200, ok: true });
    vi.stubGlobal('fetch', mockFetch);

    startWebhookOutgoing();

    eventBus.emitEvent(EVENT_TYPES.TASK_COMPLETED, {
      metadata: { taskId: 'task-1' },
    });

    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));

    const urls = mockFetch.mock.calls.map(c => c[0]);
    expect(urls).toContain('https://a.com');
    expect(urls).toContain('https://b.com');
  });

  it('does not forward its own webhook events (no infinite loop)', async () => {
    config.webhookUrl = 'https://hook.com';
    config.webhookEvents = '*';

    const mockFetch = vi.fn().mockResolvedValue({ status: 200, ok: true });
    vi.stubGlobal('fetch', mockFetch);

    startWebhookOutgoing();

    // Emit a webhook:sent event directly — should NOT trigger another send
    eventBus.emitEvent(EVENT_TYPES.WEBHOOK_SENT, {
      metadata: { url: 'https://hook.com', event: 'test' },
    });

    await new Promise(r => setTimeout(r, 50));
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('stopWebhookOutgoing', () => {
  it('unsubscribes from EventBus', async () => {
    config.webhookUrl = 'https://hook.com';

    const mockFetch = vi.fn().mockResolvedValue({ status: 200, ok: true });
    vi.stubGlobal('fetch', mockFetch);

    startWebhookOutgoing();
    stopWebhookOutgoing();

    eventBus.emitEvent(EVENT_TYPES.TASK_COMPLETED, {
      metadata: { taskId: 'task-1' },
    });

    await new Promise(r => setTimeout(r, 50));
    expect(mockFetch).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('Webhook outgoing stopped', 'WEBHOOK');
  });

  it('is safe to call multiple times', () => {
    stopWebhookOutgoing();
    stopWebhookOutgoing();
    // No error thrown
  });
});
