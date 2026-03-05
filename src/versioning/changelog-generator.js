import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const AGENT = 'CHANGELOG';

const CHANGELOG_HEADER = `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

`;

/**
 * Classifies a task into a changelog category based on its title.
 *
 * @param {object} task
 * @param {string} task.title
 * @returns {'Features' | 'Fixes' | 'Breaking Changes' | 'Other'}
 */
export function classifyTask(task) {
  const title = (task.title || '').toLowerCase();

  if (/\bbreaking\b/.test(title)) {
    return 'Breaking Changes';
  }
  if (/\bfix\b/.test(title) || /\bbug\b/.test(title) || /\bhotfix\b/.test(title)) {
    return 'Fixes';
  }
  if (/\bfeat\b/.test(title) || /\badd\b/.test(title) || /\bnew\b/.test(title)) {
    return 'Features';
  }
  return 'Other';
}

/**
 * Formats a single task entry for the changelog.
 *
 * @param {object} task
 * @param {string} task.title
 * @param {number} [task.prNumber]
 * @param {string} [task.repoUrl]
 * @param {number} [task.devPoints]
 * @returns {string}
 */
export function formatTaskEntry(task) {
  let entry = `- ${task.title}`;

  if (task.prNumber && task.repoUrl) {
    const repoUrl = task.repoUrl.replace(/\.git$/, '');
    entry += ` ([#${task.prNumber}](${repoUrl}/pull/${task.prNumber}))`;
  } else if (task.prNumber) {
    entry += ` (#${task.prNumber})`;
  }

  if (task.devPoints != null) {
    entry += ` — ${task.devPoints} devPoints`;
  }

  return entry;
}

/**
 * Generates a changelog entry block for a version.
 *
 * @param {object} options
 * @param {string} options.version - e.g. "1.2.0"
 * @param {string} options.date - e.g. "2026-03-05"
 * @param {object[]} options.tasks - Array of completed tasks
 * @returns {string}
 */
export function generateChangelogEntry({ version, date, tasks }) {
  const grouped = {};
  const categoryOrder = ['Breaking Changes', 'Features', 'Fixes', 'Other'];

  for (const task of tasks) {
    const category = classifyTask(task);
    if (!grouped[category]) {
      grouped[category] = [];
    }
    grouped[category].push(formatTaskEntry(task));
  }

  let entry = `## [${version}] - ${date}\n\n`;

  for (const category of categoryOrder) {
    if (grouped[category] && grouped[category].length > 0) {
      entry += `### ${category}\n\n`;
      entry += grouped[category].join('\n') + '\n\n';
    }
  }

  return entry;
}

/**
 * Updates (or creates) CHANGELOG.md with a new version entry.
 * Inserts the entry right after the header.
 *
 * @param {object} options
 * @param {string} options.version
 * @param {string} options.date
 * @param {object[]} options.tasks
 * @param {string} [options.cwd]
 * @returns {string} Path to the updated changelog
 */
export function updateChangelog({ version, date, tasks, cwd }) {
  const changelogPath = resolve(cwd || config.rootDir, 'CHANGELOG.md');

  let content;
  if (existsSync(changelogPath)) {
    content = readFileSync(changelogPath, 'utf-8');
  } else {
    content = CHANGELOG_HEADER;
  }

  const entry = generateChangelogEntry({ version, date, tasks });

  // Find insertion point: after the header (first blank line after initial comments/header)
  const headerEndIndex = content.indexOf('\n## ');
  if (headerEndIndex !== -1) {
    // Insert before the first version section
    content = content.slice(0, headerEndIndex) + '\n' + entry + content.slice(headerEndIndex + 1);
  } else {
    // No existing versions — append after header
    content = content + entry;
  }

  writeFileSync(changelogPath, content, 'utf-8');
  logger.info(`CHANGELOG.md updated with version ${version}`, AGENT);

  return changelogPath;
}

/**
 * Auto-generates a changelog entry after a version bump.
 * Called from autoVersionBump or directly after merge.
 *
 * @param {object} options
 * @param {string} options.newVersion
 * @param {object} options.task - The completed task
 * @param {string} [options.cwd]
 * @returns {{ skipped: boolean, changelogPath?: string }}
 */
export function autoChangelog({ newVersion, task, cwd }) {
  if (!config.autoChangelog) {
    logger.info('AUTO_CHANGELOG disabled, skipping changelog generation', AGENT);
    return { skipped: true };
  }

  const date = new Date().toISOString().split('T')[0];
  const tasks = [task];

  const changelogPath = updateChangelog({ version: newVersion, date, tasks, cwd });
  logger.success(`Changelog entry generated for v${newVersion}`, AGENT);

  return { skipped: false, changelogPath };
}
