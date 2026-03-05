import { execFileSync } from 'child_process';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { getAll, create } from '../../skills/planning-task-mcp/src/firebase.js';

const AGENT_TAG = 'DEP-CHECK';

/**
 * Severity to bizPoints mapping for vulnerability tasks.
 * Critical audits map to higher business value since they pose greater risk.
 */
const SEVERITY_BIZ_POINTS = {
  critical: 13,
  high: 8,
  moderate: 5,
  low: 2,
};

/**
 * Severity to devPoints mapping for vulnerability tasks.
 */
const SEVERITY_DEV_POINTS = {
  critical: 5,
  high: 3,
  moderate: 2,
  low: 1,
};

/**
 * Runs `npm audit --json` and returns parsed vulnerability data.
 *
 * @param {string} cwd - Repository root
 * @returns {{ vulnerabilities: Array<{ name: string, severity: string, currentVersion: string, fixAvailable: string|boolean, via: string }> }}
 */
export function runNpmAudit(cwd) {
  const vulnerabilities = [];

  let output = '';
  try {
    output = execFileSync('npm', ['audit', '--json'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
  } catch (err) {
    // npm audit exits with non-zero when vulnerabilities are found
    if (err.stdout) {
      output = err.stdout;
    } else {
      logger.warn(`Could not run npm audit: ${err.message}`, AGENT_TAG);
      return { vulnerabilities };
    }
  }

  try {
    const audit = JSON.parse(output);
    const vulns = audit.vulnerabilities || {};

    for (const [pkg, info] of Object.entries(vulns)) {
      const via = Array.isArray(info.via)
        ? info.via
          .filter(v => typeof v === 'string' || v.title)
          .map(v => (typeof v === 'string' ? v : v.title))
          .join(', ')
        : '';

      vulnerabilities.push({
        name: pkg,
        severity: info.severity || 'low',
        currentVersion: info.range || 'unknown',
        fixAvailable: info.fixAvailable
          ? (typeof info.fixAvailable === 'object' ? info.fixAvailable.name + '@' + info.fixAvailable.version : 'yes')
          : 'no',
        via: via || 'direct',
      });
    }
  } catch {
    logger.warn('Could not parse npm audit output', AGENT_TAG);
  }

  return { vulnerabilities };
}

/**
 * Runs `npm outdated --json` and returns parsed update data.
 * Only returns major version updates (e.g., 2.x -> 3.x).
 *
 * @param {string} cwd - Repository root
 * @returns {{ outdated: Array<{ name: string, current: string, latest: string, type: string }> }}
 */
export function runNpmOutdated(cwd) {
  const outdated = [];

  let output = '';
  try {
    output = execFileSync('npm', ['outdated', '--json'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
  } catch (err) {
    // npm outdated exits with code 1 when outdated packages exist
    if (err.stdout) {
      output = err.stdout;
    } else {
      logger.warn(`Could not run npm outdated: ${err.message}`, AGENT_TAG);
      return { outdated };
    }
  }

  try {
    const data = JSON.parse(output || '{}');

    for (const [pkg, info] of Object.entries(data)) {
      const current = info.current || 'unknown';
      const latest = info.latest || 'unknown';

      // Only include major updates
      const currentMajor = parseInt(current.split('.')[0], 10);
      const latestMajor = parseInt(latest.split('.')[0], 10);

      if (!isNaN(currentMajor) && !isNaN(latestMajor) && latestMajor > currentMajor) {
        outdated.push({
          name: pkg,
          current,
          latest,
          type: info.type || 'dependencies',
        });
      }
    }
  } catch {
    logger.warn('Could not parse npm outdated output', AGENT_TAG);
  }

  return { outdated };
}

/**
 * Builds a deduplication key for a dependency task/proposal.
 *
 * @param {string} name - Package name
 * @param {'vulnerability'|'major-update'} type
 * @returns {string}
 */
export function deduplicationKey(name, type) {
  return `dep-check::${name.toLowerCase()}::${type}`;
}

/**
 * Creates tasks for vulnerable dependencies.
 * Deduplicates against existing tasks with source='dep-check'.
 *
 * @param {Array<{ name: string, severity: string, currentVersion: string, fixAvailable: string, via: string }>} vulnerabilities
 * @param {string} projectId
 * @param {Set<string>} existingKeys - Existing dedup keys
 * @returns {Promise<{ created: number, skipped: number, tasks: Array<{ taskId: string, title: string }> }>}
 */
async function createVulnerabilityTasks(vulnerabilities, projectId, existingKeys) {
  let created = 0;
  let skipped = 0;
  const tasks = [];

  for (const vuln of vulnerabilities) {
    const key = deduplicationKey(vuln.name, 'vulnerability');

    if (existingKeys.has(key)) {
      logger.info(`Skipping duplicate vulnerability task: ${vuln.name}`, AGENT_TAG);
      skipped++;
      continue;
    }

    const bizPoints = SEVERITY_BIZ_POINTS[vuln.severity] || 2;
    const devPoints = SEVERITY_DEV_POINTS[vuln.severity] || 1;

    const title = `[Dep Security] Fix ${vuln.severity} vulnerability in ${vuln.name}`;
    const taskData = {
      projectId,
      title,
      userStory: {
        who: 'the development team',
        what: `fix ${vuln.severity} vulnerability in dependency ${vuln.name}`,
        why: 'keep the project secure and free of known vulnerabilities',
      },
      acceptanceCriteria: [
        `Update or replace ${vuln.name} (current: ${vuln.currentVersion}) to fix the ${vuln.severity} vulnerability`,
        `Fix available: ${vuln.fixAvailable}`,
        `Vulnerability source: ${vuln.via}`,
        'Run npm audit to verify the vulnerability is resolved',
        'Ensure no regressions are introduced',
      ],
      bizPoints,
      devPoints,
      status: 'to-do',
      source: 'dep-check',
      depName: vuln.name,
      depCurrentVersion: vuln.currentVersion,
      depFixAvailable: vuln.fixAvailable,
      depSeverity: vuln.severity,
      depType: 'vulnerability',
      depVia: vuln.via,
      userId: config.defaultUserId,
      userName: config.defaultUserName || 'Komodo Dependency Checker',
    };

    try {
      const taskId = await create('tasks', taskData);
      tasks.push({ taskId, title });
      existingKeys.add(key);
      created++;
      logger.info(`Vulnerability task created: ${title} (${taskId})`, AGENT_TAG);
    } catch (err) {
      logger.error(`Failed to create vulnerability task for ${vuln.name}: ${err.message}`, AGENT_TAG);
    }
  }

  return { created, skipped, tasks };
}

/**
 * Creates proposals (not tasks) for major version updates.
 * These are informational — the owner decides whether to upgrade.
 *
 * @param {Array<{ name: string, current: string, latest: string, type: string }>} outdated
 * @param {string} projectId
 * @param {Set<string>} existingKeys - Existing dedup keys
 * @returns {Promise<{ created: number, skipped: number, proposals: Array<{ proposalId: string, name: string }> }>}
 */
async function createUpdateProposals(outdated, projectId, existingKeys) {
  let created = 0;
  let skipped = 0;
  const proposals = [];

  for (const pkg of outdated) {
    const key = deduplicationKey(pkg.name, 'major-update');

    if (existingKeys.has(key)) {
      logger.info(`Skipping duplicate update proposal: ${pkg.name}`, AGENT_TAG);
      skipped++;
      continue;
    }

    const proposalData = {
      projectId,
      category: 'major-update',
      file: 'package.json',
      reason: `Major update available: ${pkg.name} ${pkg.current} -> ${pkg.latest} (${pkg.type})`,
      status: 'pending',
      source: 'dep-check',
      depName: pkg.name,
      depCurrentVersion: pkg.current,
      depTargetVersion: pkg.latest,
      depType: 'major-update',
      createdAt: new Date().toISOString(),
    };

    try {
      const proposalId = await create('proposals', proposalData);
      proposals.push({ proposalId, name: pkg.name });
      existingKeys.add(key);
      created++;
      logger.info(`Update proposal created: ${pkg.name} ${pkg.current} -> ${pkg.latest}`, AGENT_TAG);
    } catch (err) {
      logger.error(`Failed to create update proposal for ${pkg.name}: ${err.message}`, AGENT_TAG);
    }
  }

  return { created, skipped, proposals };
}

/**
 * Loads existing dep-check dedup keys from tasks and proposals collections.
 *
 * @returns {Promise<Set<string>>}
 */
async function loadExistingKeys() {
  const keys = new Set();

  try {
    const tasks = await getAll('tasks');
    for (const t of tasks) {
      if (t.source === 'dep-check' && t.depName) {
        keys.add(deduplicationKey(t.depName, t.depType || 'vulnerability'));
      }
    }
  } catch (err) {
    logger.warn(`Could not load existing tasks for dedup: ${err.message}`, AGENT_TAG);
  }

  try {
    const proposals = await getAll('proposals');
    for (const p of proposals) {
      if (p.source === 'dep-check' && p.depName) {
        keys.add(deduplicationKey(p.depName, p.depType || 'major-update'));
      }
    }
  } catch (err) {
    logger.warn(`Could not load existing proposals for dedup: ${err.message}`, AGENT_TAG);
  }

  return keys;
}

/**
 * Main entry point: checks dependencies for vulnerabilities and major updates.
 *
 * - Vulnerabilities: creates tasks with severity-mapped bizPoints
 * - Major updates: creates proposals for the owner to decide
 *
 * @param {Object} options
 * @param {string} options.projectId - Project ID
 * @param {string} options.cwd - Repository root directory
 * @returns {Promise<{ vulnerabilities: number, tasksCreated: number, tasksSkipped: number, proposalsCreated: number, proposalsSkipped: number }>}
 */
export async function runDependencyCheck({ projectId, cwd }) {
  if (!config.depCheckEnabled) {
    logger.info('Dependency checker disabled (DEP_CHECK_ENABLED=false)', AGENT_TAG);
    return { vulnerabilities: 0, tasksCreated: 0, tasksSkipped: 0, proposalsCreated: 0, proposalsSkipped: 0 };
  }

  logger.info('Starting dependency check...', AGENT_TAG);

  // Load existing keys for deduplication
  const existingKeys = await loadExistingKeys();

  // Run npm audit
  const { vulnerabilities } = runNpmAudit(cwd);
  logger.info(`Found ${vulnerabilities.length} vulnerability(ies)`, AGENT_TAG);

  // Run npm outdated (major updates only)
  const { outdated } = runNpmOutdated(cwd);
  logger.info(`Found ${outdated.length} major update(s) available`, AGENT_TAG);

  // Create tasks for vulnerabilities
  const vulnResult = await createVulnerabilityTasks(vulnerabilities, projectId, existingKeys);

  // Create proposals for major updates
  const updateResult = await createUpdateProposals(outdated, projectId, existingKeys);

  // Emit event
  eventBus.emitEvent(EVENT_TYPES.DEP_CHECK_COMPLETED, {
    metadata: {
      vulnerabilities: vulnerabilities.length,
      tasksCreated: vulnResult.created,
      tasksSkipped: vulnResult.skipped,
      proposalsCreated: updateResult.created,
      proposalsSkipped: updateResult.skipped,
    },
  });

  const totalCreated = vulnResult.created + updateResult.created;
  if (totalCreated > 0) {
    logger.success(
      `Dependency check: ${vulnResult.created} task(s), ${updateResult.created} proposal(s) created`,
      AGENT_TAG,
    );
  } else {
    logger.info('Dependency check complete — no new items to create', AGENT_TAG);
  }

  return {
    vulnerabilities: vulnerabilities.length,
    tasksCreated: vulnResult.created,
    tasksSkipped: vulnResult.skipped,
    proposalsCreated: updateResult.created,
    proposalsSkipped: updateResult.skipped,
  };
}
