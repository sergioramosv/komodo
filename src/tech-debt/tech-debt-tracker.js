import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { getAll, create } from '../../skills/planning-task-mcp/src/firebase.js';

const AGENT_TAG = 'TECH-DEBT';

/**
 * Extracts minor issues (severity 'suggestion' or 'minor') from a review result.
 *
 * @param {Array<{ severity: string, file?: string, description?: string, line?: number }>} issues
 * @returns {Array<{ severity: string, file: string, description: string, line?: number }>}
 */
export function extractMinorIssues(issues) {
  if (!Array.isArray(issues)) return [];

  return issues.filter(
    i => i.severity === 'suggestion' || i.severity === 'minor',
  );
}

/**
 * Estimates devPoints for a tech-debt task based on severity.
 * - suggestion → 1 devPoint
 * - minor → 2 devPoints
 *
 * @param {string} severity
 * @returns {number}
 */
export function estimateDevPoints(severity) {
  return severity === 'suggestion' ? 1 : 2;
}

/**
 * Builds a deduplication key from file + description.
 *
 * @param {string} file
 * @param {string} description
 * @returns {string}
 */
export function deduplicationKey(file, description) {
  return `${(file || '').toLowerCase()}::${(description || '').toLowerCase()}`;
}

/**
 * Creates tech-debt tasks from minor review issues after an APPROVED review.
 * Deduplicates against existing tech-debt tasks by file+description.
 *
 * @param {Object} options
 * @param {Array<{ severity: string, file?: string, description?: string, line?: number }>} options.issues - Review issues
 * @param {number} options.prNumber - PR number the review came from
 * @param {string} options.projectId - Project ID
 * @returns {Promise<{ created: number, skipped: number, tasks: Array<{ taskId: string, title: string }> }>}
 */
export async function createTechDebtTasks({ issues, prNumber, projectId }) {
  if (!config.techDebtTracking) {
    logger.info('Tech debt tracking disabled (TECH_DEBT_TRACKING=false)', AGENT_TAG);
    return { created: 0, skipped: 0, tasks: [] };
  }

  const minorIssues = extractMinorIssues(issues);

  if (minorIssues.length === 0) {
    logger.info('No minor/suggestion issues to track', AGENT_TAG);
    return { created: 0, skipped: 0, tasks: [] };
  }

  // Load existing tasks for deduplication
  let existingTasks = [];
  try {
    existingTasks = await getAll('tasks');
  } catch (err) {
    logger.warn(`Could not load existing tasks for dedup: ${err.message}`, AGENT_TAG);
  }

  // Build set of existing tech-debt keys
  const existingKeys = new Set(
    existingTasks
      .filter(t => t.source === 'tech-debt')
      .map(t => deduplicationKey(t.techDebtFile || '', t.techDebtDescription || '')),
  );

  let created = 0;
  let skipped = 0;
  const createdTasks = [];

  for (const issue of minorIssues) {
    const file = issue.file || 'unknown';
    const description = issue.description || 'No description';
    const key = deduplicationKey(file, description);

    if (existingKeys.has(key)) {
      logger.info(`Skipping duplicate tech-debt: ${file} - ${description}`, AGENT_TAG);
      skipped++;
      continue;
    }

    const title = `[Tech Debt] ${description} (from PR #${prNumber})`;
    const devPoints = estimateDevPoints(issue.severity);

    const taskData = {
      projectId,
      title,
      userStory: {
        who: 'the development team',
        what: `address tech debt: ${description}`,
        why: `improve code quality in ${file}`,
      },
      acceptanceCriteria: [
        `Fix the ${issue.severity} issue in ${file}`,
        'Ensure no regressions are introduced',
      ],
      bizPoints: 2,
      devPoints,
      status: 'to-do',
      source: 'tech-debt',
      techDebtFile: file,
      techDebtDescription: description,
      techDebtSeverity: issue.severity,
      techDebtLine: issue.line || null,
      originPrNumber: prNumber,
      userId: config.defaultUserId,
      userName: config.defaultUserName || 'Komodo Tech Debt Tracker',
    };

    try {
      const taskId = await create('tasks', taskData);
      createdTasks.push({ taskId, title });
      existingKeys.add(key);
      created++;
      logger.info(`Tech-debt task created: ${title} (${taskId})`, AGENT_TAG);
    } catch (err) {
      logger.error(`Failed to create tech-debt task: ${err.message}`, AGENT_TAG);
    }
  }

  if (created > 0) {
    eventBus.emitEvent(EVENT_TYPES.TECH_DEBT_CREATED, {
      metadata: {
        created,
        skipped,
        prNumber,
        projectId,
        tasks: createdTasks,
      },
    });

    logger.success(
      `Created ${created} tech-debt task(s) from PR #${prNumber} (${skipped} skipped as duplicates)`,
      AGENT_TAG,
    );
  }

  return { created, skipped, tasks: createdTasks };
}
