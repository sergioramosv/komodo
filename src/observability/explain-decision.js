import { getTaskEvents } from '../events/structured-event-logger.js';
import { getDb } from '../../skills/planning-task-mcp/src/firebase.js';

/**
 * Fetches the model performance record for a specific task.
 * Path: /metrics/{projectId}/model-performance/tasks/{taskId}
 *
 * @param {string} projectId
 * @param {string} taskId
 * @returns {Promise<Object|null>}
 */
export async function getTaskModels(projectId, taskId) {
      try {
            const db = getDb();
            const snapshot = await db
                  .ref(`metrics/${projectId}/model-performance/tasks/${taskId}`)
                  .once('value');
            return snapshot.val();
      } catch (err) {
            console.warn(`explain-decision: failed to fetch task models (${err.message})`);
            return null;
      }
}

/**
 * Reconstructs the decision context for a specific structured event.
 *
 * Returns:
 * - The event itself (agent, phase, action, timestamp)
 * - The exact input the agent received
 * - The output it produced
 * - The model used (from event.context.model or model-performance-tracker record)
 * - Token and timing metrics
 * - The parent event in the chain (if any)
 *
 * @param {string} projectId
 * @param {string} taskId
 * @param {string} eventId
 * @returns {Promise<Object|null>} Decision explanation or null if event not found
 */
export async function explainDecision(projectId, taskId, eventId) {
      const [events, taskModels] = await Promise.all([
            getTaskEvents(projectId, taskId),
            getTaskModels(projectId, taskId),
      ]);

      if (!events.length) return null;

      const event = events.find(e => e.id === eventId);
      if (!event) return null;

      // Find parent event in chain
      const parentEvent = event.parentEventId
            ? events.find(e => e.id === event.parentEventId) || null
            : null;

      // Resolve model: prefer event.context.model, fall back to model-performance-tracker
      let model = event.context?.model || null;
      if (!model && taskModels) {
            const agentToRole = {
                  PLANNER: 'plannerModel',
                  ARCHITECT: null, // not tracked separately in model-performance-tracker
                  CODER: 'coderModel',
                  REVIEWER: 'reviewerModel',
            };
            const roleField = agentToRole[event.agent];
            if (roleField && taskModels[roleField]) {
                  model = taskModels[roleField];
            }
      }

      return {
            eventId: event.id,
            taskId: event.taskId,
            projectId,
            agent: event.agent,
            phase: event.phase,
            action: event.action,
            timestamp: event.timestamp,
            model,
            input: event.input || {},
            output: event.output || {},
            metrics: {
                  tokensUsed: event.metrics?.tokensUsed ?? null,
                  turnsUsed: event.metrics?.turnsUsed ?? null,
                  durationMs: event.metrics?.durationMs ?? null,
            },
            context: event.context || {},
            parentEventId: event.parentEventId || null,
            parentEvent: parentEvent
                  ? {
                          eventId: parentEvent.id,
                          agent: parentEvent.agent,
                          phase: parentEvent.phase,
                          action: parentEvent.action,
                          timestamp: parentEvent.timestamp,
                    }
                  : null,
            taskModels: taskModels || null,
      };
}
