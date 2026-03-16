import { getTaskTimeline, listRecentTaskIds } from './task-timeline.js';
import { explainDecision, getTaskModels } from './explain-decision.js';
import { getRecentAlerts } from './anomaly-detector.js';
import { logger } from '../utils/logger.js';

/**
 * Replay System — reconstructs the full execution of a task for post-mortem analysis.
 *
 * Combines task timeline, decision explanations, model choices, and anomaly alerts
 * into a single, navigable replay object.
 */

/**
 * Generates a full replay of a task execution.
 *
 * Includes:
 * - Complete timeline with per-phase breakdowns
 * - Decision chain: why each agent did what it did
 * - Model routing decisions and outcomes
 * - Anomaly alerts that fired during execution
 * - Cost and token breakdown per agent and phase
 *
 * @param {string} projectId
 * @param {string} taskId
 * @returns {Promise<Object>} Full replay object
 */
export async function replayTask(projectId, taskId) {
  const [timeline, taskModels, alerts] = await Promise.all([
    getTaskTimeline(projectId, taskId),
    getTaskModels(projectId, taskId),
    getRecentAlerts().catch(() => []),
  ]);

  if (!timeline || timeline.eventCount === 0) {
    return {
      taskId,
      projectId,
      status: 'no-data',
      message: `No events found for task ${taskId}`,
    };
  }

  // Filter alerts relevant to this task
  const taskAlerts = alerts.filter(a => a.taskId === taskId);

  // Build decision chain: for each agent's key events, explain the decision
  const decisionChain = [];
  const keyActions = new Set(['plan_selected', 'architect_plan', 'code_implemented', 'tests_generated', 'security_scan', 'review_verdict', 'merge']);

  for (const event of timeline.events) {
    if (keyActions.has(event.action) || event.metrics?.tokensUsed > 5000) {
      try {
        const explanation = await explainDecision(projectId, taskId, event.id);
        if (explanation) {
          decisionChain.push({
            step: decisionChain.length + 1,
            agent: explanation.agent,
            phase: explanation.phase,
            action: explanation.action,
            model: explanation.model,
            timestamp: explanation.timestamp,
            tokensUsed: explanation.metrics.tokensUsed,
            durationMs: explanation.metrics.durationMs,
            inputSummary: summarizeInput(explanation.input),
            outputSummary: summarizeOutput(explanation.output),
          });
        }
      } catch {
        // Skip events we can't explain
      }
    }
  }

  // Compute cost breakdown
  const costBreakdown = {};
  for (const agent of timeline.agents) {
    costBreakdown[agent.agent] = {
      tokens: agent.totalTokens,
      turns: agent.totalTurns,
      durationMs: agent.totalDurationMs,
      eventCount: agent.events.length,
    };
  }

  return {
    taskId,
    projectId,
    status: 'complete',
    eventCount: timeline.eventCount,
    phases: timeline.phases.map(p => ({
      phase: p.phase,
      agents: p.agents,
      totalTokens: p.totalTokens,
      startTimestamp: p.startTimestamp,
      endTimestamp: p.endTimestamp,
      eventCount: p.eventCount,
    })),
    decisionChain,
    costBreakdown,
    tokenMetrics: timeline.tokenMetrics,
    modelChoices: taskModels || {},
    alerts: taskAlerts,
  };
}

/**
 * Lists tasks available for replay within the specified time window.
 *
 * @param {string} projectId
 * @param {number} [hoursBack=48]
 * @returns {Promise<string[]>}
 */
export async function listReplayableTasks(projectId, hoursBack = 48) {
  return listRecentTaskIds(projectId, hoursBack);
}

/**
 * Generates a human-readable summary of a task replay.
 *
 * @param {Object} replay - Output of replayTask()
 * @returns {string}
 */
export function formatReplaySummary(replay) {
  if (replay.status === 'no-data') return replay.message;

  const lines = [
    `=== Task Replay: ${replay.taskId} ===`,
    `Events: ${replay.eventCount} | Phases: ${replay.phases.length}`,
    '',
    '--- Phases ---',
  ];

  for (const phase of replay.phases) {
    const duration = phase.endTimestamp && phase.startTimestamp
      ? Math.round((new Date(phase.endTimestamp) - new Date(phase.startTimestamp)) / 1000)
      : '?';
    lines.push(`  ${phase.phase}: ${phase.eventCount} events, ${phase.totalTokens} tokens, ${duration}s`);
  }

  if (replay.decisionChain.length > 0) {
    lines.push('', '--- Decision Chain ---');
    for (const d of replay.decisionChain) {
      lines.push(`  ${d.step}. [${d.agent}] ${d.action} (${d.model || 'unknown'}) — ${d.tokensUsed ?? '?'} tokens`);
    }
  }

  if (replay.alerts.length > 0) {
    lines.push('', '--- Alerts ---');
    for (const a of replay.alerts) {
      lines.push(`  ⚠ ${a.type}: ${a.message}`);
    }
  }

  lines.push('', '--- Cost Breakdown ---');
  for (const [agent, cost] of Object.entries(replay.costBreakdown)) {
    lines.push(`  ${agent}: ${cost.tokens} tokens, ${cost.turns} turns, ${Math.round(cost.durationMs / 1000)}s`);
  }

  return lines.join('\n');
}

/** @private */
function summarizeInput(input) {
  if (!input || typeof input !== 'object') return null;
  const keys = Object.keys(input);
  if (keys.length === 0) return null;
  return keys.length <= 3
    ? keys.join(', ')
    : `${keys.slice(0, 3).join(', ')} +${keys.length - 3} more`;
}

/** @private */
function summarizeOutput(output) {
  if (!output || typeof output !== 'object') return null;
  if (output.verdict) return `verdict: ${output.verdict}`;
  if (output.summary) return output.summary.slice(0, 100);
  const keys = Object.keys(output);
  return keys.length > 0 ? keys.join(', ') : null;
}
