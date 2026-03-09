import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const AGENT = 'WEBHOOK';

/**
 * Returns the list of target URLs from config.
 * Combines WEBHOOK_URL (single) and WEBHOOK_URLS (multiple).
 * @returns {string[]}
 */
export function getTargetUrls() {
  const urls = [...config.webhookUrls];
  if (config.webhookUrl && !urls.includes(config.webhookUrl)) {
    urls.unshift(config.webhookUrl);
  }
  return urls;
}

/**
 * Parses WEBHOOK_HEADERS config into a plain object.
 * Format: ["Authorization:Bearer token", "X-Custom:value"]
 * @returns {Record<string, string>}
 */
export function parseHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  for (const entry of config.webhookHeaders) {
    const colonIdx = entry.indexOf(':');
    if (colonIdx > 0) {
      const key = entry.slice(0, colonIdx).trim();
      const value = entry.slice(colonIdx + 1).trim();
      headers[key] = value;
    }
  }
  return headers;
}

/**
 * Checks whether an event type should be forwarded based on WEBHOOK_EVENTS filter.
 * @param {string} eventType
 * @returns {boolean}
 */
export function shouldForward(eventType) {
  const filter = config.webhookEvents;
  if (filter === '*') return true;
  const allowed = filter.split(',').map(e => e.trim()).filter(Boolean);
  return allowed.includes(eventType);
}

/**
 * Sends a JSON payload to a single URL with exponential backoff retry.
 * @param {string} url
 * @param {object} payload
 * @param {Record<string, string>} headers
 * @param {number} maxRetries
 * @returns {Promise<{ url: string, status: number, ok: boolean, attempts: number }>}
 */
export async function sendWithRetry(url, payload, headers, maxRetries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      logger.info(`Webhook sent to ${url} — status ${response.status} (attempt ${attempt})`, AGENT);

      // Return immediately for success or client errors (4xx); retry on 5xx
      if (response.ok || response.status < 500) {
        return { url, status: response.status, ok: response.ok, attempts: attempt };
      }

      // 5xx — transient server error, retry
      lastError = new Error(`HTTP ${response.status}`);
      logger.warn(`Webhook to ${url} got ${response.status} (attempt ${attempt}/${maxRetries})`, AGENT);
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt - 1) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    } catch (err) {
      lastError = err;
      logger.warn(`Webhook to ${url} failed (attempt ${attempt}/${maxRetries}): ${err.message}`, AGENT);
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s...
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  logger.error(`Webhook to ${url} exhausted ${maxRetries} retries: ${lastError.message}`, AGENT);
  return { url, status: 0, ok: false, attempts: maxRetries, error: lastError.message };
}

/** Unsubscribe function for the active onAny listener. */
let unsubscribe = null;

/**
 * Starts the webhook outgoing integration.
 * Subscribes to EventBus via onAny() and forwards matching events to configured URLs.
 */
export function startWebhookOutgoing() {
  const urls = getTargetUrls();
  if (urls.length === 0) {
    return;
  }

  logger.info(`Webhook outgoing enabled — ${urls.length} URL(s), filter: ${config.webhookEvents}`, AGENT);

  const headers = parseHeaders();
  const maxRetries = config.webhookMaxRetries;

  unsubscribe = eventBus.onAny((eventPayload) => {
    if (!shouldForward(eventPayload.type)) return;

    // Don't forward webhook's own events to avoid infinite loops
    if (eventPayload.type === EVENT_TYPES.WEBHOOK_SENT || eventPayload.type === EVENT_TYPES.WEBHOOK_FAILED) {
      return;
    }

    const webhookPayload = {
      event: eventPayload.type,
      timestamp: eventPayload.timestamp,
      data: {
        agentName: eventPayload.agentName,
        previousState: eventPayload.previousState,
        newState: eventPayload.newState,
        ...eventPayload.metadata,
      },
      projectId: config.defaultProjectId || null,
    };

    for (const url of urls) {
      sendWithRetry(url, webhookPayload, headers, maxRetries).then(result => {
        if (result.ok) {
          eventBus.emitEvent(EVENT_TYPES.WEBHOOK_SENT, {
            metadata: { url, event: eventPayload.type, status: result.status, attempts: result.attempts },
          });
        } else {
          eventBus.emitEvent(EVENT_TYPES.WEBHOOK_FAILED, {
            metadata: { url, event: eventPayload.type, status: result.status, attempts: result.attempts, error: result.error },
          });
        }
      });
    }
  });
}

/**
 * Stops the webhook outgoing integration.
 */
export function stopWebhookOutgoing() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
    logger.info('Webhook outgoing stopped', AGENT);
  }
}
