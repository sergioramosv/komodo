import { randomUUID } from 'crypto';
import { getDb } from '../../skills/planning-task-mcp/src/firebase.js';
import { eventBus, EVENT_TYPES } from './event-bus.js';

/**
 * Phases of the task lifecycle.
 */
export const PHASES = {
  PLANNING: 'planning',
  ARCHITECTING: 'architecting',
  CODING: 'coding',
  TESTING: 'testing',
  SECURITY: 'security',
  REVIEWING: 'reviewing',
};

/**
 * Actions that agents can perform.
 */
export const ACTIONS = {
  PICK_TASK: 'pick_task',
  ANALYZE_CODEBASE: 'analyze_codebase',
  IMPLEMENT_TASK: 'implement_task',
  GENERATE_TESTS: 'generate_tests',
  RUN_TESTS: 'run_tests',
  SECURITY_SCAN: 'security_scan',
  REVIEW_PR: 'review_pr',
  FIX_ISSUES: 'fix_issues',
};

/**
 * Creates a structured event object (does not persist it).
 *
 * @param {Object} params
 * @param {string} params.taskId
 * @param {string} params.phase - One of PHASES
 * @param {string} params.agent - Agent name (PLANNER, ARCHITECT, CODER, etc.)
 * @param {string} params.action - One of ACTIONS
 * @param {Object} [params.input] - Input data for the action
 * @param {Object} [params.output] - Output data from the action
 * @param {Object} [params.metrics] - { tokensUsed, turnsUsed, durationMs }
 * @param {Object} [params.context] - Additional context
 * @param {string|null} [params.parentEventId] - ID of the previous event in the chain
 * @returns {Object} Structured event object
 */
export function createStructuredEvent({
  taskId,
  phase,
  agent,
  action,
  input = {},
  output = {},
  metrics = {},
  context = {},
  parentEventId = null,
}) {
  return {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    taskId,
    phase,
    agent,
    action,
    input,
    output,
    metrics: {
      tokensUsed: metrics.tokensUsed ?? null,
      turnsUsed: metrics.turnsUsed ?? null,
      durationMs: metrics.durationMs ?? null,
    },
    context,
    parentEventId,
  };
}

/**
 * Creates, persists and emits a structured event.
 * Stores in Firebase at /structured-events/{projectId}/{taskId}/{eventId}
 * and emits STRUCTURED_EVENT_LOGGED to the EventBus.
 * When metrics.tokensUsed is present, updates cumulative task token metrics.
 *
 * @param {string} projectId
 * @param {Object} params - Same as createStructuredEvent params
 * @returns {Promise<Object>} The persisted event object with its id
 */
export async function emitStructuredEvent(projectId, params) {
  const event = createStructuredEvent(params);

  try {
    const db = getDb();
    // Path uses 'structured-events/' (not '/events/' from AC#3) by intentional Architect decision
    // to avoid collision with the existing EventBus event stream. See architect.json for rationale.
    await db.ref(`structured-events/${projectId}/${event.taskId}/${event.id}`).set(event);
  } catch (err) {
    console.warn(`structured-event-logger: failed to persist event (${err.message})`);
  }

  eventBus.emitEvent(EVENT_TYPES.STRUCTURED_EVENT_LOGGED, {
    agentName: event.agent,
    metadata: {
      eventId: event.id,
      taskId: event.taskId,
      phase: event.phase,
      action: event.action,
      metrics: event.metrics,
      parentEventId: event.parentEventId,
    },
  });

  if (event.metrics.tokensUsed != null) {
    try {
      const db = getDb();
      const metricsRef = db.ref(`task-token-metrics/${projectId}/${event.taskId}`);
      // Use a Firebase transaction to avoid race conditions when multiple agents
      // (e.g. SECURITY + TESTER running in parallel via Promise.allSettled) write concurrently.
      const { snapshot: txSnapshot } = await metricsRef.transaction((current) => {
        const prev = current || { totalTokensUsed: 0, eventCount: 0 };
        return {
          totalTokensUsed: prev.totalTokensUsed + event.metrics.tokensUsed,
          eventCount: prev.eventCount + 1,
          lastUpdated: new Date().toISOString(),
        };
      });
      const updated = txSnapshot.val();

      eventBus.emitEvent(EVENT_TYPES.TASK_TOKEN_METRICS_UPDATED, {
        agentName: event.agent,
        metadata: {
          taskId: event.taskId,
          projectId,
          totalTokensUsed: updated.totalTokensUsed,
          eventCount: updated.eventCount,
        },
      });
    } catch (err) {
      console.warn(`structured-event-logger: failed to update token metrics (${err.message})`);
    }
  }

  return event;
}

/**
 * Retrieves all structured events for a task from Firebase.
 *
 * @param {string} projectId
 * @param {string} taskId
 * @returns {Promise<Object[]>} Array of structured events, sorted by timestamp
 */
export async function getTaskEvents(projectId, taskId) {
  try {
    const db = getDb();
    const snapshot = await db.ref(`structured-events/${projectId}/${taskId}`).once('value');
    const data = snapshot.val();
    if (!data) return [];

    return Object.values(data).sort((a, b) => {
      return new Date(a.timestamp) - new Date(b.timestamp);
    });
  } catch (err) {
    console.warn(`structured-event-logger: failed to fetch task events (${err.message})`);
    return [];
  }
}

/**
 * Retrieves cumulative token metrics for a task from Firebase.
 *
 * @param {string} projectId
 * @param {string} taskId
 * @returns {Promise<Object|null>} Token metrics or null if not found
 */
export async function getTaskTokenMetrics(projectId, taskId) {
  try {
    const db = getDb();
    const snapshot = await db.ref(`task-token-metrics/${projectId}/${taskId}`).once('value');
    return snapshot.val();
  } catch (err) {
    console.warn(`structured-event-logger: failed to fetch token metrics (${err.message})`);
    return null;
  }
}
