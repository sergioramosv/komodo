import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const AGENT_TAG = 'KNOWLEDGE-GRAPH';

/** Hard cap for buildCoderContext output (~2K tokens ≈ 8000 chars). */
const CODER_CONTEXT_CHAR_LIMIT = 8000;

/**
 * Returns the directory path for a task's knowledge store.
 * @param {string} projectId
 * @param {string} taskId
 * @returns {string}
 */
function taskDir(projectId, taskId) {
  return join(config.knowledgeDir, projectId, taskId);
}

/**
 * Returns the path to the lessons file for a module.
 * @param {string} projectId
 * @param {string} module
 * @returns {string}
 */
function lessonsPath(projectId, module) {
  return join(config.knowledgeDir, projectId, 'lessons', `${module}.json`);
}

/**
 * Saves a section of knowledge for a specific agent phase.
 *
 * Writes to: knowledge/{projectId}/{taskId}/{agent}.json
 *
 * @param {string} projectId
 * @param {string} taskId
 * @param {'planner'|'architect'|'coder'|'security'|'reviewer'} agent
 * @param {Object} data
 */
export function saveSection(projectId, taskId, agent, data) {
  try {
    const dir = taskDir(projectId, taskId);
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, `${agent}.json`);
    writeFileSync(filePath, JSON.stringify({ ...data, _savedAt: new Date().toISOString() }, null, 2), 'utf-8');
    logger.debug(`KG saved: ${agent} for task ${taskId}`, AGENT_TAG);
  } catch (err) {
    logger.warn(`KG saveSection failed (${agent}/${taskId}): ${err.message}`, AGENT_TAG);
  }
}

/**
 * Loads a section of knowledge for a specific agent phase.
 * Returns null if the section does not exist.
 *
 * @param {string} projectId
 * @param {string} taskId
 * @param {string} agent
 * @returns {Object|null}
 */
