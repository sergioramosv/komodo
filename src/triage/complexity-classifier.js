import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';

/**
 * Default weights for each complexity signal.
 * Each weight determines how much influence that signal has on the final score.
 */
const DEFAULT_WEIGHTS = {
  devPoints: 0.4,
  acceptanceCriteria: 0.25,
  implementationPlan: 0.15,
  userStoryLength: 0.2,
};

/**
 * Computes a partial score (1-10) based on devPoints.
 *
 * - 1-2 devPoints → low score (1-3)
 * - 3-5 devPoints → medium score (4-6)
 * - 8-13 devPoints → high score (7-10)
 *
 * @param {number|undefined} devPoints
 * @returns {number} Score between 1 and 10
 */
function scoreDevPoints(devPoints) {
  if (!devPoints || devPoints <= 0) return 1;
  if (devPoints <= 2) return Math.round(1 + (devPoints - 1) * 2); // 1→1, 2→3
  if (devPoints <= 5) return Math.round(3 + (devPoints - 2) * 1); // 3→4, 4→5, 5→6
  if (devPoints <= 8) return Math.round(6 + (devPoints - 5) * (1 / 3)); // 6→7, 7→7, 8→7
  return Math.min(10, Math.round(7 + (devPoints - 8) * 0.6)); // 9→8, 10→8, 11→9, 13→10
}

/**
 * Computes a partial score (1-10) based on the number of acceptance criteria.
 *
 * - 0-1 criteria → low (1-2)
 * - 2-4 criteria → medium (3-5)
 * - 5-8 criteria → high (6-8)
 * - 9+ criteria → very high (9-10)
 *
 * @param {number} count
 * @returns {number} Score between 1 and 10
 */
function scoreAcceptanceCriteria(count) {
  if (count <= 0) return 1;
  if (count === 1) return 2;
  if (count <= 4) return Math.round(2 + (count - 1) * 1); // 2→3, 3→4, 4→5
  if (count <= 8) return Math.round(5 + (count - 4) * 0.75); // 5→6, 6→7, 7→7, 8→8
  return Math.min(10, Math.round(8 + (count - 8) * 0.5)); // 9→9, 10→9, 12→10
}

/**
 * Computes a partial score (1-10) based on presence of an implementation plan.
 *
 * Having an implementation plan indicates higher complexity (the task needed detailed planning).
 *
 * @param {boolean} hasImplementationPlan
 * @returns {number} Score between 1 and 10
 */
function scoreImplementationPlan(hasImplementationPlan) {
  return hasImplementationPlan ? 7 : 2;
}

/**
 * Computes a partial score (1-10) based on user story length.
 *
 * Longer user stories generally indicate more complex requirements.
 *
 * @param {number} charCount - Total character count of the user story
 * @returns {number} Score between 1 and 10
 */
function scoreUserStoryLength(charCount) {
  if (charCount <= 0) return 1;
  if (charCount <= 50) return 2;
  if (charCount <= 100) return 3;
  if (charCount <= 200) return 5;
  if (charCount <= 400) return 7;
  if (charCount <= 600) return 8;
  return Math.min(10, 9);
}

/**
 * Extracts the total character length of a user story object.
 *
 * @param {Object|string|undefined} userStory
 * @returns {number} Total character count
 */
function getUserStoryLength(userStory) {
  if (!userStory) return 0;
  if (typeof userStory === 'string') return userStory.length;

  const parts = [userStory.who, userStory.what, userStory.why].filter(Boolean);
  return parts.join(' ').length;
}

/**
 * Gets the count of acceptance criteria from a task.
 *
 * @param {Array|string|undefined} acceptanceCriteria
 * @returns {number}
 */
function getAcceptanceCriteriaCount(acceptanceCriteria) {
  if (!acceptanceCriteria) return 0;
  if (Array.isArray(acceptanceCriteria)) return acceptanceCriteria.length;
  if (typeof acceptanceCriteria === 'string') {
    return acceptanceCriteria.split('\n').filter(line => line.trim().length > 0).length;
  }
  return 0;
}

