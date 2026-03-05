import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const AGENT_TAG = 'CONTEXT-AFFINITY';

/**
 * Extracts the top-level module/directory from a file path.
 * e.g. "src/agents/planner.js" → "src/agents"
 *
 * @param {string} filePath
 * @returns {string}
 */
export function extractModule(filePath) {
  const parts = filePath.replace(/\\/g, '/').split('/');
  // Return up to the second directory level (e.g. "src/agents")
  if (parts.length >= 2) return parts.slice(0, 2).join('/');
  return parts[0] || '';
}

/**
 * Extracts keywords from a task's title and user story for semantic matching.
 * Filters out common stop words and returns lowercase tokens.
 *
 * @param {{ title?: string, userStory?: { who?: string, what?: string, why?: string } }} task
 * @returns {Set<string>}
 */
export function extractTaskKeywords(task) {
  const STOP_WORDS = new Set([
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'need', 'must',
    'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us',
    'my', 'your', 'his', 'its', 'our', 'their',
    'this', 'that', 'these', 'those', 'of', 'in', 'to', 'for', 'with',
    'on', 'at', 'from', 'by', 'as', 'into', 'about', 'between',
    'and', 'or', 'but', 'not', 'no', 'so', 'if', 'then',
    'como', 'que', 'para', 'con', 'por', 'del', 'los', 'las', 'una', 'uno',
    'el', 'la', 'en', 'de', 'al', 'es', 'se', 'su', 'un',
  ]);

  const text = [
    task.title || '',
    task.userStory?.what || '',
    task.userStory?.why || '',
  ].join(' ').toLowerCase();

  const tokens = text.match(/[a-záéíóúñü]{3,}/g) || [];
  return new Set(tokens.filter(t => !STOP_WORDS.has(t)));
}

/**
 * Calculates the context affinity score between a previous task context
 * and a candidate task. Returns a value between 0 and 1.
 *
 * Two signals are combined:
 * 1. Module overlap: how many modules from the previous task's changed files
 *    are mentioned in the candidate task's title/userStory (or overlap by keyword)
 * 2. Keyword overlap: Jaccard similarity of extracted keywords
 *
 * @param {{ filesChanged: string[], keywords: Set<string> }} previousContext
 * @param {{ title?: string, userStory?: object }} candidateTask
 * @returns {{ score: number, sharedModules: string[] }}
 */
export function calculateAffinity(previousContext, candidateTask) {
  if (!previousContext || !previousContext.filesChanged?.length) {
    return { score: 0, sharedModules: [] };
  }

  const prevModules = [...new Set(previousContext.filesChanged.map(extractModule))];
  const candidateKeywords = extractTaskKeywords(candidateTask);

  // Signal 1: Module overlap — check if candidate's text mentions any module
  const candidateText = [
    candidateTask.title || '',
    candidateTask.userStory?.what || '',
    candidateTask.userStory?.why || '',
  ].join(' ').toLowerCase();

  const sharedModules = prevModules.filter(mod => {
    const modParts = mod.toLowerCase().split('/');
    return modParts.some(part => part.length >= 3 && candidateText.includes(part));
  });

  const moduleScore = prevModules.length > 0
    ? Math.min(sharedModules.length / prevModules.length, 1)
    : 0;

  // Signal 2: Keyword overlap (Jaccard similarity)
  const prevKeywords = previousContext.keywords || new Set();
  let keywordScore = 0;

  if (prevKeywords.size > 0 && candidateKeywords.size > 0) {
    const intersection = [...prevKeywords].filter(k => candidateKeywords.has(k));
    const union = new Set([...prevKeywords, ...candidateKeywords]);
    keywordScore = intersection.length / union.size;
  }

  // Combined score: weighted average (modules have higher weight)
  const score = (moduleScore * 0.6) + (keywordScore * 0.4);

  return { score: Math.round(score * 1000) / 1000, sharedModules };
}

/**
 * Applies context affinity boost to eligible tasks, reordering them
 * so that tasks sharing context with the previous task are preferred
 * when priorities are similar.
 *
 * The boost works as a multiplier on the task's effective priority:
 *   effectivePriority = basePriority * (1 + CONTEXT_AFFINITY_BOOST * affinityScore)
 *
 * The boost does NOT override strong priority differences.
 *
 * @param {Array<{ id: string, title?: string, userStory?: object, bizPoints?: number, devPoints?: number }>} eligibleTasks
 * @param {{ filesChanged: string[], keywords: Set<string> }} previousContext
 * @returns {Array<{ task: object, effectivePriority: number, affinityScore: number, boosted: boolean }>}
 */
export function rankWithContextAffinity(eligibleTasks, previousContext) {
  const boost = config.contextAffinityBoost;

  if (!previousContext || !previousContext.filesChanged?.length || boost <= 0) {
    return eligibleTasks.map(task => ({
      task,
      effectivePriority: (task.bizPoints || 0) + (task.devPoints || 0),
      affinityScore: 0,
      boosted: false,
    }));
  }

  const ranked = eligibleTasks.map(task => {
    const basePriority = (task.bizPoints || 0) + (task.devPoints || 0);
    const { score: affinityScore, sharedModules } = calculateAffinity(previousContext, task);

    const effectivePriority = basePriority * (1 + boost * affinityScore);
    const boosted = affinityScore > 0;

    if (boosted) {
      const moduleInfo = sharedModules.length > 0
        ? `shares module: ${sharedModules.join(', ')}`
        : 'keyword similarity';
      logger.info(
        `Task [${task.id}] boosted by context affinity (${moduleInfo}) with previous task`,
        AGENT_TAG,
      );
    }

    return { task, effectivePriority, affinityScore, boosted };
  });

  return ranked;
}

/**
 * Builds a context hint string to inject into the Planner prompt,
 * telling it which eligible task IDs are boosted and why.
 *
 * @param {Array<{ task: object, effectivePriority: number, affinityScore: number, boosted: boolean }>} ranked
 * @returns {string} Context hint for the Planner (empty string if no boosts)
 */
export function buildAffinityHint(ranked) {
  const boosted = ranked.filter(r => r.boosted && r.affinityScore > 0);
  if (boosted.length === 0) return '';

  const lines = [
    'CONTEXT AFFINITY — The following tasks share context with the previously completed task. Prefer them when priorities are similar:',
  ];

  for (const { task, affinityScore } of boosted) {
    lines.push(`- ${task.id} "${task.title}" (affinity: ${(affinityScore * 100).toFixed(0)}%)`);
  }

  return lines.join('\n');
}