export function loadSection(projectId, taskId, agent) {
  try {
    const filePath = join(taskDir(projectId, taskId), `${agent}.json`);
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (err) {
    logger.warn(`KG loadSection failed (${agent}/${taskId}): ${err.message}`, AGENT_TAG);
    return null;
  }
}

/**
 * Builds a compact context object for the Coder agent.
 *
 * Summarizes the architect plan into a brief (~2K tokens) string so Coder
 * doesn't need to re-read or explore the codebase.
 *
 * @param {string} projectId
 * @param {string} taskId
 * @returns {{ coderBrief: string } | null} null if no architect section exists
 */
export function buildCoderContext(projectId, taskId) {
  const architect = loadSection(projectId, taskId, 'architect');
  if (!architect) return null;

  try {
    const lines = [];

    if (architect.filesToCreate?.length) {
      lines.push('## Files to create');
      for (const f of architect.filesToCreate) {
        const exportsStr = f.exports?.length ? ` → exports: ${f.exports.join(', ')}` : '';
        lines.push(`- ${f.path}${exportsStr}`);
        if (f.purpose) lines.push(`  Purpose: ${f.purpose}`);
      }
    }

    if (architect.filesToModify?.length) {
      lines.push('## Files to modify');
      for (const f of architect.filesToModify) {
        lines.push(`- ${f.path}`);
        if (f.changes) {
          // Truncate long change descriptions to keep token budget low
          const changes = f.changes.length > 300 ? `${f.changes.slice(0, 300)}…` : f.changes;
          lines.push(`  Changes: ${changes}`);
        }
        if (f.importToAdd && f.importToAdd !== 'none') {
          lines.push(`  Import: ${f.importToAdd}`);
        }
      }
    }

    if (architect.implementationOrder?.length) {
      lines.push('## Implementation order');
      lines.push(architect.implementationOrder.join('\n'));
    }

    if (architect.dependencies?.length) {
      lines.push(`## New dependencies: ${architect.dependencies.join(', ')}`);
    }

    let coderBrief = lines.join('\n');

    // Enforce hard char cap
    if (coderBrief.length > CODER_CONTEXT_CHAR_LIMIT) {
      coderBrief = `${coderBrief.slice(0, CODER_CONTEXT_CHAR_LIMIT)}\n… (truncated for token budget)`;
    }

    return { coderBrief };
  } catch (err) {
    logger.warn(`KG buildCoderContext failed: ${err.message}`, AGENT_TAG);
    return null;
  }
}

/**
 * Builds a context object for the Reviewer agent.
 *
 * Combines architect plan highlights, coder decisions and security findings
 * so Reviewer doesn't need to re-read the full PR diff for these facts.
 *
 * @param {string} projectId
 * @param {string} taskId
 * @returns {{ reviewerBrief: string } | null}
 */
export function buildReviewerContext(projectId, taskId) {
  const architect = loadSection(projectId, taskId, 'architect');
  const coder = loadSection(projectId, taskId, 'coder');
  const security = loadSection(projectId, taskId, 'security');

  if (!architect && !coder && !security) return null;

  try {
    const lines = ['## Prior Agent Context'];

    if (architect) {
      const createCount = architect.filesToCreate?.length ?? 0;
      const modifyCount = architect.filesToModify?.length ?? 0;
      lines.push(`### Architect Plan (${createCount} to create, ${modifyCount} to modify)`);
      if (architect.filesToCreate?.length) {
        lines.push('Created: ' + architect.filesToCreate.map(f => f.path).join(', '));
      }
      if (architect.filesToModify?.length) {
        lines.push('Modified: ' + architect.filesToModify.map(f => f.path).join(', '));
      }
    }

    if (coder) {
      lines.push('### Coder Decisions');
      if (coder.summary) lines.push(coder.summary);
      if (coder.filesChanged?.length) {
        lines.push('Files changed: ' + coder.filesChanged.join(', '));
      }
      if (coder.prNumber) lines.push(`PR: #${coder.prNumber}`);
    }

    if (security) {
      lines.push('### Security / Quality');
      if (security.qualityGate) lines.push(`Quality Gate: ${security.qualityGate}`);
      if (security.issueCount != null) lines.push(`Issues: ${JSON.stringify(security.issueCount)}`);
      if (security.metrics) lines.push(`Metrics: ${JSON.stringify(security.metrics)}`);
    }

    return { reviewerBrief: lines.join('\n') };
  } catch (err) {
    logger.warn(`KG buildReviewerContext failed: ${err.message}`, AGENT_TAG);
    return null;
  }
}

/**
 * Builds a context object for the Tester agent.
 *
 * Combines architect plan (filesToCreate, filesToModify, risks) with coder
 * decisions (filesChanged, summary) and acceptance criteria from the task spec
 * so the Tester can generate surgical, targeted tests.
 *
 * @param {string} projectId
 * @param {string} taskId
 * @param {string[]} [acceptanceCriteria] - Acceptance criteria from the task spec
 * @returns {{ testerBrief: string } | null}
 */
export function buildTesterContext(projectId, taskId, acceptanceCriteria = []) {
  const architect = loadSection(projectId, taskId, 'architect');
  const coder = loadSection(projectId, taskId, 'coder');

  if (!architect && !coder) return null;

  try {
    const lines = ['## Test Context from Knowledge Graph'];

    if (architect) {
      if (architect.filesToCreate?.length) {
        lines.push('### Files created by Coder');
        lines.push(architect.filesToCreate.map(f => `- ${f.path}`).join('\n'));
      }
      if (architect.filesToModify?.length) {
        lines.push('### Files modified by Coder');
        lines.push(architect.filesToModify.map(f => `- ${f.path}`).join('\n'));
      }
      if (architect.risks?.length) {
        lines.push('### Risks identified by Architect');
        lines.push(architect.risks.map(r => `- ${r}`).join('\n'));
      }
    }

    if (coder) {
      if (coder.summary) {
        lines.push('### Coder summary');
        lines.push(coder.summary);
      }
      if (coder.filesChanged?.length) {
        lines.push('### Actual files changed');
        lines.push(coder.filesChanged.map(f => `- ${f}`).join('\n'));
      }
    }

    if (acceptanceCriteria.length) {
      lines.push('### Acceptance criteria to cover');
      lines.push(acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n'));
    }

    return { testerBrief: lines.join('\n') };
  } catch (err) {
    logger.warn(`KG buildTesterContext failed: ${err.message}`, AGENT_TAG);
    return null;
  }
}

/**
 * Extracts lessons from a completed task and saves them under
 * knowledge/{projectId}/lessons/{module}.json for future tasks in the same module.
 *
 * Reads reviewer.json + architect.json to distill lessons.
 *
 * @param {string} projectId
 * @param {string} taskId
 * @param {string} [module='general'] - Module/domain label
 */
export function extractAndSaveLessons(projectId, taskId, module = 'general') {
  try {
    const architect = loadSection(projectId, taskId, 'architect');
    const reviewer = loadSection(projectId, taskId, 'reviewer');
    const coder = loadSection(projectId, taskId, 'coder');

    if (!architect && !reviewer) return;

    const lessons = [];

    // Lessons from reviewer feedback
    if (reviewer?.issues?.length) {
      for (const issue of reviewer.issues) {
        if (issue.severity === 'critical' || issue.severity === 'major') {
          lessons.push(`[${issue.severity}] ${issue.description || issue.message || JSON.stringify(issue)}`);
        }
      }
    }

    if (reviewer?.positives?.length) {
      for (const positive of reviewer.positives.slice(0, 3)) {
        lessons.push(`[good] ${positive}`);
      }
    }

    // Lessons from architect patterns
    if (architect?.risks?.length) {
      for (const risk of architect.risks.slice(0, 3)) {
        lessons.push(`[risk] ${risk}`);
      }
    }

    // Summary of what was implemented
    if (coder?.summary) {
      lessons.push(`[done] ${coder.summary}`);
    }

    if (!lessons.length) return;

    const filePath = lessonsPath(projectId, module);
    mkdirSync(join(config.knowledgeDir, projectId, 'lessons'), { recursive: true });

    // Read-merge-write with retry on race condition
    let existing = { lessons: [] };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (existsSync(filePath)) {
          existing = JSON.parse(readFileSync(filePath, 'utf-8'));
        }
        break;
      } catch {
        // Retry once on read error
      }
    }

    const merged = [
      ...(existing.lessons || []),
      {
        taskId,
        extractedAt: new Date().toISOString(),
        lessons,
      },
    ];

    // Keep last 20 task-lesson entries per module to avoid unbounded growth
    const trimmed = merged.slice(-20);

    writeFileSync(filePath, JSON.stringify({ module, lessons: trimmed }, null, 2), 'utf-8');
    logger.info(`KG lessons extracted for module "${module}" (${lessons.length} entries)`, AGENT_TAG);
  } catch (err) {
    logger.warn(`KG extractAndSaveLessons failed: ${err.message}`, AGENT_TAG);
  }
}

