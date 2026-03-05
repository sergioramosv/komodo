import { execFileSync } from 'child_process';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { getAll, create } from '../../skills/planning-task-mcp/src/firebase.js';

const AGENT_TAG = 'AUTO-IMPROVE';

/**
 * Analysis categories supported by the codebase analyzer.
 */
export const CATEGORIES = {
  DUPLICATE: 'duplicate',
  LONG_FUNCTIONS: 'long-functions',
  MISSING_TESTS: 'missing-tests',
  TODO_FIXME: 'todo-fixme',
  VULNERABLE_DEPS: 'vulnerable-deps',
};

const ALL_CATEGORIES = Object.values(CATEGORIES);

/**
 * Default thresholds for analysis heuristics.
 */
const THRESHOLDS = {
  longFunctionLines: 50,
};

/**
 * Parses the AUTO_IMPROVE_CATEGORIES env var into a list of enabled categories.
 * Falls back to all categories if not set.
 *
 * @returns {string[]}
 */
export function getEnabledCategories() {
  const raw = config.autoImproveCategories;
  if (!raw) return ALL_CATEGORIES;

  return raw
    .split(',')
    .map(s => s.trim())
    .filter(c => ALL_CATEGORIES.includes(c));
}

/**
 * Runs `git diff --stat` between two refs to detect duplicate/similar files.
 * This is a lightweight heuristic: it looks for source files with very similar
 * names in different directories, suggesting potential code duplication.
 *
 * @param {string} cwd - Repository root
 * @returns {Array<{ file: string, reason: string }>}
 */
