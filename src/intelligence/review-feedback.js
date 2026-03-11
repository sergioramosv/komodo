import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const AGENT_TAG = 'REVIEW-FEEDBACK';

/**
 * Path to the memory-mcp patterns store.
 */
const PATTERNS_FILE = resolve(config.memoryDir, 'patterns.json');

/**
 * Time decay: patterns older than DECAY_DAYS have reduced weight.
 * Weight = 1.0 for recent patterns, decays linearly to 0.1 at MAX_AGE_DAYS.
 */
const DECAY_DAYS = 30;
const MAX_AGE_DAYS = 90;

/**
 * Reads patterns directly from the memory store file.
 *
 * @returns {Array} Array of pattern objects
 */
export function readPatterns() {
  try {
    if (!existsSync(PATTERNS_FILE)) return [];
    const raw = readFileSync(PATTERNS_FILE, 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data.patterns) ? data.patterns : [];
  } catch {
    return [];
  }
}

/**
 * Calculates a time-decay weight for a pattern based on its lastSeen date.
 * Recent patterns (< DECAY_DAYS) get weight 1.0.
 * Older patterns decay linearly to 0.1 at MAX_AGE_DAYS.
 *
 * @param {string} lastSeen - ISO date string (YYYY-MM-DD)
 * @returns {number} Weight between 0.1 and 1.0
 */
export function calculateDecayWeight(lastSeen) {
  if (!lastSeen) return 0.5;

  const now = new Date();
  const seen = new Date(lastSeen);
  const daysSince = Math.floor((now - seen) / (1000 * 60 * 60 * 24));

  if (daysSince <= DECAY_DAYS) return 1.0;
  if (daysSince >= MAX_AGE_DAYS) return 0.1;

  // Linear decay from 1.0 to 0.1 between DECAY_DAYS and MAX_AGE_DAYS
  const range = MAX_AGE_DAYS - DECAY_DAYS;
  const elapsed = daysSince - DECAY_DAYS;
  return 1.0 - (elapsed / range) * 0.9;
}

/**
 * Calculates a weighted score for a pattern combining frequency, severity, and time decay.
 *
 * @param {Object} pattern - Pattern object from memory store
 * @returns {number} Weighted score
 */
export function calculatePatternScore(pattern) {
  const severityMultiplier = { high: 3, medium: 2, low: 1 };
  const severity = severityMultiplier[pattern.severity] || 1;
  const frequency = pattern.frequency || 1;
  const decay = calculateDecayWeight(pattern.lastSeen);

  return frequency * severity * decay;
}

/**
 * Queries the top N most relevant error patterns, sorted by weighted score.
 * Only includes error and anti-pattern types (not positive or style).
 *
 * @param {Object} [options]
 * @param {number} [options.limit=5] - Max patterns to return
 * @returns {Array<{pattern: Object, score: number, percentage: number}>}
 */
