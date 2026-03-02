import { getDb } from './firebase.js';
import { config } from './config.js';
import { logger } from './utils/logger.js';

const CONFIG_PATH = '/komodoConfig';
const CACHE_TTL = 30_000; // 30 seconds

// Defaults matching current hardcoded values
const DEFAULTS = {
  agents: {
    planner: { model: 'sonnet', maxTurns: 15 },
    coder: { model: 'sonnet', maxTurns: 50 },
    reviewer: { model: 'sonnet', maxTurns: 30 },
  },
  maxReviewCycles: config.maxReviewCycles,
};

let cachedConfig = null;
let cacheTimestamp = 0;

/**
 * Fetch Komodo config from Firebase RTDB with caching.
 * Falls back to defaults if Firebase is unavailable.
 */
export async function fetchKomodoConfig() {
  const now = Date.now();
  if (cachedConfig && now - cacheTimestamp < CACHE_TTL) {
    return cachedConfig;
  }

  try {
    const db = getDb();
    const snapshot = await db.ref(CONFIG_PATH).once('value');
    const data = snapshot.val();

    if (data) {
      cachedConfig = data;
      cacheTimestamp = now;
      return data;
    }
  } catch (err) {
    logger.warn(`Could not read config from Firebase: ${err.message}`, 'CONFIG');
  }

  return DEFAULTS;
}

/**
 * Get maxTurns for a specific agent from Firebase config.
 * @param {'PLANNER' | 'CODER' | 'REVIEWER'} agentName
 * @returns {Promise<number>}
 */
export async function getAgentMaxTurns(agentName) {
  const agentKey = agentName.toLowerCase();
  const dbConfig = await fetchKomodoConfig();
  return dbConfig?.agents?.[agentKey]?.maxTurns || DEFAULTS.agents[agentKey].maxTurns;
}

/**
 * Get maxReviewCycles from Firebase config.
 * Falls back to .env MAX_REVIEW_CYCLES.
 * @returns {Promise<number>}
 */
export async function getMaxReviewCycles() {
  const dbConfig = await fetchKomodoConfig();
  return dbConfig?.maxReviewCycles || config.maxReviewCycles;
}
