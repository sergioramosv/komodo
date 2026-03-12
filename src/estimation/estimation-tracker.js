import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { getDb } from '../../skills/planning-task-mcp/src/firebase.js';
import { estimateTaskTokens } from './token-estimator.js';

const AGENT_TAG = 'ESTIMATION';

/**
 * Records actual metrics for a completed task under /metrics/{projectId}/tasks/{taskId}.
 *
 * @param {Object} options
 * @param {string} options.taskId
 * @param {string} options.projectId
 * @param {number} options.estimatedDevPoints - Original devPoints estimate
 * @param {number} options.totalDuration - Seconds the task took end-to-end
 * @param {number} options.reviewCycles - How many review cycles it needed
 * @param {boolean} options.approved - Whether the PR was approved
 * @param {boolean} options.merged - Whether the PR was merged
 * @param {string[]} [options.filesChanged] - List of files changed
 * @param {string} [options.model] - AI model used for coding
 * @returns {Promise<{ recorded: boolean }>}
 */
export async function recordTaskMetrics({
  taskId,
  projectId,
  estimatedDevPoints,
  totalDuration,
  reviewCycles,
  approved,
  merged,
  filesChanged = [],
  model = '',
}) {
  if (!config.estimationTracking) {
    return { recorded: false };
  }

  if (!taskId || !projectId) {
    logger.warn('Missing taskId or projectId for estimation tracking', AGENT_TAG);
    return { recorded: false };
  }

  const estimatedTokens = estimateTaskTokens({ devPoints: estimatedDevPoints || 0 }).total;

  const metrics = {
    taskId,
    projectId,
    estimatedDevPoints: estimatedDevPoints || 0,
    estimatedTokens,
    totalDurationSeconds: totalDuration,
    reviewCycles,
    approved,
    merged,
    filesChanged,
    filesCount: filesChanged.length,
    model,
    completedAt: new Date().toISOString(),
  };

  try {
    const db = getDb();
    await db.ref(`metrics/${projectId}/tasks/${taskId}`).set(metrics);

    eventBus.emitEvent(EVENT_TYPES.ESTIMATION_RECORDED, {
      metadata: {
        taskId,
        projectId,
        estimatedDevPoints,
        estimatedTokens,
        totalDurationSeconds: totalDuration,
        reviewCycles,
      },
    });

    logger.info(
      `Recorded metrics for task ${taskId}: ${estimatedDevPoints}pts, ${totalDuration.toFixed(0)}s, ${reviewCycles} cycles`,
      AGENT_TAG,
    );

    return { recorded: true };
  } catch (err) {
    logger.warn(`Failed to record estimation metrics: ${err.message}`, AGENT_TAG);
    return { recorded: false };
  }
}

/**
 * Loads all completed task metrics for a project.
 *
 * @param {string} projectId
 * @returns {Promise<Array<Object>>}
 */
export async function getTaskMetrics(projectId) {
  try {
    const db = getDb();
    const snapshot = await db.ref(`metrics/${projectId}/tasks`).once('value');
    const data = snapshot.val();
    if (!data) return [];
    return Object.values(data);
  } catch (err) {
    logger.warn(`Failed to load estimation metrics: ${err.message}`, AGENT_TAG);
    return [];
  }
}

/**
 * Groups metrics by devPoints range and calculates estimation accuracy ratios.
 *
 * Returns per-range stats:
 * - avgDuration: average total duration in seconds
 * - avgReviewCycles: average review cycles
 * - taskCount: number of tasks in this range
 * - avgFilesChanged: average files changed
 *
 * Ranges: 1-2 (trivial), 3-5 (standard), 8-13 (complex)
 *
 * @param {Array<Object>} metrics - Task metrics array
 * @returns {Object} Ratios grouped by devPoints range
 */
export function calculateEstimationRatios(metrics) {
  if (!Array.isArray(metrics) || metrics.length === 0) {
    return { trivial: null, standard: null, complex: null };
  }

  const ranges = {
    trivial: { min: 1, max: 2, tasks: [] },
    standard: { min: 3, max: 5, tasks: [] },
    complex: { min: 8, max: 13, tasks: [] },
  };

  for (const m of metrics) {
    const pts = m.estimatedDevPoints || 0;
    if (pts >= 1 && pts <= 2) ranges.trivial.tasks.push(m);
    else if (pts >= 3 && pts <= 5) ranges.standard.tasks.push(m);
    else if (pts >= 8) ranges.complex.tasks.push(m);
  }

  const result = {};

  for (const [rangeName, range] of Object.entries(ranges)) {
    if (range.tasks.length === 0) {
      result[rangeName] = null;
      continue;
    }

    const tasks = range.tasks;
    const count = tasks.length;

    result[rangeName] = {
      taskCount: count,
      avgDuration: tasks.reduce((s, t) => s + (t.totalDurationSeconds || 0), 0) / count,
      avgReviewCycles: tasks.reduce((s, t) => s + (t.reviewCycles || 0), 0) / count,
      avgFilesChanged: tasks.reduce((s, t) => s + (t.filesCount || 0), 0) / count,
      avgDevPoints: tasks.reduce((s, t) => s + (t.estimatedDevPoints || 0), 0) / count,
    };
  }

  return result;
}

