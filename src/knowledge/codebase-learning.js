import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const AGENT_TAG = 'CODEBASE-LEARNING';

/** Hard cap for buildLearningContext output (~500-1K tokens ≈ 2000-4000 chars). */
const LEARNING_CONTEXT_CHAR_LIMIT = 3500;

/** Max entries kept per category to avoid unbounded growth. */
const MAX_ENTRIES_PER_CATEGORY = 15;

/**
 * Returns the path to the codebase learning store for a project.
 * @param {string} projectId
 * @returns {string}
 */
function learningPath(projectId) {
  return join(config.knowledgeDir, projectId, 'codebase-learning.json');
}

/**
 * Loads the codebase learning store for a project.
 * Returns a default empty store if it doesn't exist yet.
 *
 * @param {string} projectId
 * @returns {{ patterns: string[], antiPatterns: string[], updatedAt: string|null }}
 */
function loadLearningStore(projectId) {
  try {
    const filePath = learningPath(projectId);
    if (!existsSync(filePath)) {
      return { patterns: [], antiPatterns: [], updatedAt: null };
    }
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    return {
      patterns: data.patterns || [],
      antiPatterns: data.antiPatterns || [],
      updatedAt: data.updatedAt || null,
    };
  } catch (err) {
    logger.warn(`Codebase learning load failed: ${err.message}`, AGENT_TAG);
    return { patterns: [], antiPatterns: [], updatedAt: null };
  }
}

/**
 * Persists the learning store to disk.
 *
 * @param {string} projectId
 * @param {{ patterns: string[], antiPatterns: string[] }} store
 */
function saveLearningStore(projectId, store) {
  const filePath = learningPath(projectId);
  mkdirSync(join(config.knowledgeDir, projectId), { recursive: true });
  writeFileSync(
    filePath,
    JSON.stringify({ ...store, updatedAt: new Date().toISOString() }, null, 2),
    'utf-8',
  );
}

/**
 * Deduplicates an array of strings by normalising whitespace and lowercasing.
 * Preserves original casing of the first occurrence.
 *
 * @param {string[]} entries
 * @returns {string[]}
 */
function dedup(entries) {
  const seen = new Set();
  return entries.filter((e) => {
    const key = e.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Updates the codebase learning store after a task completes.
 *
 * - On approval: positives from the Reviewer are added as patterns.
 * - On rejection: issues from the Reviewer are added as anti-patterns.
 *   If the rejection reason mentions 'convenciones', the related issues are
 *   marked with a [convention] prefix to reinforce them.
 *
 * @param {string} projectId
 * @param {string} taskId
 * @param {{ approved: boolean, issues?: Array<{severity:string, description?:string, message?:string}>, positives?: string[], error?: string }} reviewOutcome
 */
export function updateLearning(projectId, taskId, reviewOutcome) {
  try {
    if (!projectId || !reviewOutcome) return;

    const store = loadLearningStore(projectId);
    const { approved, issues = [], positives = [] } = reviewOutcome;

    const CONVENTION_RE = /convenci[oó]n|estilo|naming|indent/i;

    if (approved) {
      // Merge reviewer positives as learned patterns
      for (const positive of positives) {
        if (positive) {
          store.patterns.push(positive.trim());
        }
      }
    } else {
      // Merge issues as anti-patterns; tag convention-related issues individually
      for (const issue of issues) {
        const text = issue.description || issue.message || JSON.stringify(issue);
        if (!text) continue;

        const prefix = CONVENTION_RE.test(text) ? '[convention] ' : '';
        store.antiPatterns.push(`${prefix}${text.trim()}`);
      }
    }

    // Deduplicate and trim to max size
    store.patterns = dedup(store.patterns).slice(-MAX_ENTRIES_PER_CATEGORY);
    store.antiPatterns = dedup(store.antiPatterns).slice(-MAX_ENTRIES_PER_CATEGORY);

    saveLearningStore(projectId, store);

    const action = approved ? `+${positives.length} patterns` : `+${issues.length} anti-patterns`;
    logger.info(
      `Codebase learning updated for task ${taskId}: ${action} (total: ${store.patterns.length} patterns, ${store.antiPatterns.length} anti-patterns)`,
      AGENT_TAG,
    );
  } catch (err) {
    logger.warn(`updateLearning failed (non-blocking): ${err.message}`, AGENT_TAG);
  }
}

/**
 * Builds a concise learning context string (~500-1K tokens) for injection
 * into the Coder's prompt.
 *
 * Sections included (only when non-empty):
 *  - Architecture & naming conventions (patterns)
 *  - Anti-patterns to avoid
 *
 * @param {string} projectId
 * @returns {{ learningContext: string, stats: { patterns: number, antiPatterns: number } } | null}
 */
export function buildLearningContext(projectId) {
  try {
    if (!projectId) return null;

    const store = loadLearningStore(projectId);
    const { patterns, antiPatterns } = store;

    if (!patterns.length && !antiPatterns.length) return null;

    const lines = [];

    if (patterns.length) {
      lines.push('### Proven patterns (follow these)');
      for (const p of patterns.slice(-10)) {
        lines.push(`- ${p}`);
      }
    }

    if (antiPatterns.length) {
      lines.push('### Anti-patterns (avoid these)');
      for (const ap of antiPatterns.slice(-10)) {
        lines.push(`- ${ap}`);
      }
    }

    let learningContext = lines.join('\n');

    if (learningContext.length > LEARNING_CONTEXT_CHAR_LIMIT) {
      learningContext = `${learningContext.slice(0, LEARNING_CONTEXT_CHAR_LIMIT)}\n… (truncated for token budget)`;
    }

    return {
      learningContext,
      stats: { patterns: patterns.length, antiPatterns: antiPatterns.length },
    };
  } catch (err) {
    logger.warn(`buildLearningContext failed (non-blocking): ${err.message}`, AGENT_TAG);
    return null;
  }
}
