import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { logger } from '../utils/logger.js';

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
    logger.warn(`Rate limit detected (${cli}): matched "${matchedPattern}"`, agentName);

    eventBus.emitEvent(EVENT_TYPES.RATE_LIMIT_DETECTED, {
      agentName,
      metadata: {
        cli,
        matchedPattern,
        timestamp: new Date().toISOString(),
      },
    });
  }

  return detected;
}