/**
 * Detects categories where tasks consistently need more review cycles than expected.
 * Threshold: avgReviewCycles >= 2x the baseline (2 cycles).
 *
 * @param {Object} ratios - Output of calculateEstimationRatios
 * @returns {Array<{ range: string, avgReviewCycles: number, warning: string }>}
 */
export function detectUnderestimatedCategories(ratios) {
  const CYCLE_THRESHOLD = 2;
  const warnings = [];

  for (const [rangeName, stats] of Object.entries(ratios)) {
    if (!stats) continue;
    if (stats.taskCount < 3) continue; // need enough data

    if (stats.avgReviewCycles >= CYCLE_THRESHOLD * 2) {
      warnings.push({
        range: rangeName,
        avgReviewCycles: Math.round(stats.avgReviewCycles * 10) / 10,
        warning: `"${rangeName}" tasks (${stats.avgDevPoints.toFixed(0)}pts avg) consistently need ${stats.avgReviewCycles.toFixed(1)} review cycles — consider increasing devPoints estimates`,
      });
    }
  }

  return warnings;
}

/**
 * Converts historical task ratios into token multipliers per complexity level.
 * Tasks with more review cycles consume more tokens — so the multiplier scales
 * with avgReviewCycles relative to a baseline of 1 cycle.
 *
 * Returns { trivial: number, standard: number, complex: number } with fallback
 * to 1.0 when data is insufficient (taskCount < 3).
 *
 * @param {string} projectId
 * @returns {Promise<{ trivial: number, standard: number, complex: number }>}
 */
export async function getHistoricalMultipliers(projectId) {
  const defaultMultipliers = { trivial: 1.0, standard: 1.0, complex: 1.0 };

  if (!config.estimationTracking) {
    return defaultMultipliers;
  }

  try {
    const metrics = await getTaskMetrics(projectId);
    if (metrics.length === 0) {
      return defaultMultipliers;
    }

    const ratios = calculateEstimationRatios(metrics);
    const multipliers = { ...defaultMultipliers };

    const BASELINE_REVIEW_CYCLES = 1;

    for (const [level, stats] of Object.entries(ratios)) {
      if (!stats || stats.taskCount < 3) continue;
      // Scale token estimate by observed review cycles vs baseline
      const cycleMultiplier = stats.avgReviewCycles / BASELINE_REVIEW_CYCLES;
      // Clamp between 0.5 and 3.0 to avoid wild swings
      multipliers[level] = Math.min(3.0, Math.max(0.5, cycleMultiplier));
    }

    logger.debug(
      `Historical multipliers for ${projectId}: trivial=${multipliers.trivial.toFixed(2)}, standard=${multipliers.standard.toFixed(2)}, complex=${multipliers.complex.toFixed(2)}`,
      AGENT_TAG,
    );

    return multipliers;
  } catch (err) {
    logger.warn(`Failed to load historical multipliers: ${err.message}`, AGENT_TAG);
    return defaultMultipliers;
  }
}

/**
 * Builds a calibration context string for the Planner.
 * Queries historical metrics, calculates ratios, and formats as prompt context.
 *
 * @param {string} projectId
 * @returns {Promise<{ context: string, warnings: Array, ratios: Object }>}
 */
export async function getEstimationCalibrationContext(projectId) {
  if (!config.estimationTracking) {
    return { context: '', warnings: [], ratios: {} };
  }

  try {
    const metrics = await getTaskMetrics(projectId);

    if (metrics.length === 0) {
      return { context: '', warnings: [], ratios: {} };
    }

    const ratios = calculateEstimationRatios(metrics);
    const warnings = detectUnderestimatedCategories(ratios);

    const lines = ['ESTIMATION CALIBRATION (based on historical data):'];

    for (const [rangeName, stats] of Object.entries(ratios)) {
      if (!stats) continue;
      lines.push(
        `- ${rangeName} (${stats.avgDevPoints.toFixed(0)}pts): avg ${(stats.avgDuration / 60).toFixed(0)}min, ${stats.avgReviewCycles.toFixed(1)} review cycles, ${stats.avgFilesChanged.toFixed(0)} files (${stats.taskCount} tasks)`,
      );
    }

    if (warnings.length > 0) {
      lines.push('');
      lines.push('WARNINGS:');
      for (const w of warnings) {
        lines.push(`- ${w.warning}`);
      }
    }

    const context = lines.join('\n');

    if (warnings.length > 0) {
      logger.warn(`Estimation warnings for project ${projectId}: ${warnings.length} category/ies underestimated`, AGENT_TAG);
    }

    return { context, warnings, ratios };
  } catch (err) {
    logger.warn(`Failed to build calibration context: ${err.message}`, AGENT_TAG);
    return { context: '', warnings: [], ratios: {} };
  }
}