export function findDuplicateCandidates(cwd) {
  const results = [];

  try {
    const output = execFileSync('git', ['ls-files', '--', '*.js', '*.ts', '*.jsx', '*.tsx'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const files = output.trim().split('\n').filter(Boolean);
    const baseNameMap = new Map();

    for (const file of files) {
      if (file.includes('node_modules') || file.endsWith('.test.js') || file.endsWith('.test.ts')) continue;
      const base = file.split('/').pop();
      if (!baseNameMap.has(base)) baseNameMap.set(base, []);
      baseNameMap.get(base).push(file);
    }

    for (const [base, paths] of baseNameMap) {
      if (paths.length > 1) {
        results.push({
          file: paths.join(', '),
          reason: `Multiple files named "${base}" found in different directories — possible duplication`,
        });
      }
    }
  } catch (err) {
    logger.warn(`Could not scan for duplicates: ${err.message}`, AGENT_TAG);
  }

  return results;
}

/**
 * Finds functions/methods that exceed the line threshold.
 * Uses a simple regex-based heuristic to detect function boundaries.
 *
 * @param {string} cwd - Repository root
 * @returns {Array<{ file: string, reason: string }>}
 */
export function findLongFunctions(cwd) {
  const results = [];

  try {
    const output = execFileSync('git', ['ls-files', '--', '*.js', '*.ts'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const files = output.trim().split('\n').filter(Boolean);
    const funcPattern = /(?:export\s+)?(?:async\s+)?function\s+(\w+)/;

    for (const file of files) {
      if (file.includes('node_modules') || file.endsWith('.test.js') || file.endsWith('.test.ts')) continue;

      let content;
      try {
        content = execFileSync('git', ['show', `HEAD:${file}`], {
          cwd,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch {
        continue;
      }

      const lines = content.split('\n');
      let inFunction = false;
      let funcName = '';
      let funcStart = 0;
      let braceDepth = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (!inFunction) {
          const match = line.match(funcPattern);
          if (match) {
            inFunction = true;
            funcName = match[1];
            funcStart = i + 1;
            braceDepth = 0;
          }
        }

        if (inFunction) {
          for (const ch of line) {
            if (ch === '{') braceDepth++;
            if (ch === '}') braceDepth--;
          }

          if (braceDepth <= 0 && i > funcStart) {
            const length = i - funcStart + 1;
            if (length > THRESHOLDS.longFunctionLines) {
              results.push({
                file,
                reason: `Function "${funcName}" is ${length} lines long (threshold: ${THRESHOLDS.longFunctionLines})`,
              });
            }
            inFunction = false;
          }
        }
      }
    }
  } catch (err) {
    logger.warn(`Could not scan for long functions: ${err.message}`, AGENT_TAG);
  }

  return results;
}

/**
 * Finds source files that don't have a corresponding test file.
 *
 * @param {string} cwd - Repository root
 * @returns {Array<{ file: string, reason: string }>}
 */
export function findMissingTests(cwd) {
  const results = [];

  try {
    const output = execFileSync('git', ['ls-files', '--', '*.js', '*.ts'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const files = output.trim().split('\n').filter(Boolean);
    const sourceFiles = files.filter(f =>
      !f.includes('node_modules') &&
      !f.endsWith('.test.js') &&
      !f.endsWith('.test.ts') &&
      !f.endsWith('.config.js') &&
      !f.includes('/test/') &&
      !f.includes('/tests/'),
    );

    const testFiles = new Set(files.filter(f => f.endsWith('.test.js') || f.endsWith('.test.ts')));

    for (const src of sourceFiles) {
      const testVariant = src.replace(/\.(js|ts)$/, '.test.$1');
      if (!testFiles.has(testVariant)) {
        results.push({
          file: src,
          reason: `No test file found (expected: ${testVariant})`,
        });
      }
    }
  } catch (err) {
    logger.warn(`Could not scan for missing tests: ${err.message}`, AGENT_TAG);
  }

  return results;
}

/**
 * Finds TODO and FIXME comments in the codebase.
 *
 * @param {string} cwd - Repository root
 * @returns {Array<{ file: string, reason: string }>}
 */
export function findTodoFixme(cwd) {
  const results = [];

  try {
    const output = execFileSync('git', ['grep', '-n', '-E', '(TODO|FIXME)', '--', '*.js', '*.ts'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const lines = output.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      const [fileAndLine, ...rest] = line.split(':');
      const parts = fileAndLine.split(':');
      // git grep output: file:linenum:content
      // but split on first two colons
      const match = line.match(/^(.+?):(\d+):(.+)$/);
      if (match) {
        results.push({
          file: `${match[1]}:${match[2]}`,
          reason: `TODO/FIXME: ${match[3].trim()}`,
        });
      }
    }
  } catch (err) {
    // git grep exits with code 1 when no matches — not an error
    if (err.status !== 1) {
      logger.warn(`Could not scan for TODO/FIXME: ${err.message}`, AGENT_TAG);
    }
  }

  return results;
}

/**
 * Checks for known vulnerabilities in npm dependencies.
 *
 * @param {string} cwd - Repository root
 * @returns {Array<{ file: string, reason: string }>}
 */
export function findVulnerableDeps(cwd) {
  const results = [];

  try {
    const output = execFileSync('npm', ['audit', '--json'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });

    const audit = JSON.parse(output);
    const vulns = audit.vulnerabilities || {};

    for (const [pkg, info] of Object.entries(vulns)) {
      results.push({
        file: 'package.json',
        reason: `Vulnerable dependency: ${pkg} (${info.severity})`,
      });
    }
  } catch (err) {
    // npm audit exits with non-zero when vulnerabilities are found
    if (err.stdout) {
      try {
        const audit = JSON.parse(err.stdout);
        const vulns = audit.vulnerabilities || {};
        for (const [pkg, info] of Object.entries(vulns)) {
          results.push({
            file: 'package.json',
            reason: `Vulnerable dependency: ${pkg} (${info.severity})`,
          });
        }
      } catch {
        logger.warn(`Could not parse npm audit output: ${err.message}`, AGENT_TAG);
      }
    } else {
      logger.warn(`Could not run npm audit: ${err.message}`, AGENT_TAG);
    }
  }

  return results;
}

/**
 * Maps a category to its analysis function.
 */
const ANALYZERS = {
  [CATEGORIES.DUPLICATE]: findDuplicateCandidates,
  [CATEGORIES.LONG_FUNCTIONS]: findLongFunctions,
  [CATEGORIES.MISSING_TESTS]: findMissingTests,
  [CATEGORIES.TODO_FIXME]: findTodoFixme,
  [CATEGORIES.VULNERABLE_DEPS]: findVulnerableDeps,
};

/**
 * Runs the full codebase analysis across all enabled categories.
 *
 * @param {string} cwd - Repository root
 * @param {Object} [options]
 * @param {string[]} [options.categories] - Categories to analyze (default: from config)
 * @returns {Array<{ category: string, file: string, reason: string }>}
 */
export function analyzeCodebase(cwd, options = {}) {
  const categories = options.categories || getEnabledCategories();
  const findings = [];

  logger.info(`Analyzing codebase (categories: ${categories.join(', ')})`, AGENT_TAG);

  for (const category of categories) {
    const analyzer = ANALYZERS[category];
    if (!analyzer) {
      logger.warn(`Unknown category: ${category}`, AGENT_TAG);
      continue;
    }

    const results = analyzer(cwd);
    for (const r of results) {
      findings.push({ category, file: r.file, reason: r.reason });
    }
  }

  logger.info(`Analysis complete: ${findings.length} finding(s)`, AGENT_TAG);
  return findings;
}

/**
 * Converts raw findings into proposals, deduplicates against existing proposals,
 * and limits to AUTO_IMPROVE_MAX_PROPOSALS.
 *
 * @param {Array<{ category: string, file: string, reason: string }>} findings
 * @param {string} projectId
 * @returns {Promise<Array<{ category: string, file: string, reason: string, proposalId?: string }>>}
 */
export async function generateProposals(findings, projectId) {
  const maxProposals = config.autoImproveMaxProposals;

  // Load existing proposals to avoid duplicates
  let existing = [];
  try {
    existing = await getAll('proposals');
  } catch (err) {
    logger.warn(`Could not load existing proposals: ${err.message}`, AGENT_TAG);
  }

  const existingKeys = new Set(
    existing.map(p => `${p.category}::${p.file}::${p.reason}`),
  );

  // Filter out duplicates
  const newFindings = findings.filter(
    f => !existingKeys.has(`${f.category}::${f.file}::${f.reason}`),
  );

  // Limit to max proposals
  const limited = newFindings.slice(0, maxProposals);

  // Create proposals in Firebase
  const proposals = [];
  for (const finding of limited) {
    try {
      const proposalData = {
        projectId,
        category: finding.category,
        file: finding.file,
        reason: finding.reason,
        status: 'pending',
        source: 'auto-improve',
        createdAt: new Date().toISOString(),
      };

      const proposalId = await create('proposals', proposalData);
      proposals.push({ ...finding, proposalId });
      logger.info(`Proposal created: [${finding.category}] ${finding.reason}`, AGENT_TAG);
    } catch (err) {
      logger.error(`Failed to create proposal: ${err.message}`, AGENT_TAG);
    }
  }

  return proposals;
}

/**
 * Main entry point: analyzes the codebase and generates improvement proposals.
 * Called by the daemon when the backlog is empty.
 *
 * @param {Object} options
 * @param {string} options.projectId - Project ID
 * @param {string} options.cwd - Repository root directory
 * @param {string[]} [options.categories] - Categories to analyze
 * @returns {Promise<{ findings: number, proposals: Array }>}
 */
export async function runAutoImprove({ projectId, cwd, categories }) {
  if (!config.autoImprove) {
    logger.info('Auto-improve is disabled (AUTO_IMPROVE=false)', AGENT_TAG);
    return { findings: 0, proposals: [] };
  }

  logger.info('Backlog empty — starting codebase analysis...', AGENT_TAG);

  const findings = analyzeCodebase(cwd, { categories });

  if (findings.length === 0) {
    logger.info('No improvement opportunities found', AGENT_TAG);
    return { findings: 0, proposals: [] };
  }

  const proposals = await generateProposals(findings, projectId);

  // Emit event
  eventBus.emitEvent(EVENT_TYPES.AUTO_IMPROVE_PROPOSALS_GENERATED, {
    metadata: {
      findingsCount: findings.length,
      proposalsCount: proposals.length,
      categories: [...new Set(findings.map(f => f.category))],
    },
  });

  logger.success(
    `Generated ${proposals.length} proposal(s) from ${findings.length} finding(s)`,
    AGENT_TAG,
  );

  return { findings: findings.length, proposals };
}
