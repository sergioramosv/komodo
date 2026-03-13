import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { getDb } from '../../skills/planning-task-mcp/src/firebase.js';
import { loadLearningStore, saveLearningStore } from '../knowledge/codebase-learning.js';

const AGENT_TAG = 'CROSS-PROJECT';

/** Firebase root path for global intelligence. */
const GLOBAL_ROOT = 'global-intelligence';

/** Maximum tokens for injected global insights (≈4 chars/token). */
const GLOBAL_INSIGHTS_MAX_TOKENS = 500;

/**
 * Converts a string to a Firebase-safe key (dots and slashes → underscores).
 * @param {string} text
 * @returns {string}
 */
function toFirebaseKey(text) {
  return text.replace(/[.\\/[\]#$]/g, '_').slice(0, 200);
}

/**
 * Generates a deterministic SHA-256 hex fingerprint for a pattern text.
 * Used as the embedding field for identity and deduplication.
 * @param {string} text
 * @returns {string}
 */
function generateTextEmbedding(text) {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Calculates the universality score for a pattern given the total number of
 * projects that have been seen by the system.
 *
 * universalityScore = projectsSeenIn.length / totalProjects
 *
 * @param {string[]} projectsSeenIn - Project IDs where this pattern was observed
 * @param {number} totalProjects - Total number of known projects
 * @returns {number} Score in [0, 1]
 */
export function evaluatePatternUniversality(projectsSeenIn, totalProjects) {
  if (!Array.isArray(projectsSeenIn) || projectsSeenIn.length === 0) return 0;
  if (!Number.isFinite(totalProjects) || totalProjects <= 0) return 0;
  return Math.min(projectsSeenIn.length / totalProjects, 1);
}

/**
 * Syncs the local patterns and anti-patterns for a project to the global
 * /global-intelligence/ Firebase tree.
 *
 * For each pattern:
 *  - Upserts it under /global-intelligence/patterns/{key}
 *  - Adds projectId to projectsSeenIn
 *  - Recalculates universalityScore; promotes if >= threshold
 *
 * For each anti-pattern:
 *  - Upserts under /global-intelligence/anti-patterns/{key}
 *  - Marks critical (security) ones for immediate propagation
 *
 * @param {string} projectId
 * @returns {Promise<{ patternsPromoted: number, antiPatternsPropagated: number }>}
 */
export async function syncPatternsToGlobal(projectId) {
  if (!config.crossProjectIntelligence) return { patternsPromoted: 0, antiPatternsPropagated: 0 };
  if (!projectId) return { patternsPromoted: 0, antiPatternsPropagated: 0 };

  try {
    const db = getDb();
    const store = loadLearningStore(projectId);
    const threshold = config.crossProjectUniversalityThreshold;

    // Determine total project count from Firebase
    const projectsSnapshot = await db.ref(`${GLOBAL_ROOT}/meta/projectIds`).once('value');
    const knownProjectIds = projectsSnapshot.val() || {};
    if (!knownProjectIds[projectId]) {
      await db.ref(`${GLOBAL_ROOT}/meta/projectIds/${projectId}`).set(true);
      knownProjectIds[projectId] = true;
    }
    const totalProjects = Object.keys(knownProjectIds).length;

    let patternsPromoted = 0;
    let antiPatternsPropagated = 0;

    // --- Sync patterns ---
    for (const text of store.patterns) {
      if (!text) continue;
      const key = toFirebaseKey(text);
      const ref = db.ref(`${GLOBAL_ROOT}/patterns/${key}`);

      await ref.transaction((current) => {
        const existing = current || { text, projectsSeenIn: {}, universalityScore: 0, embedding: null, promotedAt: null };
        existing.text = text;
        existing.projectsSeenIn = existing.projectsSeenIn || {};
        existing.projectsSeenIn[projectId] = true;
        existing.embedding = generateTextEmbedding(text);

        const seenList = Object.keys(existing.projectsSeenIn);
        existing.universalityScore = evaluatePatternUniversality(seenList, totalProjects);

        if (existing.universalityScore >= threshold && !existing.promotedAt) {
          existing.promotedAt = new Date().toISOString();
        }

        return existing;
      });

      // Check if promoted after transaction
      const snap = await ref.once('value');
      const val = snap.val();
      if (val && val.promotedAt && val.universalityScore >= threshold) {
        patternsPromoted++;
        eventBus.emitEvent(EVENT_TYPES.CROSS_PROJECT_PATTERN_PROMOTED, {
          metadata: { projectId, pattern: text, score: val.universalityScore },
        });
      }
    }

    // --- Sync anti-patterns ---
    const SECURITY_RE = /security|xss|injection|csrf|auth|secret|password|token|vuln/i;

    for (const text of store.antiPatterns) {
      if (!text) continue;
      const key = toFirebaseKey(text);
      const ref = db.ref(`${GLOBAL_ROOT}/anti-patterns/${key}`);
      const isCritical = SECURITY_RE.test(text);

      await ref.transaction((current) => {
        const existing = current || { text, projectsSeenIn: {}, isCritical: false, propagatedAt: null };
        existing.text = text;
        existing.projectsSeenIn = existing.projectsSeenIn || {};
        existing.projectsSeenIn[projectId] = true;
        existing.isCritical = existing.isCritical || isCritical;

        // Critical anti-patterns are auto-propagated
        if (existing.isCritical && !existing.propagatedAt) {
          existing.propagatedAt = new Date().toISOString();
        }

        return existing;
      });

      if (isCritical) {
        antiPatternsPropagated++;
        eventBus.emitEvent(EVENT_TYPES.CROSS_PROJECT_ANTI_PATTERN_PROPAGATED, {
          metadata: { projectId, antiPattern: text, isCritical },
        });
      }
    }

    logger.info(
      `Cross-project sync for ${projectId}: ${patternsPromoted} patterns promoted, ${antiPatternsPropagated} anti-patterns propagated`,
      AGENT_TAG,
    );

    return { patternsPromoted, antiPatternsPropagated };
  } catch (err) {
    logger.warn(`syncPatternsToGlobal failed (non-blocking): ${err.message}`, AGENT_TAG);
    return { patternsPromoted: 0, antiPatternsPropagated: 0 };
  }
}

/**
 * Syncs model performance aggregates from project-level Firebase metrics to
 * the global /global-intelligence/model-performance/ tree.
 *
 * Reads /metrics/{projectId}/model-performance/by-model/ and merges into
 * /global-intelligence/model-performance/{modelKey}/{role}/.
 *
 * @param {string} projectId
 * @returns {Promise<{ updated: number }>}
 */
export async function syncModelPerformanceToGlobal(projectId) {
  if (!config.crossProjectIntelligence) return { updated: 0 };
  if (!projectId) return { updated: 0 };

  try {
    const db = getDb();
    const snap = await db.ref(`metrics/${projectId}/model-performance/by-model`).once('value');
    const byModel = snap.val();

    if (!byModel) return { updated: 0 };

    let updated = 0;

    for (const [modelKey, roles] of Object.entries(byModel)) {
      for (const [role, metrics] of Object.entries(roles)) {
        if (!metrics) continue;
        const ref = db.ref(`${GLOBAL_ROOT}/model-performance/${modelKey}/${role}`);

        await ref.transaction((current) => {
          if (current === null) {
            return {
              model: metrics.model || modelKey,
              role,
              taskCount: metrics.taskCount || 0,
              avgSuccessRate: metrics.avgScore != null ? metrics.avgScore / 10 : 0,
              bestFor: [],
              worstFor: [],
              lastUpdatedAt: new Date().toISOString(),
            };
          }

          // Incremental merge: weighted average of avgSuccessRate
          const existingCount = current.taskCount || 0;
          const incomingCount = metrics.taskCount || 0;
          const totalCount = existingCount + incomingCount;

          const incomingRate = metrics.avgScore != null ? metrics.avgScore / 10 : 0;
          const newAvgSuccessRate = totalCount > 0
            ? (current.avgSuccessRate * existingCount + incomingRate * incomingCount) / totalCount
            : 0;

          return {
            ...current,
            taskCount: totalCount,
            avgSuccessRate: newAvgSuccessRate,
            bestFor: [...new Set([...(current.bestFor || []), ...(metrics.bestFor || [])])],
            worstFor: [...new Set([...(current.worstFor || []), ...(metrics.worstFor || [])])],
            lastUpdatedAt: new Date().toISOString(),
          };
        });

        updated++;
        eventBus.emitEvent(EVENT_TYPES.GLOBAL_MODEL_PERF_UPDATED, {
          metadata: { projectId, modelKey, role },
        });
      }
    }

    logger.info(`Global model performance updated for ${projectId}: ${updated} model/role combos`, AGENT_TAG);
    return { updated };
  } catch (err) {
    logger.warn(`syncModelPerformanceToGlobal failed (non-blocking): ${err.message}`, AGENT_TAG);
    return { updated: 0 };
  }
}

/**
 * Retrieves global patterns from Firebase, optionally filtered by minimum
 * universality score.
 *
 * @param {{ minScore?: number }} [options]
 * @returns {Promise<Array<{ text: string, universalityScore: number, projectsSeenIn: string[] }>>}
 */
export async function getGlobalPatterns({ minScore = 0 } = {}) {
  try {
    const db = getDb();
    const snap = await db.ref(`${GLOBAL_ROOT}/patterns`).once('value');
    const data = snap.val() || {};

    return Object.values(data)
      .filter((p) => p && p.universalityScore >= minScore)
      .map((p) => ({
        text: p.text,
        universalityScore: p.universalityScore,
        projectsSeenIn: Object.keys(p.projectsSeenIn || {}),
      }))
      .sort((a, b) => b.universalityScore - a.universalityScore);
  } catch (err) {
    logger.warn(`getGlobalPatterns failed: ${err.message}`, AGENT_TAG);
    return [];
  }
}

/**
 * Retrieves global anti-patterns, optionally filtering to only critical ones.
 *
 * @param {{ criticalOnly?: boolean }} [options]
 * @returns {Promise<Array<{ text: string, isCritical: boolean, projectsSeenIn: string[] }>>}
 */
export async function getGlobalAntiPatterns({ criticalOnly = false } = {}) {
  try {
    const db = getDb();
    const snap = await db.ref(`${GLOBAL_ROOT}/anti-patterns`).once('value');
    const data = snap.val() || {};

    return Object.values(data)
      .filter((ap) => ap && (!criticalOnly || ap.isCritical))
      .map((ap) => ({
        text: ap.text,
        isCritical: ap.isCritical || false,
        projectsSeenIn: Object.keys(ap.projectsSeenIn || {}),
      }));
  } catch (err) {
    logger.warn(`getGlobalAntiPatterns failed: ${err.message}`, AGENT_TAG);
    return [];
  }
}

/**
 * Applies global critical anti-patterns to a project's local learning store.
 * This ensures new projects immediately benefit from security lessons learned
 * across all other projects.
 *
 * @param {string} projectId
 * @returns {Promise<{ applied: number }>}
 */
export async function applyGlobalAntiPatternsToProject(projectId) {
  if (!config.crossProjectIntelligence) return { applied: 0 };
  if (!projectId) return { applied: 0 };

  try {
    const criticalAntiPatterns = await getGlobalAntiPatterns({ criticalOnly: true });
    if (!criticalAntiPatterns.length) return { applied: 0 };

    const store = loadLearningStore(projectId);
    const existingSet = new Set(store.antiPatterns.map((s) => s.trim().toLowerCase()));

    let applied = 0;
    for (const { text } of criticalAntiPatterns) {
      if (!text) continue;
      const normalized = text.trim().toLowerCase();
      if (!existingSet.has(normalized)) {
        store.antiPatterns.push(`[global] ${text.trim()}`);
        existingSet.add(normalized);
        applied++;
      }
    }

    if (applied > 0) {
      saveLearningStore(projectId, store);
      logger.info(`Applied ${applied} global critical anti-patterns to project ${projectId}`, AGENT_TAG);
    }

    return { applied };
  } catch (err) {
    logger.warn(`applyGlobalAntiPatternsToProject failed (non-blocking): ${err.message}`, AGENT_TAG);
    return { applied: 0 };
  }
}

/**
 * Applies promoted global patterns to a project's local learning store.
 * Only patterns with a universality score above the configured threshold are applied.
 *
 * @param {string} projectId
 * @returns {Promise<{ applied: number }>}
 */
export async function applyGlobalPatternsToProject(projectId) {
  if (!config.crossProjectIntelligence) return { applied: 0 };
  if (!projectId) return { applied: 0 };

  try {
    const threshold = config.crossProjectUniversalityThreshold || 0.6;
    const promotedPatterns = await getGlobalPatterns({ minScore: threshold });
    if (!promotedPatterns.length) return { applied: 0 };

    const store = loadLearningStore(projectId);
    const GLOBAL_PREFIX_RE = /^\[global\]\s*/i;
    const existingSet = new Set(store.patterns.map((s) => s.trim().toLowerCase().replace(GLOBAL_PREFIX_RE, '')));

    let applied = 0;
    for (const { text } of promotedPatterns) {
      if (!text) continue;
      const normalized = text.trim().toLowerCase();
      if (!existingSet.has(normalized)) {
        store.patterns.push(`[global] ${text.trim()}`);
        existingSet.add(normalized);
        applied++;
      }
    }

    if (applied > 0) {
      saveLearningStore(projectId, store);
      logger.info(`Applied ${applied} global patterns to project ${projectId}`, AGENT_TAG);
    }

    return { applied };
  } catch (err) {
    logger.warn(`applyGlobalPatternsToProject failed (non-blocking): ${err.message}`, AGENT_TAG);
    return { applied: 0 };
  }
}

/**
 * Returns a formatted string of global patterns and anti-patterns relevant to
 * the current task. Patterns are filtered by keyword overlap. Anti-patterns
 * are always included. Output is capped at 2000 characters.
 *
 * @param {{ title?: string, acceptanceCriteria?: string[] }} [taskContext]
 * @returns {Promise<string>}
 */
export async function getGlobalInsights(taskContext = {}) {
  if (!config.crossProjectIntelligence) return '';

  try {
    const threshold = config.crossProjectUniversalityThreshold || 0.6;
    const contextText = [
      taskContext.title || '',
      ...(taskContext.acceptanceCriteria || []),
    ].join(' ').toLowerCase();
    const keywords = [...new Set(contextText.split(/\W+/).filter((w) => w.length >= 3))];

    const [patterns, antiPatterns] = await Promise.all([
      getGlobalPatterns({ minScore: threshold }),
      getGlobalAntiPatterns(),
    ]);

    const relevantPatterns = keywords.length > 0
      ? patterns.filter((p) => keywords.some((kw) => p.text.toLowerCase().includes(kw)))
      : [];

    const lines = [];
    if (relevantPatterns.length > 0) {
      lines.push('## Global Patterns');
      for (const p of relevantPatterns) {
        lines.push(`- ${p.text}`);
      }
    }
    if (antiPatterns.length > 0) {
      lines.push('## Global Anti-Patterns');
      for (const ap of antiPatterns) {
        lines.push(`- ${ap.text}`);
      }
    }

    if (lines.length === 0) return '';

    const result = lines.join('\n');
    return result.length > GLOBAL_INSIGHTS_MAX_TOKENS * 4 ? result.slice(0, GLOBAL_INSIGHTS_MAX_TOKENS * 4) : result;
  } catch (err) {
    logger.warn(`getGlobalInsights failed (non-blocking): ${err.message}`, AGENT_TAG);
    return '';
  }
}

/**
 * Returns the best-performing model globally for a given agent role and CLI family.
 * Used as a fallback when the local project has insufficient routing data.
 *
 * @param {string} role - 'coder' | 'reviewer'
 * @param {string} cliFamily - 'claude' | 'codex' | 'gemini'
 * @returns {Promise<string|null>}
 */
export async function getGlobalModelRecommendation(role, cliFamily) {
  if (!config.crossProjectIntelligence) return null;

  try {
    const db = getDb();
    const snap = await db.ref(`${GLOBAL_ROOT}/model-performance`).once('value');
    const data = snap.val();
    if (!data) return null;

    const MIN_GLOBAL_TASKS = 3;
    const candidates = [];

    for (const [modelKey, roles] of Object.entries(data)) {
      if (!modelKey.toLowerCase().startsWith(cliFamily.toLowerCase())) continue;
      const roleData = roles[role];
      if (!roleData || (roleData.taskCount || 0) < MIN_GLOBAL_TASKS) continue;
      candidates.push({ model: roleData.model || modelKey, avgSuccessRate: roleData.avgSuccessRate || 0 });
    }

    if (!candidates.length) return null;

    candidates.sort((a, b) => b.avgSuccessRate - a.avgSuccessRate);
    return candidates[0].model;
  } catch (err) {
    logger.warn(`getGlobalModelRecommendation failed: ${err.message}`, AGENT_TAG);
    return null;
  }
}
