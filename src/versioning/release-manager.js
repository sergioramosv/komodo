import { execFileSync } from 'child_process';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { getAll } from '../../skills/planning-task-mcp/src/firebase.js';
import { classifyTask, formatTaskEntry } from './changelog-generator.js';
import { readVersion } from './version-bumper.js';

const AGENT = 'RELEASE';
const GH_TIMEOUT = 30_000;

/**
 * Checks whether all tasks in a sprint are done.
 *
 * @param {string} sprintId
 * @param {string} projectId
 * @returns {Promise<{ complete: boolean, tasks: object[], sprint: object|null }>}
 */
export async function isSprintComplete(sprintId, projectId) {
  const [allTasks, allSprints] = await Promise.all([
    getAll('tasks'),
    getAll('sprints'),
  ]);

  const sprint = allSprints.find(s => s.id === sprintId && s.projectId === projectId) || null;
  const sprintTasks = allTasks.filter(t => t.sprintId === sprintId && t.projectId === projectId);

  if (sprintTasks.length === 0) {
    return { complete: false, tasks: [], sprint };
  }

  const allDone = sprintTasks.every(t => t.status === 'done');
  return { complete: allDone, tasks: sprintTasks, sprint };
}

/**
 * Generates release notes from completed sprint tasks.
 *
 * @param {object} options
 * @param {object[]} options.tasks - Completed tasks
 * @param {object} options.sprint - Sprint object
 * @param {string} options.version - Version tag (e.g. "1.2.0")
 * @param {string} [options.dashboardUrl] - URL to sprint in dashboard
 * @returns {string} Markdown release notes
 */
export function generateReleaseNotes({ tasks, sprint, version, dashboardUrl }) {
  const categoryOrder = ['Breaking Changes', 'Features', 'Fixes', 'Other'];
  const grouped = {};

  for (const task of tasks) {
    const category = classifyTask(task);
    if (!grouped[category]) grouped[category] = [];
    grouped[category].push(formatTaskEntry(task));
  }

  const lines = [];

  // Executive summary
  const featureCount = (grouped['Features'] || []).length;
  const fixCount = (grouped['Fixes'] || []).length;
  const breakingCount = (grouped['Breaking Changes'] || []).length;
  const otherCount = (grouped['Other'] || []).length;
  const totalTasks = tasks.length;

  lines.push(`## Summary`);
  lines.push('');
  lines.push(`Release **v${version}** from sprint **${sprint.name || sprint.id}** with ${totalTasks} completed tasks.`);

  const parts = [];
  if (featureCount > 0) parts.push(`${featureCount} feature${featureCount > 1 ? 's' : ''}`);
  if (fixCount > 0) parts.push(`${fixCount} fix${fixCount > 1 ? 'es' : ''}`);
  if (breakingCount > 0) parts.push(`${breakingCount} breaking change${breakingCount > 1 ? 's' : ''}`);
  if (otherCount > 0) parts.push(`${otherCount} other`);
  if (parts.length > 0) {
    lines.push(`Includes: ${parts.join(', ')}.`);
  }
  lines.push('');

  // Categorized changes
  for (const category of categoryOrder) {
    if (grouped[category] && grouped[category].length > 0) {
      lines.push(`## ${category}`);
      lines.push('');
      lines.push(grouped[category].join('\n'));
      lines.push('');
    }
  }

  // Sprint link
  if (dashboardUrl) {
    lines.push(`## Sprint`);
    lines.push('');
    lines.push(`[View sprint in dashboard](${dashboardUrl})`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Creates a GitHub Release using `gh release create`.
 *
 * @param {object} options
 * @param {string} options.repo - owner/repo
 * @param {string} options.tag - Tag name (e.g. "v1.2.0")
 * @param {string} options.title - Release title
 * @param {string} options.notes - Release notes (markdown)
 * @param {string} [options.cwd] - Working directory
 * @returns {{ tag: string, url: string }}
 */
export function createGitHubRelease({ repo, tag, title, notes, cwd }) {
  const workDir = cwd || config.rootDir;

  const args = [
    'release', 'create', tag,
    '--repo', repo,
    '--title', title,
    '--notes', notes,
  ];

  const output = execFileSync('gh', args, {
    cwd: workDir,
    encoding: 'utf-8',
    timeout: GH_TIMEOUT,
  }).trim();

  logger.success(`GitHub Release created: ${tag}`, AGENT);

  return { tag, url: output || `https://github.com/${repo}/releases/tag/${tag}` };
}

/**
 * Full auto-release flow when a sprint completes.
 *
 * Checks if all sprint tasks are done, generates release notes,
 * creates a GitHub Release, and emits events + notifications.
 *
 * Skipped when AUTO_RELEASE=false (default) or RELEASE_ON_SPRINT_COMPLETE=false.
 *
 * @param {object} options
 * @param {string} options.sprintId - Sprint that may have just completed
 * @param {string} options.projectId
 * @param {string} options.repo - owner/repo
 * @param {string} [options.cwd] - Working directory
 * @param {string} [options.dashboardUrl] - URL to sprint in dashboard
 * @returns {Promise<{ skipped: boolean, reason?: string, tag?: string, releaseUrl?: string }>}
 */
export async function autoRelease({ sprintId, projectId, repo, cwd, dashboardUrl }) {
  if (!config.autoRelease) {
    logger.info('AUTO_RELEASE disabled, skipping release', AGENT);
    return { skipped: true, reason: 'AUTO_RELEASE=false' };
  }

  if (!config.releaseOnSprintComplete) {
    logger.info('RELEASE_ON_SPRINT_COMPLETE disabled, skipping release', AGENT);
    return { skipped: true, reason: 'RELEASE_ON_SPRINT_COMPLETE=false' };
  }

  if (!sprintId) {
    logger.info('No sprintId provided, skipping release check', AGENT);
    return { skipped: true, reason: 'no sprintId' };
  }

  const { complete, tasks, sprint } = await isSprintComplete(sprintId, projectId);

  if (!complete) {
    logger.info(`Sprint ${sprintId} not yet complete, skipping release`, AGENT);
    return { skipped: true, reason: 'sprint not complete' };
  }

  logger.info(`Sprint "${sprint?.name || sprintId}" complete! Creating release...`, AGENT);

  // Read current version for the tag
  let version;
  try {
    version = readVersion(cwd, config.versionFile);
  } catch {
    version = '0.0.0';
    logger.warn('Could not read version, using 0.0.0', AGENT);
  }

  const tag = `v${version}`;
  const title = `v${version} — ${sprint?.name || sprintId}`;

  const notes = generateReleaseNotes({
    tasks,
    sprint: sprint || { id: sprintId, name: sprintId },
    version,
    dashboardUrl,
  });

  const release = createGitHubRelease({
    repo,
    tag,
    title,
    notes,
    cwd,
  });

  eventBus.emitEvent(EVENT_TYPES.RELEASE_CREATED, {
    metadata: {
      tag,
      version,
      releaseUrl: release.url,
      sprintId,
      sprintName: sprint?.name || sprintId,
      taskCount: tasks.length,
      repo,
    },
  });

  logger.success(`Release ${tag} created for sprint "${sprint?.name || sprintId}"`, AGENT);

  return { skipped: false, tag, releaseUrl: release.url, version, sprintName: sprint?.name };
}
