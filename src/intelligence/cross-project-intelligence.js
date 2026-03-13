import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { getDb } from '../../skills/planning-task-mcp/src/firebase.js';
import { loadLearningStore, saveLearningStore } from '../knowledge/codebase-learning.js';

const AGENT_TAG = 'CROSS-PROJECT';

/** Firebase root path for global intelligence. */
const GLOBAL_ROOT = 'global-intelligence';

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
