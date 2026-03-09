import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { getDb } from '../../skills/planning-task-mcp/src/firebase.js';

const AGENT_TAG = 'MODEL-PERF';

/**
 * Converts a model name to a Firebase-safe key (dots → underscores).
 * @param {string} model
 * @returns {string}
 */
function toFirebaseKey(model) {
  return model.replace(/\./g, '_');
}

/**
 * Records model performance metrics for a completed task.
 *
 * Writes two entries to Firebase:
 * 1. Per-task record at /metrics/{projectId}/model-performance/tasks/{taskId}
 * 2. Aggregate update at /metrics/{projectId}/model-performance/by-model/{model}/{role}/
 *
 * @param {Object} options
 * @param {string} options.taskId
 * @param {string} options.projectId
 * @param {string} options.plannerModel - Model used by the Planner agent
 * @param {string} options.coderModel - Model used by the Coder agent
 * @param {string} options.reviewerModel - Model used by the Reviewer agent
 * @param {number|null} options.reviewScore - Final review score (0–10), null if not approved
 * @param {number} options.reviewCycles - Total review cycles needed
 * @param {number} options.durationSeconds - Total task duration in seconds
 * @param {number} [options.cost] - Accumulated cost for the task (best effort)
 * @param {boolean} options.approved - Whether the PR was approved
 * @returns {Promise<{ recorded: boolean }>}
 */
export async function recordModelPerformance({
  taskId,
  projectId,
  plannerModel,
  coderModel,
  reviewerModel,
  reviewScore,
  reviewCycles,
  durationSeconds,
  cost = 0,
  approved,
}) {
  if (!config.estimationTracking) {
    return { recorded: false };
  }

  if (!taskId || !projectId) {
    logger.warn('Missing taskId or projectId for model performance tracking', AGENT_TAG);
    return { recorded: false };
  }

  const completedAt = new Date().toISOString();

  const taskRecord = {
    taskId,
    projectId,
    plannerModel: plannerModel || '',
    coderModel: coderModel || '',
    reviewerModel: reviewerModel || '',
    reviewScore: reviewScore ?? null,
    reviewCycles,
    durationSeconds,
    cost,
    approved,
    completedAt,
  };

  try {
    const db = getDb();

    // 1. Write per-task record
    await db
      .ref(`metrics/${projectId}/model-performance/tasks/${taskId}`)
      .set(taskRecord);

    // 2. Update aggregates for each role × model combination
    const roleModels = [
      { role: 'planner', model: plannerModel },
      { role: 'coder', model: coderModel },
      { role: 'reviewer', model: reviewerModel },
    ];

    await Promise.all(
      roleModels
        .filter(({ model }) => !!model)
        .map(({ role, model }) =>
          updateModelAggregate(db, projectId, model, role, {
            reviewScore,
            reviewCycles,
            durationSeconds,
            cost,
          }),
        ),
    );

    eventBus.emitEvent(EVENT_TYPES.MODEL_PERFORMANCE_RECORDED, {
      metadata: {
        taskId,
        projectId,
        plannerModel,
        coderModel,
        reviewerModel,
        reviewScore,
        reviewCycles,
        durationSeconds,
      },
    });

    logger.info(
      `Model performance recorded for task ${taskId}: coder=${coderModel}, reviewer=${reviewerModel}, score=${reviewScore ?? 'N/A'}, cycles=${reviewCycles}`,
      AGENT_TAG,
    );

    return { recorded: true };
  } catch (err) {
    logger.warn(`Failed to record model performance metrics: ${err.message}`, AGENT_TAG);
    return { recorded: false };
  }
}

/**
 * Updates the running aggregate for a given model + role combination using a
 * Firebase transaction to avoid race conditions in concurrent runs.
 *
 * Aggregate path: /metrics/{projectId}/model-performance/by-model/{modelKey}/{role}/
 *
 * @param {import('firebase-admin').database.Database} db
 * @param {string} projectId
 * @param {string} model
 * @param {string} role - 'planner' | 'coder' | 'reviewer'
 * @param {Object} metrics
 * @param {number|null} metrics.reviewScore
 * @param {number} metrics.reviewCycles
 * @param {number} metrics.durationSeconds
 * @param {number} metrics.cost
 */
async function updateModelAggregate(db, projectId, model, role, { reviewScore, reviewCycles, durationSeconds, cost }) {
  const modelKey = toFirebaseKey(model);
  const ref = db.ref(`metrics/${projectId}/model-performance/by-model/${modelKey}/${role}`);

  await ref.transaction((current) => {
    if (current === null) {
      // First entry for this model + role
      return {
        model,
        role,
        taskCount: 1,
        avgScore: reviewScore ?? 0,
        scoredTaskCount: reviewScore != null ? 1 : 0,
        avgCycles: reviewCycles,
        avgDurationSeconds: durationSeconds,
        totalCost: cost,
        lastUpdated: new Date().toISOString(),
      };
    }

    const count = (current.taskCount || 0) + 1;
    const scoredCount = (current.scoredTaskCount || 0) + (reviewScore != null ? 1 : 0);

    // Incremental average: new_avg = old_avg + (new_value - old_avg) / new_count
    const newAvgCycles =
      (current.avgCycles || 0) + (reviewCycles - (current.avgCycles || 0)) / count;
    const newAvgDuration =
      (current.avgDurationSeconds || 0) +
      (durationSeconds - (current.avgDurationSeconds || 0)) / count;

    // Score average only over tasks that actually have a score
    let newAvgScore = current.avgScore || 0;
    if (reviewScore != null && scoredCount > 0) {
      newAvgScore =
        (current.avgScore || 0) +
        (reviewScore - (current.avgScore || 0)) / scoredCount;
    }

    return {
      model,
      role,
      taskCount: count,
      avgScore: newAvgScore,
      scoredTaskCount: scoredCount,
      avgCycles: newAvgCycles,
      avgDurationSeconds: newAvgDuration,
      totalCost: (current.totalCost || 0) + cost,
      lastUpdated: new Date().toISOString(),
    };
  });
}

/**
 * Fetches all model performance aggregates for a project.
 *
 * Returns a flat list of { model, role, taskCount, avgScore, avgCycles, avgDurationSeconds, totalCost }.
 *
 * @param {string} projectId
 * @returns {Promise<Array<Object>>}
 */
export async function getModelPerformanceAggregates(projectId) {
  try {
    const db = getDb();
    const snapshot = await db
      .ref(`metrics/${projectId}/model-performance/by-model`)
      .once('value');
    const data = snapshot.val();
    if (!data) return [];

    const results = [];
    for (const [, roleMap] of Object.entries(data)) {
      for (const [, stats] of Object.entries(roleMap)) {
        results.push(stats);
      }
    }
    return results;
  } catch (err) {
    logger.warn(`Failed to load model performance aggregates: ${err.message}`, AGENT_TAG);
    return [];
  }
}

/**
 * Fetches all per-task model performance records for a project.
 *
 * @param {string} projectId
 * @returns {Promise<Array<Object>>}
 */
export async function getModelPerformanceTasks(projectId) {
  try {
    const db = getDb();
    const snapshot = await db
      .ref(`metrics/${projectId}/model-performance/tasks`)
      .once('value');
    const data = snapshot.val();
    if (!data) return [];
    return Object.values(data);
  } catch (err) {
    logger.warn(`Failed to load model performance task records: ${err.message}`, AGENT_TAG);
    return [];
  }
}
