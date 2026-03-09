import { getAll, getById } from '../../skills/planning-task-mcp/src/firebase.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const AGENT = 'PROJECT-LOADER';

/**
 * A loaded and validated project configuration.
 *
 * @typedef {Object} ProjectConfig
 * @property {string} projectId
 * @property {string} name
 * @property {string} repoUrl - Default repository URL (isDefault=true), or first repo
 * @property {string} codingGuidelines
 * @property {Object[]} repositories - All repositories of the project
 */

/**
 * Parses the PROJECTS environment variable.
 *
 * @returns {{ wildcard: boolean, projectIds: string[] }}
 */
export function parseProjectsEnv() {
  const raw = config.projects.trim();

  if (!raw) return { wildcard: false, projectIds: [] };

  if (raw === '*') return { wildcard: true, projectIds: [] };

  const projectIds = raw
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

  return { wildcard: false, projectIds };
}

/**
 * Returns true if the given user is a member of the project.
 *
 * @param {Object} project - Project data from Firebase
 * @param {string} userId
 * @returns {boolean}
 */
function isMember(project, userId) {
  if (!project.members) return false;
  const membership = project.members[userId];
  return membership === true || typeof membership === 'object';
}

/**
 * Extracts the default repository URL from a project.
 * Returns the URL of the repo marked as isDefault, or the first repo if none is marked.
 *
 * @param {Object[]} repositories
 * @returns {string}
 */
function extractDefaultRepoUrl(repositories) {
  if (!repositories || repositories.length === 0) return '';
  const defaultRepo = repositories.find(r => r.isDefault) || repositories[0];
  return defaultRepo.url || '';
}

/**
 * Loads and validates a single project config.
 * Throws if the project doesn't exist or the user has no access.
 *
 * @param {string} projectId
 * @param {string} userId
 * @returns {Promise<ProjectConfig>}
 */
export async function loadProjectConfig(projectId, userId) {
  const project = await getById('projects', projectId);

  if (!project) {
    throw new Error(`Project "${projectId}" not found`);
  }

  if (userId && !isMember(project, userId)) {
    throw new Error(`User "${userId}" has no access to project "${projectId}"`);
  }

  return {
    projectId: project.id,
    name: project.name || projectId,
    repoUrl: extractDefaultRepoUrl(project.repositories || []),
    codingGuidelines: project.codingGuidelines || '',
    repositories: project.repositories || [],
  };
}

/**
 * Loads all projects where the user is a member.
 *
 * @param {string} userId
 * @returns {Promise<ProjectConfig[]>}
 */
async function loadAllUserProjects(userId) {
  const allProjects = await getAll('projects');
  const userProjects = userId
    ? allProjects.filter(p => isMember(p, userId))
    : allProjects;

  return userProjects.map(p => ({
    projectId: p.id,
    name: p.name || p.id,
    repoUrl: extractDefaultRepoUrl(p.repositories || []),
    codingGuidelines: p.codingGuidelines || '',
    repositories: p.repositories || [],
  }));
}

/**
 * Resolves project configurations based on the PROJECTS env var.
 *
 * - If PROJECTS=*: loads all projects where the user is a member
 * - If PROJECTS=id1,id2,...: validates and loads each specific project
 * - If PROJECTS is empty: returns null (no multi-project mode)
 *
 * @param {string} [userId] - User ID for access validation. Defaults to config.defaultUserId.
 * @returns {Promise<ProjectConfig[] | null>} Array of project configs, or null if PROJECTS not set.
 */
export async function loadProjects(userId) {
  const uid = userId || config.defaultUserId;
  const { wildcard, projectIds } = parseProjectsEnv();

  if (!wildcard && projectIds.length === 0) return null;

  logger.info('Loading multi-project configuration...', AGENT);

  if (wildcard) {
    logger.info(`PROJECTS=* — loading all projects for user "${uid}"`, AGENT);
    const projects = await loadAllUserProjects(uid);

    if (projects.length === 0) {
      logger.warn('No projects found for this user', AGENT);
    } else {
      logger.info(`Loaded ${projects.length} project(s): ${projects.map(p => p.name).join(', ')}`, AGENT);
    }

    return projects;
  }

  // Specific project IDs — validate each one
  logger.info(`PROJECTS=${projectIds.join(',')} — validating ${projectIds.length} project(s)`, AGENT);

  const errors = [];
  const projects = [];

  for (const projectId of projectIds) {
    try {
      const projectConfig = await loadProjectConfig(projectId, uid);
      projects.push(projectConfig);
      logger.info(`  ✓ ${projectConfig.name} (${projectId})`, AGENT);
    } catch (err) {
      errors.push(`  ✗ ${projectId}: ${err.message}`);
      logger.error(`  ✗ ${projectId}: ${err.message}`, AGENT);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid projects:\n${errors.join('\n')}`);
  }

  return projects;
}