/**
 * Determines whether a task has an implementation plan.
 *
 * @param {Object} task
 * @returns {boolean}
 */
function hasImplementationPlan(task) {
  if (!task.implementationPlan) return false;
  if (typeof task.implementationPlan === 'string') return task.implementationPlan.trim().length > 0;
  if (Array.isArray(task.implementationPlan)) return task.implementationPlan.length > 0;
  if (typeof task.implementationPlan === 'object') return Object.keys(task.implementationPlan).length > 0;
  return false;
}

/**
 * Classifies the complexity of a task based on multiple signals.
 *
 * Analyzes devPoints, acceptance criteria count, presence of implementation plan,
 * and user story length to produce a weighted complexity score.
 *
 * @param {Object} task - The task to classify
 * @param {number} [task.devPoints] - Development effort points
 * @param {Array|string} [task.acceptanceCriteria] - Acceptance criteria
 * @param {Object|string|Array} [task.implementationPlan] - Implementation plan
 * @param {Object|string} [task.userStory] - User story
 * @param {string} [task.taskId] - Task identifier
 * @returns {{ level: 'trivial'|'standard'|'complex', score: number, reasoning: string }}
 */
export function classifyComplexity(task) {
  const trivialMax = config.complexityTrivialMax;
  const standardMax = config.complexityStandardMax;

  // Compute individual signal scores
  const devPtsScore = scoreDevPoints(task.devPoints);
  const acCount = getAcceptanceCriteriaCount(task.acceptanceCriteria);
  const acScore = scoreAcceptanceCriteria(acCount);
  const hasPlan = hasImplementationPlan(task);
  const planScore = scoreImplementationPlan(hasPlan);
  const storyLength = getUserStoryLength(task.userStory);
  const storyScore = scoreUserStoryLength(storyLength);

  // Weighted combination
  const weights = DEFAULT_WEIGHTS;
  const rawScore =
    devPtsScore * weights.devPoints +
    acScore * weights.acceptanceCriteria +
    planScore * weights.implementationPlan +
    storyScore * weights.userStoryLength;

  // Clamp to 1-10 and round
  const score = Math.max(1, Math.min(10, Math.round(rawScore)));

  // Determine level based on thresholds
  let level;
  if (score <= trivialMax) {
    level = 'trivial';
  } else if (score <= standardMax) {
    level = 'standard';
  } else {
    level = 'complex';
  }

  // Build reasoning string
  const reasons = [];
  reasons.push(`devPoints=${task.devPoints ?? 'N/A'}(${devPtsScore})`);
  reasons.push(`criteria=${acCount}(${acScore})`);
  reasons.push(`plan=${hasPlan ? 'yes' : 'no'}(${planScore})`);
  reasons.push(`storyLen=${storyLength}(${storyScore})`);

  const reasoning = `Score ${score}/10 [${reasons.join(', ')}] → ${level.toUpperCase()}`;

  return { level, score, reasoning };
}

/**
 * Classifies a task and emits the result to the EventBus + logs.
 *
 * This is the main entry point to be called from the orchestration flow,
 * after the Planner selects a task and before invoking the Coder.
 *
 * @param {Object} task - The task to classify
 * @returns {{ level: 'trivial'|'standard'|'complex', score: number, reasoning: string }}
 */
export function classifyAndEmit(task) {
  const result = classifyComplexity(task);

  // Emit event
  eventBus.emitEvent(EVENT_TYPES.TASK_CLASSIFIED, {
    metadata: {
      taskId: task.taskId || null,
      level: result.level,
      score: result.score,
      reasoning: result.reasoning,
    },
  });

  // Log classification
  const levelTag = result.level.toUpperCase();
  logger.info(
    `Task classified as [${levelTag}] (score: ${result.score}/10)`,
    'KOMODO',
  );

  return result;
}
