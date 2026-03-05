import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { create } from '../../skills/planning-task-mcp/src/firebase.js';
import { runGh, runGhApi } from '../../skills/github-mcp/src/gh-cli.js';

const AGENT_TAG = 'PR-BUGS';

// Track processed comment IDs to avoid duplicates across polls
const processedComments = new Set();

// Pattern: @komodo bug: <description>
const BUG_TRIGGER = /@komodo\s+bug:\s*(.+)/is;

// Severity keywords (checked against the description, case-insensitive)
const SEVERITY_KEYWORDS = {
  critical: ['crash', 'data loss', 'security', 'vulnerability', 'broken', 'down', 'outage'],
  high: ['error', 'fail', 'wrong', 'incorrect', 'blocker', 'cannot', 'unable'],
  medium: ['bug', 'issue', 'unexpected', 'glitch', 'missing', 'slow'],
  low: ['typo', 'cosmetic', 'minor', 'style', 'formatting', 'label', 'text'],
};

/**
 * Auto-detects bug severity based on keywords in the description.
 *
 * @param {string} description - Bug description text
 * @returns {'critical' | 'high' | 'medium' | 'low'}
 */
export function detectSeverity(description) {
  const lower = description.toLowerCase();

  for (const [severity, keywords] of Object.entries(SEVERITY_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      return severity;
    }
  }

  return 'medium';
}

/**
 * Fetches open PRs for a repository.
 *
 * @param {string} repo - Repository in owner/repo format
 * @returns {Array<{ number: number, title: string, url: string }>}
 */
export function fetchOpenPRs(repo) {
  return runGh(
    ['pr', 'list', '--repo', repo, '--state', 'open', '--json', 'number,title,url'],
    { json: true },
  ) || [];
}

/**
 * Fetches comments for a specific PR (via the issues API which includes PR comments).
 *
 * @param {string} repo - Repository in owner/repo format
 * @param {number} prNumber - PR number
 * @returns {Array<{ id: number, body: string, user: { login: string }, html_url: string }>}
 */
export function fetchPRComments(repo, prNumber) {
  return runGhApi(`/repos/${repo}/issues/${prNumber}/comments`, { method: 'GET' }) || [];
}

/**
 * Also fetch review comments (inline code comments on diffs).
 *
 * @param {string} repo - Repository in owner/repo format
 * @param {number} prNumber - PR number
 * @returns {Array<{ id: number, body: string, user: { login: string }, html_url: string, path: string, line: number }>}
 */
export function fetchPRReviewComments(repo, prNumber) {
  return runGhApi(`/repos/${repo}/pulls/${prNumber}/comments`, { method: 'GET' }) || [];
}

/**
 * Replies to a PR comment confirming bug creation.
 *
 * @param {string} repo - Repository in owner/repo format
 * @param {number} prNumber - PR number
 * @param {string} body - Reply body
 */
export function replyToComment(repo, prNumber, body) {
  runGhApi(`/repos/${repo}/issues/${prNumber}/comments`, {
    method: 'POST',
    body: { body },
  });
}

/**
 * Processes a single comment that matches the @komodo bug trigger.
 *
 * @param {Object} comment - GitHub comment object
 * @param {number} prNumber - PR number where the comment was found
 * @param {string} prTitle - PR title for context
 * @param {string} repo - Repository in owner/repo format
 * @param {string} projectId - Project ID in planning-task-mcp
 * @returns {Promise<{ created: boolean, bugId?: string, skipped?: string }>}
 */