/**
 * Saves a healing attempt record for a task.
 * Appends to knowledge/{projectId}/{taskId}/healing.json, keeping max 50 entries.
 *
 * @param {string} projectId
 * @param {string} taskId
 * @param {{ strategy: string|null, errorMessage: string, healed: boolean, action?: string, timestamp: string }} attempt
 */
export function saveHealingAttempt(projectId, taskId, attempt) {
  try {
    const dir = taskDir(projectId, taskId);
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, 'healing.json');

    let existing = { attempts: [] };
    if (existsSync(filePath)) {
      try {
        existing = JSON.parse(readFileSync(filePath, 'utf-8'));
      } catch {
        // Ignore parse errors — start fresh
      }
    }

    const attempts = [...(existing.attempts || []), attempt];
    const trimmed = attempts.slice(-50);

    writeFileSync(filePath, JSON.stringify({ taskId, attempts: trimmed }, null, 2), 'utf-8');
    logger.debug(`KG saved healing attempt for task ${taskId}`, AGENT_TAG);
  } catch (err) {
    logger.warn(`KG saveHealingAttempt failed (${taskId}): ${err.message}`, AGENT_TAG);
  }
}

/**
 * Loads the healing attempt history for a task.
 * Returns an empty array if none exist.
 *
 * @param {string} projectId
 * @param {string} taskId
 * @returns {Array<{ strategy: string|null, errorMessage: string, healed: boolean, action?: string, timestamp: string }>}
 */
export function loadHealingHistory(projectId, taskId) {
  try {
    const filePath = join(taskDir(projectId, taskId), 'healing.json');
    if (!existsSync(filePath)) return [];
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    return data.attempts || [];
  } catch (err) {
    logger.warn(`KG loadHealingHistory failed (${taskId}): ${err.message}`, AGENT_TAG);
    return [];
  }
}

/**
 * Loads lessons for a module and formats them as a concise string for prompt injection.
 * Returns an empty string if no lessons exist (graceful fallback for first task).
 *
 * @param {string} projectId
 * @param {string} module
 * @returns {string}
 */
export function loadModuleLessons(projectId, module = 'general') {
  try {
    const filePath = lessonsPath(projectId, module);
    if (!existsSync(filePath)) return '';

    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    const entries = data.lessons || [];
    if (!entries.length) return '';

    // Flatten the last 3 task-lesson entries into a readable list
    const recent = entries.slice(-3);
    const lines = [];
    for (const entry of recent) {
      for (const lesson of entry.lessons || []) {
        lines.push(`- ${lesson}`);
      }
    }

    return lines.join('\n');
  } catch (err) {
    logger.warn(`KG loadModuleLessons failed: ${err.message}`, AGENT_TAG);
    return '';
  }
}
