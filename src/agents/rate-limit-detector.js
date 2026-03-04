import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { logger } from '../utils/logger.js';
import { fallbackManager } from './fallback-manager.js';

/**
 * Rate limit patterns per CLI.
 *
 * Each entry has a list of regex patterns that match known rate limit
 * messages from that CLI's stdout or stderr output.
 */
const RATE_LIMIT_PATTERNS = {
  claude: [
    /rate limit/i,
    /too many requests/i,
    /429/,
    /usage limit/i,
    /quota exceeded/i,
    /overloaded/i,
    /capacity/i,
  ],
  codex: [
    /rate limit/i,
    /too many requests/i,
    /429/,
    /usage limit/i,
    /quota exceeded/i,
    /rate_limit_exceeded/i,
    /tokens per min/i,
    /requests per min/i,
  ],
  gemini: [
    /rate limit/i,
    /too many requests/i,
    /429/,
    /usage limit/i,
    /quota exceeded/i,
    /resource exhausted/i,
    /RESOURCE_EXHAUSTED/,
    /quota.*exceeded/i,
  ],
};

/**
 * Check if a text string contains rate limit signals for a given CLI.
 *
 * @param {string} text - stdout or stderr output to analyze
 * @param {string} cli  - CLI identifier: 'claude', 'codex', or 'gemini'
 * @returns {{ detected: boolean, matchedPattern: string|null }}
 */
export function detectRateLimit(text, cli) {
  if (!text || !cli) {
    return { detected: false, matchedPattern: null };
  }

  const patterns = RATE_LIMIT_PATTERNS[cli];
  if (!patterns) {
    return { detected: false, matchedPattern: null };
  }

  for (const pattern of patterns) {
    if (pattern.test(text)) {
      return { detected: true, matchedPattern: pattern.source };
    }
  }

  return { detected: false, matchedPattern: null };
}

/**
 * Patterns to extract retry-after durations from rate limit messages.
 *
 * Matches common formats:
 * - "retry after 22s"
 * - "retry after 300 seconds"
 * - "Please retry after 22s"
 * - "Retry-After: 120"
 * - "try again in 45 seconds"
 * - "wait 60s before retrying"
 * - "retry in 5 minutes"
 * - "retry after 2m30s"
 *
 * @type {Array<{ regex: RegExp, toSeconds: (match: RegExpMatchArray) => number }>}
 */
const RETRY_AFTER_PATTERNS = [
  // "retry after 2m30s" (compound format — must come before simpler patterns)
  { regex: /retry\s+after\s+(\d+)m(\d+)s/i, toSeconds: (m) => Number(m[1]) * 60 + Number(m[2]) },
  // "retry after 22s" / "retry after 300 seconds" / "retry after 300s"
  { regex: /retry\s+after\s+(\d+)\s*s(?:econds?)?/i, toSeconds: (m) => Number(m[1]) },
  // "Retry-After: 120" (HTTP header style)
  { regex: /retry[- ]after[:\s]+(\d+)/i, toSeconds: (m) => Number(m[1]) },
  // "try again in 45 seconds"
  { regex: /try\s+again\s+in\s+(\d+)\s*s(?:econds?)?/i, toSeconds: (m) => Number(m[1]) },
  // "wait 60s before" / "wait 60 seconds"
  { regex: /wait\s+(\d+)\s*s(?:econds?)?/i, toSeconds: (m) => Number(m[1]) },
  // "retry in 5 minutes" / "try again in 5 min"
  { regex: /(?:retry|try\s+again)\s+in\s+(\d+)\s*min(?:utes?)?/i, toSeconds: (m) => Number(m[1]) * 60 },
];

/**
 * Parse retry-after duration from a rate limit error message.
 *
 * Scans the text for known retry-after patterns and returns the
 * number of seconds to wait, or null if no pattern matched.
 *
 * @param {string} text - Error text to parse
 * @returns {number|null} Seconds to wait, or null if not found
 */
export function parseRetryAfter(text) {
  if (!text) return null;

  for (const { regex, toSeconds } of RETRY_AFTER_PATTERNS) {
    const match = text.match(regex);
    if (match) {
      const seconds = toSeconds(match);
      return seconds > 0 ? seconds : null;
    }
  }

  return null;
}

/**
 * Check text for rate limit signals and emit an event if detected.
 *
 * This is the main integration point — called from base-agent.js
 * on stderr/stdout data and on process error. It is transparent:
 * if no rate limit is found, nothing happens.
 *
 * @param {string} text      - Output text to check
 * @param {string} cli       - CLI identifier ('claude', 'codex', 'gemini')
 * @param {string} agentName - Agent name (PLANNER, CODER, REVIEWER)
 * @returns {boolean} true if rate limit was detected
 */
export function checkAndEmitRateLimit(text, cli, agentName) {
  const { detected, matchedPattern } = detectRateLimit(text, cli);

  if (detected) {
    const retryAfterSeconds = parseRetryAfter(text);

    logger.warn(`Rate limit detected (${cli}): matched "${matchedPattern}"`, agentName);

    // Track this CLI as rate-limited for fallback purposes
    fallbackManager.markRateLimited(cli);

    eventBus.emitEvent(EVENT_TYPES.RATE_LIMIT_DETECTED, {
      agentName,
      metadata: {
        cli,
        matchedPattern,
        retryAfterSeconds,
        timestamp: new Date().toISOString(),
      },
    });
  }

  return detected;
}