export async function processComment(comment, prNumber, prTitle, repo, projectId) {
  const { id, body, user } = comment;

  // Skip already-processed comments
  if (processedComments.has(id)) {
    return { created: false, skipped: 'already-processed' };
  }

  const match = body.match(BUG_TRIGGER);
  if (!match) {
    return { created: false, skipped: 'no-trigger' };
  }

  const description = match[1].trim();
  const severity = detectSeverity(description);
  const author = user?.login || 'unknown';

  const bugData = {
    projectId,
    title: `[PR-${prNumber}] ${description.substring(0, 100)}`,
    description: `**Reported by:** @${author}\n` +
      `**PR:** #${prNumber} - ${prTitle}\n` +
      `**Comment:** ${comment.html_url || ''}\n\n` +
      `${description}`,
    severity,
    status: 'open',
    source: 'pr-comment',
    prNumber,
    prCommentId: id,
    createdBy: config.defaultUserId || '',
    createdByName: config.defaultUserName || 'Komodo PR Bugs',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const bugId = await create('bugs', bugData);
  logger.success(`PR #${prNumber} comment → Bug ${bugId} (${severity})`, AGENT_TAG);

  // Mark as processed
  processedComments.add(id);

  // Reply to confirm
  try {
    replyToComment(repo, prNumber,
      `**Komodo Bug Report Created**\n\n` +
      `- **Bug ID**: \`${bugId}\`\n` +
      `- **Severity**: ${severity}\n` +
      `- **Title**: ${bugData.title}\n\n` +
      `The bug has been added to the project backlog.`,
    );
  } catch (err) {
    logger.warn(`Could not reply to comment on PR #${prNumber}: ${err.message}`, AGENT_TAG);
  }

  return { created: true, bugId };
}

/**
 * Runs one polling cycle: fetches open PRs, checks comments for @komodo bug triggers.
 *
 * @param {Object} options
 * @param {string} options.repo - Repository in owner/repo format
 * @param {string} options.projectId - Project ID in planning-task-mcp
 * @returns {Promise<{ bugsCreated: number, commentsScanned: number, errors: number }>}
 */
export async function pollOnce({ repo, projectId }) {
  logger.info(`Polling PR comments for bug reports in ${repo}...`, AGENT_TAG);

  let prs;
  try {
    prs = fetchOpenPRs(repo);
  } catch (err) {
    logger.error(`Failed to fetch PRs: ${err.message}`, AGENT_TAG);
    return { bugsCreated: 0, commentsScanned: 0, errors: 1 };
  }

  if (!Array.isArray(prs) || prs.length === 0) {
    logger.info('No open PRs found', AGENT_TAG);
    return { bugsCreated: 0, commentsScanned: 0, errors: 0 };
  }

  let bugsCreated = 0;
  let commentsScanned = 0;
  let errors = 0;

  for (const pr of prs) {
    try {
      // Fetch both issue comments and review comments
      let comments = [];
      try {
        const issueComments = fetchPRComments(repo, pr.number);
        if (Array.isArray(issueComments)) comments = comments.concat(issueComments);
      } catch (err) {
        logger.warn(`Failed to fetch comments for PR #${pr.number}: ${err.message}`, AGENT_TAG);
      }

      try {
        const reviewComments = fetchPRReviewComments(repo, pr.number);
        if (Array.isArray(reviewComments)) comments = comments.concat(reviewComments);
      } catch (err) {
        logger.warn(`Failed to fetch review comments for PR #${pr.number}: ${err.message}`, AGENT_TAG);
      }

      for (const comment of comments) {
        commentsScanned++;
        if (!BUG_TRIGGER.test(comment.body)) continue;

        try {
          const result = await processComment(comment, pr.number, pr.title, repo, projectId);
          if (result.created) bugsCreated++;
        } catch (err) {
          errors++;
          logger.error(`Error processing comment ${comment.id} on PR #${pr.number}: ${err.message}`, AGENT_TAG);
        }
      }
    } catch (err) {
      errors++;
      logger.error(`Error processing PR #${pr.number}: ${err.message}`, AGENT_TAG);
    }
  }

  logger.info(`Poll complete: ${bugsCreated} bugs created, ${commentsScanned} comments scanned, ${errors} errors`, AGENT_TAG);
  return { bugsCreated, commentsScanned, errors };
}

/**
 * Starts the polling loop that periodically checks PR comments for bug reports.
 *
 * @param {Object} options
 * @param {string} options.repo - Repository in owner/repo format
 * @param {string} options.projectId - Project ID in planning-task-mcp
 * @param {number} [options.intervalMinutes] - Polling interval in minutes
 * @returns {{ stop: () => void }}
 */
export function startPolling({ repo, projectId, intervalMinutes }) {
  const interval = (intervalMinutes || config.prCommentBugsPollMinutes) * 60 * 1000;

  logger.info(`Starting PR comment bug polling every ${intervalMinutes || config.prCommentBugsPollMinutes} min for ${repo}`, AGENT_TAG);

  // Run immediately
  pollOnce({ repo, projectId }).catch(err => {
    logger.error(`Poll error: ${err.message}`, AGENT_TAG);
  });

  const timer = setInterval(() => {
    pollOnce({ repo, projectId }).catch(err => {
      logger.error(`Poll error: ${err.message}`, AGENT_TAG);
    });
  }, interval);

  return {
    stop() {
      clearInterval(timer);
      logger.info('PR comment bug polling stopped', AGENT_TAG);
    },
  };
}

/**
 * Returns the current set of processed comment IDs (for testing).
 * @returns {Set<number>}
 */
export function getProcessedComments() {
  return processedComments;
}

/**
 * Clears the processed comments set (for testing).
 */
export function clearProcessedComments() {
  processedComments.clear();
}
