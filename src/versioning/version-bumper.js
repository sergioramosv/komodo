import { readFileSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { resolve } from 'path';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { autoChangelog } from './changelog-generator.js';

const AGENT = 'VERSIONING';
const GIT_TIMEOUT = 15_000;

/**
 * Determines the bump type from a task's title and optional versionBump override.
 *
 * Priority:
 * 1. task.versionBump (manual override: 'major' | 'minor' | 'patch')
 * 2. Title-based heuristic using conventional prefixes
 *
 * @param {object} task
 * @param {string} task.title
 * @param {string} [task.versionBump]
 * @returns {'major' | 'minor' | 'patch'}
 */
export function determineBumpType(task) {
  if (task.versionBump && ['major', 'minor', 'patch'].includes(task.versionBump)) {
    return task.versionBump;
  }

  const title = (task.title || '').toLowerCase();

  // Major: breaking changes
  if (/\bbreaking\b/.test(title) || /\bmajor\b/.test(title)) {
    return 'major';
  }

  // Patch: fixes, bugs, hotfixes
  if (/\bfix\b/.test(title) || /\bbug\b/.test(title) || /\bhotfix\b/.test(title) || /\bpatch\b/.test(title)) {
    return 'patch';
  }

  // Minor: features, additions, enhancements (default)
  return 'minor';
}

/**
 * Increments a semver string by the given bump type.
 *
 * @param {string} currentVersion - e.g. "1.2.3"
 * @param {'major' | 'minor' | 'patch'} bumpType
 * @returns {string} New version string
 */
export function bumpVersion(currentVersion, bumpType) {
  const parts = currentVersion.split('.').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`Invalid semver version: "${currentVersion}"`);
  }

  const [major, minor, patch] = parts;

  switch (bumpType) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`Unknown bump type: "${bumpType}"`);
  }
}

/**
 * Reads the current version from a JSON file (default: package.json).
 *
 * @param {string} [cwd] - Working directory
 * @param {string} [versionFile] - Relative path to the version file
 * @returns {string} Current version
 */
export function readVersion(cwd, versionFile = 'package.json') {
  const filePath = resolve(cwd || config.rootDir, versionFile);
  const content = JSON.parse(readFileSync(filePath, 'utf-8'));

  if (!content.version) {
    throw new Error(`No "version" field found in ${versionFile}`);
  }

  return content.version;
}

/**
 * Writes a new version to a JSON file (default: package.json).
 *
 * @param {string} newVersion
 * @param {string} [cwd] - Working directory
 * @param {string} [versionFile] - Relative path to the version file
 */
export function writeVersion(newVersion, cwd, versionFile = 'package.json') {
  const filePath = resolve(cwd || config.rootDir, versionFile);
  const content = JSON.parse(readFileSync(filePath, 'utf-8'));
  content.version = newVersion;
  writeFileSync(filePath, JSON.stringify(content, null, 2) + '\n', 'utf-8');
}

/**
 * Creates a version bump commit and pushes to main.
 *
 * @param {string} newVersion
 * @param {string} [cwd] - Working directory
 * @param {string} [versionFile] - File that was updated
 * @param {string[]} [extraFiles] - Additional files to stage (e.g. CHANGELOG.md)
 */
export function commitAndPushVersion(newVersion, cwd, versionFile = 'package.json', extraFiles = []) {
  const workDir = cwd || config.rootDir;

  const filesToStage = [versionFile, ...extraFiles];
  execFileSync('git', ['add', ...filesToStage], {
    cwd: workDir,
    encoding: 'utf-8',
    timeout: GIT_TIMEOUT,
  });

  execFileSync('git', ['commit', '-m', `chore: bump version to ${newVersion}`], {
    cwd: workDir,
    encoding: 'utf-8',
    timeout: GIT_TIMEOUT,
  });

  execFileSync('git', ['push', 'origin', 'main'], {
    cwd: workDir,
    encoding: 'utf-8',
    timeout: GIT_TIMEOUT,
  });

  logger.info(`Version bump committed and pushed: ${newVersion}`, AGENT);
}

/**
 * Full auto-version flow: determine bump → read current → bump → write → commit → push.
 *
 * Skipped when AUTO_VERSION=false (default) or config.autoVersion is falsy.
 *
 * @param {object} options
 * @param {object} options.task - The completed task (needs title, optional versionBump)
 * @param {string} [options.cwd] - Working directory
 * @param {string} [options.versionFile] - Version file path (default: package.json)
 * @returns {{ skipped: boolean, oldVersion?: string, newVersion?: string, bumpType?: string }}
 */
export function autoVersionBump({ task, cwd, versionFile = 'package.json' }) {
  if (!config.autoVersion) {
    logger.info('AUTO_VERSION disabled, skipping version bump', AGENT);
    return { skipped: true };
  }

  const bumpType = determineBumpType(task);
  const oldVersion = readVersion(cwd, versionFile);
  const newVersion = bumpVersion(oldVersion, bumpType);

  logger.info(`Bumping version: ${oldVersion} → ${newVersion} (${bumpType})`, AGENT);

  writeVersion(newVersion, cwd, versionFile);

  // Generate changelog entry (committed together with version bump)
  const extraFiles = [];
  const changelogResult = autoChangelog({ newVersion, task, cwd });
  if (!changelogResult.skipped && changelogResult.changelogPath) {
    extraFiles.push('CHANGELOG.md');
  }

  commitAndPushVersion(newVersion, cwd, versionFile, extraFiles);

  logger.success(`Version bumped to ${newVersion}`, AGENT);

  return { skipped: false, oldVersion, newVersion, bumpType, changelog: changelogResult };
}
