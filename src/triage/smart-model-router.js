import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { selectModel } from './model-selector.js';
import { getDb } from '../../skills/planning-task-mcp/src/firebase.js';

const AGENT_TAG = 'SMART-ROUTER';

const MIN_TASKS = config.smartModelRoutingMinTasks;

/**
 * Ordered model tiers per CLI (lightest → most powerful).
 * Used by escalateModel() to find the next tier up.
 */
const MODEL_TIERS = {
  claude: ['haiku', 'sonnet', 'opus'],
  codex: ['codex-mini', 'o4-mini', 'o3'],
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro'],
};

/**
 * Converts a model name to a Firebase-safe key (dots → underscores).
 * @param {string} model
 * @returns {string}
 */
function toFirebaseKey(model) {
  return model.replace(/\./g, '_');
}

/**
 * Loads routing metrics for a specific role from Firebase.
 * Returns a map of { modelKey → metrics } or null if unavailable.
 *
 * @param {string} projectId
 * @param {string} role - lowercase role name (coder, reviewer)
 * @returns {Promise<Object|null>}
 */
async function loadRoutingMetrics(projectId, role) {
  try {
    const db = getDb();
    const snapshot = await db.ref(`metrics/${projectId}/model-routing/${role}`).once('value');
    return snapshot.val();
  } catch (err) {
    logger.warn(`Could not load routing metrics for ${role}: ${err.message}`, AGENT_TAG);
    return null;
  }
}

/**
 * Selects the optimal model using epsilon-greedy scoring over learned metrics.
 *
 * Algorithm:
 *  - Load /metrics/{projectId}/model-routing/{role}/{modelKey} for each candidate
 *  - If any candidate has < MIN_TASKS → fallback to selectModel() (not enough data)
 *  - Scoring: efficiencyScore = approvedFirstCycle/totalTasks, qualityScore = avgReviewScore/10
 *    totalScore = efficiencyScore * 0.5 + qualityScore * 0.5
 *  - Epsilon-greedy: 10% → random candidate, 90% → highest scoring candidate
 *
 * @param {Object} options
 * @param {string} options.cliType - CLI name (claude, codex, gemini)
 * @param {string} options.agentRole - Agent role (CODER, REVIEWER)
 * @param {string} options.complexityLevel - trivial | standard | complex
 * @param {Object} [options.taskSpec] - Task specification
 * @param {string} [options.projectId] - Firebase project ID
 * @param {string} [options.taskOverride] - Per-task model override (highest priority)
 * @returns {Promise<string|null>}
 */
export async function selectModelSmart({
  cliType,
  agentRole,
  complexityLevel,
  taskSpec,
  projectId,
  taskOverride,
}) {
  // Guard: feature disabled → static fallback
  if (!config.smartModelRouting) {
    return selectModel(cliType, agentRole, complexityLevel, taskOverride);
  }

  // taskOverride has maximum priority — bypass smart routing entirely
  if (taskOverride) return taskOverride;

  const cli = cliType.toLowerCase();
  const role = agentRole.toUpperCase();
  const effectiveProjectId = projectId || config.defaultProjectId;

  // Get candidate models for this CLI tier
  const tiers = MODEL_TIERS[cli];
  if (!tiers || tiers.length === 0) {
    return selectModel(cliType, agentRole, complexityLevel, taskOverride);
  }

  // Load metrics for this role
  const metricsMap = effectiveProjectId
    ? await loadRoutingMetrics(effectiveProjectId, agentRole.toLowerCase())
    : null;

  // Check if all candidates have sufficient data
  const hasSufficientData = metricsMap != null && tiers.every(model => {
    const key = toFirebaseKey(model);
    const m = metricsMap[key];
    return m && (m.totalTasks || 0) >= MIN_TASKS;
  });

  if (!hasSufficientData) {
    logger.info(
      `Smart routing: insufficient data for ${role} (need ${MIN_TASKS} tasks/model) → static fallback`,
      AGENT_TAG,
    );
    return selectModel(cliType, agentRole, complexityLevel, taskOverride);
  }

  // Score each candidate
  const scored = tiers.map(model => {
    const key = toFirebaseKey(model);
    const m = metricsMap[key];
    const efficiencyScore = m.totalTasks > 0 ? (m.approvedFirstCycle || 0) / m.totalTasks : 0;
    const qualityScore = m.avgReviewScore != null ? m.avgReviewScore / 10 : 0;
    const totalScore = efficiencyScore * 0.5 + qualityScore * 0.5;
    return { model, totalScore };
  });

  let selectedModel;
  let selectionMethod;

  // Epsilon-greedy: 10% explore, 90% exploit
  if (Math.random() < 0.1) {
    // Exploration: pick random candidate
    selectedModel = tiers[Math.floor(Math.random() * tiers.length)];
    selectionMethod = 'explore';
  } else {
    // Exploitation: pick highest score
    scored.sort((a, b) => b.totalScore - a.totalScore);
    selectedModel = scored[0].model;
    selectionMethod = 'exploit';
  }

  logger.info(
    `Smart routing: ${role} → ${selectedModel} (${selectionMethod}) [scores: ${scored.map(s => `${s.model}=${s.totalScore.toFixed(2)}`).join(', ')}]`,
    AGENT_TAG,
  );

  eventBus.emitEvent(EVENT_TYPES.SMART_ROUTING_APPLIED, {
    metadata: {
      cliType: cli,
      agentRole: role,
      complexityLevel,
      selectedModel,
      selectionMethod,
      scores: scored,
    },
  });

  return selectedModel;
}

