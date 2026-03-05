import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { create, getAll } from '../../skills/planning-task-mcp/src/firebase.js';
import { runGh, runGhApi } from '../../skills/github-mcp/src/gh-cli.js';

const AGENT_TAG = 'ISSUE-SYNC';

/**
 * Fetches open GitHub issues with the configured label.
 *
 * @param {string} repo - Repository in owner/repo format
 * @param {string} label - Label to filter issues by
 * @returns {Array<Object>} Array of issue objects
 */
export function fetchLabeledIssues(repo, label) {
  return runGh(
    ['issue', 'list', '--repo', repo, '--label', label, '--state', 'open', '--json', 'number,title,body,labels,url'],
    { json: true },
  ) || [];
}

/**
 * Extracts a user story from the issue body using simple heuristics.
 * Looks for "Como...", "Quiero...", "Para..." patterns (Spanish)
 * and "As a...", "I want...", "So that..." patterns (English).
 * Falls back to the issue title/body if no pattern is found.
 *
 * @param {string} title - Issue title
 * @param {string} body - Issue body (markdown)
 * @returns {{ who: string, what: string, why: string }}
 */
export function extractUserStory(title, body = '') {
  const text = body || '';

  // Try Spanish pattern
  const esWho = text.match(/[Cc]omo\s+(.+?)(?:\n|,\s*[Qq]uiero)/s);
  const esWhat = text.match(/[Qq]uiero\s+(.+?)(?:\n|,\s*[Pp]ara)/s);
  const esWhy = text.match(/[Pp]ara\s+(.+?)(?:\n|$)/s);

  if (esWho && esWhat && esWhy) {
    return {
      who: esWho[1].trim(),
      what: esWhat[1].trim(),
      why: esWhy[1].trim(),
    };
  }

  // Try English pattern
  const enWho = text.match(/[Aa]s\s+(?:a|an)\s+(.+?)(?:\n|,\s*[Ii]\s+want)/s);
  const enWhat = text.match(/[Ii]\s+want\s+(.+?)(?:\n|,\s*[Ss]o\s+that)/s);
  const enWhy = text.match(/[Ss]o\s+that\s+(.+?)(?:\n|$)/s);

  if (enWho && enWhat && enWhy) {
    return {
      who: enWho[1].trim(),
      what: enWhat[1].trim(),
      why: enWhy[1].trim(),
    };
  }

  // Fallback: use title as what, generic who/why
  return {
    who: 'a user of the application',
    what: title,
    why: body ? body.split('\n')[0].substring(0, 200) : 'improve the application',
  };
}

/**
 * Extracts acceptance criteria from the issue body.
 * Looks for checkbox lists (- [ ]) or numbered lists under an "Acceptance Criteria" header.
 *
 * @param {string} body - Issue body (markdown)
 * @returns {string[]}
 */
export function extractAcceptanceCriteria(body = '') {
  const criteria = [];

  // Match checkbox items: - [ ] or - [x]
  const checkboxes = body.match(/^[-*]\s+\[[ x]\]\s+.+$/gm);
  if (checkboxes && checkboxes.length > 0) {
    for (const line of checkboxes) {
      const text = line.replace(/^[-*]\s+\[[ x]\]\s+/, '').trim();
      if (text) criteria.push(text);
    }
  }

  // If no checkboxes, try numbered list items
  if (criteria.length === 0) {
    const numbered = body.match(/^\d+\.\s+.+$/gm);
    if (numbered) {
      for (const line of numbered) {
        const text = line.replace(/^\d+\.\s+/, '').trim();
        if (text) criteria.push(text);
      }
    }
  }

  // Fallback: at least one criterion from the title concept
  if (criteria.length === 0) {
    criteria.push('Feature implemented as described in the issue');
  }

  return criteria;
}

/**
 * Adds a comment to a GitHub issue.
 *
 * @param {string} repo - Repository in owner/repo format
 * @param {number} issueNumber - Issue number
 * @param {string} comment - Comment body
 */
export function commentOnIssue(repo, issueNumber, comment) {
  runGhApi(`/repos/${repo}/issues/${issueNumber}/comments`, {
    method: 'POST',
    body: { body: comment },
  });
}

/**
 * Replaces a label on a GitHub issue.
 * Removes the old label and adds the new one.
 *
 * @param {string} repo - Repository in owner/repo format
 * @param {number} issueNumber - Issue number
 * @param {string} oldLabel - Label to remove
 * @param {string} newLabel - Label to add
 */
export function swapLabel(repo, issueNumber, oldLabel, newLabel) {
  // Remove old label
  runGhApi(`/repos/${repo}/issues/${issueNumber}/labels/${encodeURIComponent(oldLabel)}`, {
    method: 'DELETE',
  });
  // Add new label
  runGhApi(`/repos/${repo}/issues/${issueNumber}/labels`, {
    method: 'POST',
    body: { labels: [newLabel] },
  });
}

/**
 * Checks if a task already exists for a given GitHub issue number.
 *
 * @param {string} projectId - Project ID in planning-task-mcp
 * @param {number} issueNumber - GitHub issue number
 * @returns {Promise<boolean>}
 */
async function taskExistsForIssue(projectId, issueNumber) {
  const tasks = await getAll('tasks');
  return tasks.some(
    t => t.projectId === projectId && t.githubIssueNumber === issueNumber,
  );
}

