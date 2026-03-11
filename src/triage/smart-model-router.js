import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { getDb } from '../../skills/planning-task-mcp/src/firebase.js';

const AGENT_TAG = 'SMART-ROUTER';

/**
 * Escalation chains: for each CLI, ordered from cheapest to most capable model.
 * When a model needs to escalate, it moves to the next in the chain.
 */
const ESCALATION_CHAINS = {
  claude: ['haiku', 'sonnet', 'opus'],
  codex: ['codex-mini', 'o4-mini', 'o3'],
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro'],
};

/**
 * Converts a model name to a Firebase-safe key (dots/hyphens → underscores).
 * @param {string} model
 * @returns {string}
 */
function toFirebaseKey(model) {
  return model.replace(/[.\-]/g, '_');
}

/**
 * Returns the next more-capable model in the escalation chain for a given CLI.
 * If already at the top, returns the same model.
 *
 * @param {string} cliType - CLI name (claude, codex, gemini)
 * @param {string} currentModel - Current model name
 * @returns {string} Escalated model name
 */
export function getEscalationModel(cliType, currentModel) {
  const chain = ESCALATION_CHAINS[cliType.toLowerCase()];
  if (!chain) return currentModel;

  const idx = chain.indexOf(currentModel);
  if (idx === -1 || idx >= chain.length - 1) return currentModel;

  return chain[idx + 1];
}

/**
 * Computes a combined score for a model based on its historical metrics.
 *
 * Score = 0.4 * tokenEfficiency + 0.6 * qualityScore
 *
 * - tokenEfficiency = approvedFirstCycle / totalTasks
 *   (proxy for efficiency: first-pass approval means fewer fix cycles)
 * - qualityScore = avgReviewScore / 10
 *
 * @param {{ totalTasks: number, approvedFirstCycle: number, avgReviewScore: number }} stats
 * @returns {number} Score between 0 and 1
 */
function scoreModel(stats) {
  const { totalTasks, approvedFirstCycle, avgReviewScore } = stats;

  if (!totalTasks || totalTasks <= 0) return 0;

  const tokenEfficiency = approvedFirstCycle / totalTasks;
  const qualityScore = (avgReviewScore || 0) / 10;

  return 0.4 * tokenEfficiency + 0.6 * qualityScore;
}

/**
 * Fetches routing stats for all models under a given role+complexity+taskType from Firebase.
 *
 * Path: /metrics/{projectId}/model-routing/{cliType}/{role}/
 *
 * @param {string} projectId
 * @param {string} cliType
 * @param {string} role
 * @returns {Promise<Array<{ model: string, score: number, totalTasks: number, stats: Object }>>}
 */
async function fetchModelStats(projectId, cliType, role) {
  try {
    const db = getDb();
    const snapshot = await db
      .ref(`metrics/${projectId}/model-routing/${cliType.toLowerCase()}/${role.toUpperCase()}`)
      .once('value');

    const data = snapshot.val();
    if (!data) return [];

    return Object.entries(data).map(([modelKey, stats]) => ({
      model: stats.model || modelKey,
      score: scoreModel(stats),
      totalTasks: stats.totalTasks || 0,
      stats,
    }));
  } catch (err) {
    logger.warn(`Could not fetch routing stats: ${err.message}`, AGENT_TAG);
    return [];
  }
}

/**
 * Selects the best model using epsilon-greedy strategy.
 *
 * - 90% of the time: pick the model with the highest combined score (exploit)
 * - 10% of the time: pick a random model from available options (explore)
 *
 * Returns null if no valid candidates are found.
 *
 * @param {Array<{ model: string, score: number, totalTasks: number }>} candidates
 * @returns {{ model: string, source: 'exploit'|'explore' } | null}
 */
function epsilonGreedySelect(candidates) {
  if (!candidates || candidates.length === 0) return null;

  // Epsilon-greedy: 10% random exploration
  const epsilon = 0.1;
  if (Math.random() < epsilon) {
    const randomIdx = Math.floor(Math.random() * candidates.length);
    return { model: candidates[randomIdx].model, source: 'explore' };
  }

  // 90% exploit: pick best score
  const best = candidates.reduce((a, b) => (a.score >= b.score ? a : b));
  return { model: best.model, source: 'exploit' };
}