/**
 * Returns the next higher-tier model for a given CLI and current model.
 * Returns null if the current model is already the highest tier.
 *
 * @param {string} cliType - CLI name (claude, codex, gemini)
 * @param {string} currentModel - Current model name
 * @returns {string|null}
 */
export function escalateModel(cliType, currentModel) {
  const cli = cliType.toLowerCase();
  const tiers = MODEL_TIERS[cli];
  if (!tiers) return null;

  const idx = tiers.indexOf(currentModel);
  if (idx === -1 || idx === tiers.length - 1) return null;

  return tiers[idx + 1];
}

/**
 * Records the outcome of a routing decision to Firebase for future learning.
 *
 * Writes/updates aggregate at:
 * /metrics/{projectId}/model-routing/{role}/{modelKey}/
 *
 * Fields: model, role, totalTasks, approvedFirstCycle, avgTokens, avgReviewScore,
 * scoredTaskCount, byComplexity, byTaskType, lastUpdated
 *
 * @param {Object} options
 * @param {string} options.projectId
 * @param {string} options.role - lowercase role (coder, reviewer)
 * @param {string} options.model - Model name used
 * @param {boolean} options.approved - Whether the PR was approved
 * @param {boolean} options.approvedFirstCycle - Approved in the first review cycle
 * @param {number|null} [options.reviewScore] - Final review score (0–10)
 * @param {number} [options.tokenCount] - Token count (0 if unavailable)
 * @param {string} [options.complexityLevel] - trivial | standard | complex
 * @param {string} [options.taskType] - feature | bug | etc.
 * @returns {Promise<void>}
 */
export async function recordRoutingOutcome({
  projectId,
  role,
  model,
  approved,
  approvedFirstCycle,
  reviewScore,
  tokenCount = 0,
  complexityLevel = 'standard',
  taskType = 'feature',
}) {
  if (!config.smartModelRouting) return;
  if (!projectId || !model) return;

  try {
    const db = getDb();
    const modelKey = toFirebaseKey(model);
    const ref = db.ref(`metrics/${projectId}/model-routing/${role}/${modelKey}`);

    await ref.transaction((current) => {
      const lastUpdated = new Date().toISOString();

      if (current === null) {
        // First record for this model + role
        const byComplexity = {
          trivial: { count: 0, approved: 0 },
          standard: { count: 0, approved: 0 },
          complex: { count: 0, approved: 0 },
        };
        const byTaskType = {};

        if (byComplexity[complexityLevel]) {
          byComplexity[complexityLevel].count = 1;
          byComplexity[complexityLevel].approved = approved ? 1 : 0;
        }
        byTaskType[taskType] = { count: 1 };

        return {
          model,
          role,
          totalTasks: 1,
          approvedFirstCycle: approvedFirstCycle ? 1 : 0,
          avgTokens: tokenCount,
          avgReviewScore: reviewScore ?? null,
          scoredTaskCount: reviewScore != null ? 1 : 0,
          byComplexity,
          byTaskType,
          lastUpdated,
        };
      }

      const totalTasks = (current.totalTasks || 0) + 1;
      const newApprovedFirstCycle = (current.approvedFirstCycle || 0) + (approvedFirstCycle ? 1 : 0);

      // Incremental average for tokens
      const newAvgTokens =
        (current.avgTokens || 0) + (tokenCount - (current.avgTokens || 0)) / totalTasks;

      // Score average only over scored tasks
      const scoredTaskCount = (current.scoredTaskCount || 0) + (reviewScore != null ? 1 : 0);
      let newAvgReviewScore = current.avgReviewScore ?? null;
      if (reviewScore != null && scoredTaskCount > 0) {
        const prevAvg = current.avgReviewScore ?? 0;
        newAvgReviewScore = prevAvg + (reviewScore - prevAvg) / scoredTaskCount;
      }

      // Update byComplexity
      const byComplexity = current.byComplexity || {
        trivial: { count: 0, approved: 0 },
        standard: { count: 0, approved: 0 },
        complex: { count: 0, approved: 0 },
      };
      if (byComplexity[complexityLevel]) {
        byComplexity[complexityLevel] = {
          count: (byComplexity[complexityLevel].count || 0) + 1,
          approved: (byComplexity[complexityLevel].approved || 0) + (approved ? 1 : 0),
        };
      }

      // Update byTaskType
      const byTaskType = current.byTaskType || {};
      byTaskType[taskType] = {
        count: ((byTaskType[taskType]?.count) || 0) + 1,
      };

      return {
        model,
        role,
        totalTasks,
        approvedFirstCycle: newApprovedFirstCycle,
        avgTokens: newAvgTokens,
        avgReviewScore: newAvgReviewScore,
        scoredTaskCount,
        byComplexity,
        byTaskType,
        lastUpdated,
      };
    });

    logger.info(
      `Routing outcome recorded: role=${role}, model=${model}, approved=${approved}, approvedFirstCycle=${approvedFirstCycle}`,
      AGENT_TAG,
    );
  } catch (err) {
    logger.warn(`Failed to record routing outcome: ${err.message}`, AGENT_TAG);
  }
}