/**
 * Syncs a single GitHub issue into the backlog as a task.
 *
 * @param {Object} issue - GitHub issue object from gh CLI
 * @param {string} repo - Repository in owner/repo format
 * @param {string} projectId - Project ID in planning-task-mcp
 * @param {string} label - The trigger label (to swap after processing)
 * @returns {Promise<{ created: boolean, taskId?: string, skipped?: string }>}
 */
export async function syncIssue(issue, repo, projectId, label) {
  const { number, title, body } = issue;

  // Skip if already synced
  if (await taskExistsForIssue(projectId, number)) {
    logger.info(`Issue #${number} already synced, skipping`, AGENT_TAG);
    return { created: false, skipped: 'already-synced' };
  }

  const userStory = extractUserStory(title, body);
  const acceptanceCriteria = extractAcceptanceCriteria(body);

  const taskData = {
    projectId,
    title: `[GH-${number}] ${title}`,
    userStory,
    acceptanceCriteria,
    bizPoints: 3,
    devPoints: 3,
    status: 'to-do',
    githubIssueNumber: number,
    githubIssueUrl: issue.url,
    source: 'github-issue-sync',
    tests: [{ description: 'Feature works as described in the issue', type: 'manual', status: 'pending' }],
    userId: config.defaultUserId,
    userName: config.defaultUserName || 'Komodo Issue Sync',
  };

  const taskId = await create('tasks', taskData);
  logger.success(`Issue #${number} → Task ${taskId} created`, AGENT_TAG);

  // Comment on issue confirming task creation
  const queuedLabel = label.includes(':') ? label.replace(/:[^:]+$/, ':queued') : `${label}:queued`;

  try {
    commentOnIssue(repo, number,
      `🤖 **Komodo**: Task created in backlog.\n\n` +
      `- **Task ID**: \`${taskId}\`\n` +
      `- **Title**: ${taskData.title}\n` +
      `- **Status**: to-do\n\n` +
      `This issue will be picked up automatically by Komodo.`,
    );
  } catch (err) {
    logger.warn(`Could not comment on issue #${number}: ${err.message}`, AGENT_TAG);
  }

  // Swap label to mark as queued
  try {
    swapLabel(repo, number, label, queuedLabel);
  } catch (err) {
    logger.warn(`Could not swap label on issue #${number}: ${err.message}`, AGENT_TAG);
  }

  return { created: true, taskId };
}

/**
 * Runs one polling cycle: fetches labeled issues and syncs them.
 *
 * @param {Object} options
 * @param {string} options.repo - Repository in owner/repo format
 * @param {string} options.projectId - Project ID in planning-task-mcp
 * @param {string} [options.label='komodo'] - Label to filter issues by
 * @returns {Promise<{ synced: number, skipped: number, errors: number }>}
 */
export async function pollOnce({ repo, projectId, label = 'komodo' }) {
  logger.info(`Polling issues with label "${label}" in ${repo}...`, AGENT_TAG);

  let issues;
  try {
    issues = fetchLabeledIssues(repo, label);
  } catch (err) {
    logger.error(`Failed to fetch issues: ${err.message}`, AGENT_TAG);
    return { synced: 0, skipped: 0, errors: 1 };
  }

  if (!Array.isArray(issues) || issues.length === 0) {
    logger.info('No new issues found', AGENT_TAG);
    return { synced: 0, skipped: 0, errors: 0 };
  }

  logger.info(`Found ${issues.length} issue(s) to process`, AGENT_TAG);

  let synced = 0;
  let skipped = 0;
  let errors = 0;

  for (const issue of issues) {
    try {
      const result = await syncIssue(issue, repo, projectId, label);
      if (result.created) synced++;
      else skipped++;
    } catch (err) {
      errors++;
      logger.error(`Error syncing issue #${issue.number}: ${err.message}`, AGENT_TAG);
    }
  }

  logger.info(`Poll complete: ${synced} synced, ${skipped} skipped, ${errors} errors`, AGENT_TAG);
  return { synced, skipped, errors };
}

/**
 * Starts the polling loop that periodically checks for new issues.
 *
 * @param {Object} options
 * @param {string} options.repo - Repository in owner/repo format
 * @param {string} options.projectId - Project ID in planning-task-mcp
 * @param {string} [options.label='komodo'] - Label to filter issues by
 * @param {number} [options.intervalMinutes] - Polling interval in minutes (from config)
 * @returns {{ stop: () => void }} Controller to stop the polling loop
 */
export function startPolling({ repo, projectId, label = 'komodo', intervalMinutes }) {
  const interval = (intervalMinutes || config.githubIssuePollMinutes) * 60 * 1000;

  logger.info(`Starting issue sync polling every ${intervalMinutes || config.githubIssuePollMinutes} min for ${repo}`, AGENT_TAG);

  // Run immediately on start
  pollOnce({ repo, projectId, label }).catch(err => {
    logger.error(`Poll error: ${err.message}`, AGENT_TAG);
  });

  const timer = setInterval(() => {
    pollOnce({ repo, projectId, label }).catch(err => {
      logger.error(`Poll error: ${err.message}`, AGENT_TAG);
    });
  }, interval);

  return {
    stop() {
      clearInterval(timer);
      logger.info('Issue sync polling stopped', AGENT_TAG);
    },
  };
}