/**
 * Selects a model using learned routing data (epsilon-greedy).
 *
 * Falls back to null (static selection) if:
 * - Smart routing is disabled
 * - No historical data (< MIN_TASKS tasks per model)
 * - Firebase unavailable
 *
 * @param {Object} options
 * @param {string} options.projectId
 * @param {string} options.cliType
 * @param {string} options.agentRole - PLANNER | CODER | REVIEWER | etc.
 * @param {string} options.complexityLevel - trivial | standard | complex
 * @param {string} [options.taskType] - feature | bug | refactor | etc.
 * @returns {Promise<{ model: string | null, source: string }>}
 */
export async function selectModelSmart({ projectId, cliType, agentRole, complexityLevel, taskType }) {
  if (!config.smartModelRouting) {
    return { model: null, source: 'disabled' };
  }

  const minTasks = config.smartModelRoutingMinTasks;

  try {
    const allStats = await fetchModelStats(projectId, cliType, agentRole);

    // Filter models that have complexity-matching data and minimum task count
    const eligible = allStats.filter(({ stats, totalTasks }) => {
      if (totalTasks < minTasks) return false;

      // If we have complexity-specific data, check it has enough tasks
      if (stats.byComplexity?.[complexityLevel]) {
        return stats.byComplexity[complexityLevel].count >= minTasks;
      }

      // Fall back to global task count
      return totalTasks >= minTasks;
    });

    if (eligible.length === 0) {
      logger.info(
        `Smart router: not enough data for ${cliType}/${agentRole}/${complexityLevel} (< ${minTasks} tasks). Using static selection.`,
        AGENT_TAG,
      );
      return { model: null, source: 'insufficient-data' };
    }

    // Score each eligible model, preferring complexity-specific score when available
    const scored = eligible.map(({ model, stats, totalTasks }) => {
      let score;
      if (stats.byComplexity?.[complexityLevel]) {
        const c = stats.byComplexity[complexityLevel];
        score = scoreModel({
          totalTasks: c.count,
          approvedFirstCycle: c.approvedFirstCycle || 0,
          avgReviewScore: c.avgReviewScore || 0,
        });
      } else {
        score = scoreModel(stats);
      }
      return { model, score, totalTasks };
    });

    const selection = epsilonGreedySelect(scored);
    if (!selection) return { model: null, source: 'no-candidates' };

    logger.info(
      `Smart router: selected "${selection.model}" for ${cliType}/${agentRole}/${complexityLevel} (${selection.source}, ${eligible.length} candidates)`,
      AGENT_TAG,
    );

    eventBus.emitEvent(EVENT_TYPES.MODEL_ROUTING_SELECTED, {
      metadata: {
        projectId,
        cliType,
        agentRole,
        complexityLevel,
        taskType: taskType || null,
        model: selection.model,
        source: selection.source,
        candidates: scored.length,
      },
    });

    return { model: selection.model, source: selection.source };
  } catch (err) {
    logger.warn(`Smart router error: ${err.message}`, AGENT_TAG);
    return { model: null, source: 'error' };
  }
}

/**
 * Records routing metrics for a completed task cycle to Firebase.
 *
 * Path: /metrics/{projectId}/model-routing/{cliType}/{role}/{modelKey}/
 *
 * Stored fields: model, totalTasks, approvedFirstCycle, avgTokens, avgReviewScore,
 *   byComplexity, byTaskType, lastUpdated
 *
 * @param {Object} options
 * @param {string} options.taskId
 * @param {string} options.projectId
 * @param {string} options.cliType
 * @param {string} options.agentRole - CODER | REVIEWER | etc.
 * @param {string} options.model - Model that was used
 * @param {string} options.complexityLevel - trivial | standard | complex
 * @param {string} [options.taskType] - feature | bug | refactor | etc.
 * @param {boolean} options.approvedFirstCycle - Whether PR was approved in the first review cycle
 * @param {number|null} options.reviewScore - Final review score (0-10)
 * @param {number} [options.tokens] - Token count (best effort, 0 if unavailable)
 * @returns {Promise<{ recorded: boolean }>}
 */
