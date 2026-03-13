import { getTaskEvents, getTaskTokenMetrics } from '../events/structured-event-logger.js';
import { getDb } from '../../skills/planning-task-mcp/src/firebase.js';

/**
 * Computes a diff between two phase state snapshots.
 * Returns an object describing fields that changed.
 *
 * @param {Object|null} prev
 * @param {Object|null} next
 * @returns {Object}
 */
function computeStateDiff(prev, next) {
      if (!prev) return { added: next || {} };
      if (!next) return {};

      const diff = {};
      const allKeys = new Set([...Object.keys(prev), ...Object.keys(next)]);
      for (const key of allKeys) {
            if (JSON.stringify(prev[key]) !== JSON.stringify(next[key])) {
                  diff[key] = { from: prev[key] ?? null, to: next[key] ?? null };
            }
      }
      return diff;
}

/**
 * Groups events by phase and builds per-phase summaries.
 *
 * @param {Object[]} events
 * @returns {Object[]} Array of phase summaries with events and diffs
 */
function buildPhaseSummaries(events) {
      const phaseMap = new Map();

      for (const event of events) {
            const phase = event.phase || 'unknown';
            if (!phaseMap.has(phase)) {
                  phaseMap.set(phase, []);
            }
            phaseMap.get(phase).push(event);
      }

      const phaseSummaries = [];
      let prevPhaseSnapshot = null;

      for (const [phase, phaseEvents] of phaseMap.entries()) {
            const firstEvent = phaseEvents[0];
            const lastEvent = phaseEvents[phaseEvents.length - 1];

            const totalTokens = phaseEvents.reduce((sum, e) => sum + (e.metrics?.tokensUsed ?? 0), 0);
            const agents = [...new Set(phaseEvents.map(e => e.agent).filter(Boolean))];

            const currentSnapshot = {
                  phase,
                  agents,
                  totalTokens,
                  startTimestamp: firstEvent.timestamp,
                  endTimestamp: lastEvent.timestamp,
            };

            const stateDiff = computeStateDiff(prevPhaseSnapshot, currentSnapshot);
            prevPhaseSnapshot = currentSnapshot;

            phaseSummaries.push({
                  phase,
                  agents,
                  totalTokens,
                  startTimestamp: firstEvent.timestamp,
                  endTimestamp: lastEvent.timestamp,
                  eventCount: phaseEvents.length,
                  stateDiff,
                  events: phaseEvents,
            });
      }

      return phaseSummaries;
}

/**
 * Retrieves the complete timeline for a task, including:
 * - All structured events sorted by timestamp
 * - Per-phase breakdowns with state diffs
 * - Cumulative token metrics
 * - Per-agent summaries (input, output, tokens)
 *
 * @param {string} projectId
 * @param {string} taskId
 * @returns {Promise<Object>} Full timeline object
 */
export async function getTaskTimeline(projectId, taskId) {
      const [events, tokenMetrics] = await Promise.all([
            getTaskEvents(projectId, taskId),
            getTaskTokenMetrics(projectId, taskId),
      ]);

      const phases = buildPhaseSummaries(events);

      // Per-agent summary: aggregate input/output/tokens across all events per agent
      const agentMap = new Map();
      for (const event of events) {
            const agent = event.agent || 'UNKNOWN';
            if (!agentMap.has(agent)) {
                  agentMap.set(agent, {
                        agent,
                        events: [],
                        totalTokens: 0,
                        totalTurns: 0,
                        totalDurationMs: 0,
                  });
            }
            const entry = agentMap.get(agent);
            entry.events.push({
                  eventId: event.id,
                  phase: event.phase,
                  action: event.action,
                  timestamp: event.timestamp,
                  input: event.input || {},
                  output: event.output || {},
                  metrics: event.metrics || {},
                  context: event.context || {},
                  parentEventId: event.parentEventId || null,
            });
            entry.totalTokens += event.metrics?.tokensUsed ?? 0;
            entry.totalTurns += event.metrics?.turnsUsed ?? 0;
            entry.totalDurationMs += event.metrics?.durationMs ?? 0;
      }

      const agentSummaries = [...agentMap.values()];

      return {
            taskId,
            projectId,
            eventCount: events.length,
            phases,
            agents: agentSummaries,
            tokenMetrics: tokenMetrics || { totalTokensUsed: 0, eventCount: 0 },
            events,
      };
}

/**
 * Lists task IDs that have structured events within the last N hours.
 *
 * @param {string} projectId
 * @param {number} [hoursBack=48] - How many hours back to look
 * @returns {Promise<string[]>} Array of task IDs
 */
export async function listRecentTaskIds(projectId, hoursBack = 48) {
      try {
            const db = getDb();
            const snapshot = await db.ref(`structured-events/${projectId}`).once('value');
            const data = snapshot.val();
            if (!data) return [];

            const cutoff = Date.now() - hoursBack * 60 * 60 * 1000;
            const taskIds = [];

            for (const [taskId, taskEvents] of Object.entries(data)) {
                  // Check if any event is within the time window
                  const eventValues = Object.values(taskEvents);
                  const hasRecentEvent = eventValues.some(event => {
                        const ts = event.timestamp ? new Date(event.timestamp).getTime() : 0;
                        return ts >= cutoff;
                  });
                  if (hasRecentEvent) {
                        taskIds.push(taskId);
                  }
            }

            return taskIds;
      } catch (err) {
            console.warn(`task-timeline: failed to list recent tasks (${err.message})`);
            return [];
      }
}