export function getTopPatterns({ limit = 5 } = {}) {
  const patterns = readPatterns();

  // Only errors and anti-patterns are relevant for "mistakes to avoid"
  const relevant = patterns.filter(p => p.type === 'error' || p.type === 'anti-pattern');

  if (relevant.length === 0) return [];

  // Calculate total reviews for percentage estimation
  const totalFrequency = relevant.reduce((sum, p) => sum + (p.frequency || 1), 0);

  // Score and sort
  const scored = relevant
    .map(p => ({
      pattern: p,
      score: calculatePatternScore(p),
      percentage: Math.round(((p.frequency || 1) / totalFrequency) * 100),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored;
}

/**
 * Formats top patterns as a prompt-ready "COMMON MISTAKES TO AVOID" section.
 *
 * @param {Object} [options]
 * @param {number} [options.limit=5] - Max patterns to include
 * @returns {string} Formatted section or empty string if no patterns
 */
export function formatFeedbackSection({ limit = 5 } = {}) {
  const topPatterns = getTopPatterns({ limit });

  if (topPatterns.length === 0) return '';

  const lines = topPatterns.map(({ pattern, percentage }, i) => {
    const resolution = pattern.resolution ? ` — ${pattern.resolution}` : '';
    return `${i + 1}. ${pattern.description} (found in ${percentage}% of reviews)${resolution}`;
  });

  return `COMMON MISTAKES TO AVOID:\n${lines.join('\n')}`;
}

/**
 * Extracts lowercase keywords from a task spec for relevance matching.
 *
 * @param {Object} taskSpec - Task specification object
 * @returns {string[]} Array of meaningful keywords (length > 3)
 */
function extractTaskKeywords(taskSpec) {
  if (!taskSpec) return [];
  const text = [
    taskSpec.title || '',
    taskSpec.userStory?.what || '',
    taskSpec.userStory?.why || '',
    ...(taskSpec.acceptanceCriteria || []),
  ].join(' ').toLowerCase();
  return [...new Set(text.split(/\W+/).filter(w => w.length > 3))];
}

/**
 * Scores a pattern by how many task keywords appear in its description/tags.
 *
 * @param {Object} pattern - Pattern object
 * @param {string[]} taskKeywords - Keywords extracted from task spec
 * @returns {number} Relevance score (0 = unrelated, higher = more relevant)
 */
function scorePatternRelevance(pattern, taskKeywords) {
  if (taskKeywords.length === 0) return 1;
  const patternText = [pattern.description || '', ...(pattern.tags || [])].join(' ').toLowerCase();
  return taskKeywords.reduce((count, kw) => count + (patternText.includes(kw) ? 1 : 0), 0);
}

/**
 * Returns a prompt-ready feedback context for the Coder.
 * When taskSpec is provided, filters top 5 patterns by relevance to the task.
 *
 * @param {Object} [options]
 * @param {Object} [options.taskSpec] - Task spec for relevance-based filtering
 * @returns {{ summary: string, patternCount: number }}
 */
export function getReviewFeedbackContext({ taskSpec } = {}) {
  try {
    // Fetch more candidates when we have a task to filter by
    const candidateLimit = taskSpec ? 10 : 5;
    const candidates = getTopPatterns({ limit: candidateLimit });

    if (candidates.length === 0) return { summary: '', patternCount: 0 };

    let selected;
    if (taskSpec) {
      const keywords = extractTaskKeywords(taskSpec);
      selected = candidates
        .map(p => ({ ...p, relevance: scorePatternRelevance(p.pattern, keywords) }))
        // Sort by combined relevance × weighted score, then fall back to score alone
        .sort((a, b) => {
          const aRank = a.relevance > 0 ? a.relevance * a.score : a.score * 0.5;
          const bRank = b.relevance > 0 ? b.relevance * b.score : b.score * 0.5;
          return bRank - aRank;
        })
        .slice(0, 5);
      logger.info(`Injecting ${selected.length} task-relevant patterns (keywords: ${keywords.slice(0, 5).join(', ')})`, AGENT_TAG);
    } else {
      selected = candidates.slice(0, 5);
      logger.info(`Injecting ${selected.length} review feedback patterns into Coder prompt`, AGENT_TAG);
    }

    const lines = selected.map(({ pattern, percentage }, i) => {
      const resolution = pattern.resolution ? ` — ${pattern.resolution}` : '';
      return `${i + 1}. ${pattern.description} (found in ${percentage}% of reviews)${resolution}`;
    });

    return {
      summary: `COMMON MISTAKES TO AVOID:\n${lines.join('\n')}`,
      patternCount: selected.length,
    };
  } catch (err) {
    logger.warn(`Could not generate review feedback: ${err.message}`, AGENT_TAG);
    return { summary: '', patternCount: 0 };
  }
}

/**
 * Checks which of the top frequent patterns were avoided in the current review
 * (i.e., the review found NO issues matching those patterns).
 *
 * @param {Array} reviewIssues - Issues found by the Reviewer in this review
 * @returns {Array<Object>} Patterns that were successfully avoided
 */
export function findAvoidedPatterns(reviewIssues) {
  const topPatterns = getTopPatterns({ limit: 10 });
  if (topPatterns.length === 0) return [];

  const issueDescriptions = (reviewIssues || [])
    .map(issue => (typeof issue === 'string' ? issue : issue.description || '').toLowerCase())
    .filter(Boolean);

  // A pattern is "avoided" if none of the review issues match it
  return topPatterns
    .filter(({ pattern }) => {
      const patternDesc = pattern.description.toLowerCase();
      const patternTags = (pattern.tags || []).map(t => t.toLowerCase());

      return !issueDescriptions.some(desc =>
        desc.includes(patternDesc) ||
        patternDesc.includes(desc) ||
        patternTags.some(tag => desc.includes(tag)),
      );
    })
    .map(({ pattern }) => pattern);
}