export async function recordRoutingMetrics({
  taskId,
  projectId,
  cliType,
  agentRole,
  model,
  complexityLevel,
  taskType,
  approvedFirstCycle,
  reviewScore,
  tokens = 0,
}) {
  if (!config.smartModelRouting) {
    return { recorded: false };
  }

  if (!taskId || !projectId || !model) {
    logger.warn('Missing required fields for routing metrics recording', AGENT_TAG);
    return { recorded: false };
  }

  const modelKey = toFirebaseKey(model);
  const safeTokens = Number.isFinite(tokens) ? tokens : 0;
  const safeScore = Number.isFinite(reviewScore) ? reviewScore : null;
  const lastUpdated = new Date().toISOString();

  try {
    const db = getDb();
    const ref = db.ref(
      `metrics/${projectId}/model-routing/${cliType.toLowerCase()}/${agentRole.toUpperCase()}/${modelKey}`,
    );

    await ref.transaction((current) => {
      if (current === null) {
        // First record for this model+role combination
        const byComplexity = {};
        byComplexity[complexityLevel] = {
          count: 1,
          approvedFirstCycle: approvedFirstCycle ? 1 : 0,
          avgReviewScore: safeScore ?? 0,
        };

        const byTaskType = {};
        if (taskType) {
          byTaskType[taskType] = {
            count: 1,
            approvedFirstCycle: approvedFirstCycle ? 1 : 0,
            avgReviewScore: safeScore ?? 0,
          };
        }

        return {
          model,
          totalTasks: 1,
          approvedFirstCycle: approvedFirstCycle ? 1 : 0,
          avgTokens: safeTokens,
          avgReviewScore: safeScore ?? 0,
          scoredTaskCount: safeScore != null ? 1 : 0,
          byComplexity,
          byTaskType,
          lastUpdated,
        };
      }

      const totalTasks = (current.totalTasks || 0) + 1;
      const newApprovedFirstCycle = (current.approvedFirstCycle || 0) + (approvedFirstCycle ? 1 : 0);

      // Incremental averages
      const newAvgTokens =
        (current.avgTokens || 0) + (safeTokens - (current.avgTokens || 0)) / totalTasks;

      const scoredCount = (current.scoredTaskCount || 0) + (safeScore != null ? 1 : 0);
      let newAvgScore = current.avgReviewScore || 0;
      if (safeScore != null && scoredCount > 0) {
        newAvgScore =
          (current.avgReviewScore || 0) +
          (safeScore - (current.avgReviewScore || 0)) / scoredCount;
      }

      // Update byComplexity
      const byComplexity = { ...(current.byComplexity || {}) };
      const prevC = byComplexity[complexityLevel] || { count: 0, approvedFirstCycle: 0, avgReviewScore: 0 };
      const newCCount = prevC.count + 1;
      const newCApproved = prevC.approvedFirstCycle + (approvedFirstCycle ? 1 : 0);
      let newCAvgScore = prevC.avgReviewScore || 0;
      if (safeScore != null) {
        newCAvgScore = prevC.avgReviewScore + (safeScore - prevC.avgReviewScore) / newCCount;
      }
      byComplexity[complexityLevel] = {
        count: newCCount,
        approvedFirstCycle: newCApproved,
        avgReviewScore: newCAvgScore,
      };

      // Update byTaskType
      const byTaskType = { ...(current.byTaskType || {}) };
      if (taskType) {
        const prevT = byTaskType[taskType] || { count: 0, approvedFirstCycle: 0, avgReviewScore: 0 };
        const newTCount = prevT.count + 1;
        const newTApproved = prevT.approvedFirstCycle + (approvedFirstCycle ? 1 : 0);
        let newTAvgScore = prevT.avgReviewScore || 0;
        if (safeScore != null) {
          newTAvgScore = prevT.avgReviewScore + (safeScore - prevT.avgReviewScore) / newTCount;
        }
        byTaskType[taskType] = {
          count: newTCount,
          approvedFirstCycle: newTApproved,
          avgReviewScore: newTAvgScore,
        };
      }

      return {
        model,
        totalTasks,
        approvedFirstCycle: newApprovedFirstCycle,
        avgTokens: newAvgTokens,
        avgReviewScore: newAvgScore,
        scoredTaskCount: scoredCount,
        byComplexity,
        byTaskType,
        lastUpdated,
      };
    });

    eventBus.emitEvent(EVENT_TYPES.MODEL_ROUTING_RECORDED, {
      metadata: {
        taskId,
        projectId,
        cliType,
        agentRole,
        model,
        complexityLevel,
        taskType: taskType || null,
        approvedFirstCycle,
        reviewScore: safeScore,
      },
    });

    logger.info(
      `Routing metrics recorded: ${cliType}/${agentRole}/${model} [${complexityLevel}] approved1st=${approvedFirstCycle} score=${safeScore ?? 'N/A'}`,
      AGENT_TAG,
    );

    return { recorded: true };
  } catch (err) {
    logger.warn(`Failed to record routing metrics: ${err.message}`, AGENT_TAG);
    return { recorded: false };
  }
}
