import { runAgent } from '../agents/base-agent.js';
import { logger } from '../utils/logger.js';
import { findAvoidedPatterns } from '../intelligence/review-feedback.js';

const AGENT_TAG = 'FEEDBACK';

/**
 * Severity mapping from Reviewer issue format to memory-mcp pattern format.
 */
const SEVERITY_MAP = {
  critical: 'high',
  major: 'high',
  minor: 'medium',
  suggestion: 'low',
};

/**
 * Extracts error-type tags from an issue description.
 *
 * @param {Object} issue - Review issue
 * @returns {string[]} Tags
 */
function extractTags(issue) {
  const tags = [];
  const desc = (issue.description || '').toLowerCase();

  if (desc.includes('error handling') || desc.includes('try') || desc.includes('catch')) tags.push('error-handling');
  if (desc.includes('test') || desc.includes('unit test')) tags.push('testing');
  if (desc.includes('naming') || desc.includes('variable name')) tags.push('naming');
  if (desc.includes('security') || desc.includes('xss') || desc.includes('injection')) tags.push('security');
  if (desc.includes('null') || desc.includes('undefined') || desc.includes('edge case')) tags.push('edge-cases');
  if (desc.includes('async') || desc.includes('await') || desc.includes('promise')) tags.push('async');
  if (desc.includes('import') || desc.includes('export') || desc.includes('module')) tags.push('modules');
  if (desc.includes('type') || desc.includes('typescript')) tags.push('types');
  if (desc.includes('duplicate') || desc.includes('duplicat')) tags.push('duplication');
  if (desc.includes('performance') || desc.includes('memory')) tags.push('performance');

  if (tags.length === 0) tags.push('code-quality');

  return tags;
}

/**
 * Records review issues as patterns in memory-mcp using a mini agent.
 * Only records critical and major issues (minor/suggestion are noise for feedback).
 *
 * @param {Array} issues - Issues from the Reviewer
 * @param {string} [taskId] - Task ID
 * @param {number} [prNumber] - PR number
 */
export async function recordReviewIssues(issues, taskId, prNumber) {
  // Only record critical and major issues to keep feedback relevant
  const significant = (issues || []).filter(issue => {
    const severity = typeof issue === 'string' ? 'major' : issue.severity;
    return severity === 'critical' || severity === 'major';
  });

  if (significant.length === 0) {
    logger.info('No significant issues to record as patterns', AGENT_TAG);
    return;
  }

  // Build the record_pattern calls as a prompt for the mini agent
  const patternCalls = significant.map((issue, i) => {
    const desc = typeof issue === 'string' ? issue : issue.description || JSON.stringify(issue);
    const severity = SEVERITY_MAP[issue.severity] || 'medium';
    const tags = typeof issue === 'string' ? ['code-quality'] : extractTags(issue);
    const suggestion = issue.suggestion || '';

    return `${i + 1}. record_pattern({ type: "error", description: "${desc.replace(/"/g, '\\"')}", tags: ${JSON.stringify(tags)}, severity: "${severity}", resolution: "${suggestion.replace(/"/g, '\\"')}"${taskId ? `, taskId: "${taskId}"` : ''}${prNumber ? `, prNumber: ${prNumber}` : ''} })`;
  });

  const prompt = `Registra estos patrones de error encontrados en la review. Llama a record_pattern para cada uno:\n\n${patternCalls.join('\n')}\n\nResponde con { "recorded": ${significant.length} }.`;

  logger.info(`Recording ${significant.length} review issues as patterns`, AGENT_TAG);

  await runAgent({
    name: 'KOMODO',
    systemPrompt: 'Registra patrones de error en memoria. Llama a record_pattern para cada patrón indicado. Responde con JSON.',
    userPrompt: prompt,
    mcpServerNames: ['memory-mcp'],
    maxTurns: 10,
  });
}

/**
 * Records patterns that were successfully avoided by the Coder.
 * When the Coder avoids a frequent mistake, we record a "positive" pattern
 * to adjust the feedback loop.
 *
 * @param {Array} reviewIssues - Issues found in the current (approved) review
 */
export async function recordAvoidedPatterns(reviewIssues) {
  const avoided = findAvoidedPatterns(reviewIssues);

  if (avoided.length === 0) {
    return;
  }

  const avoidedDescs = avoided.map((p, i) =>
    `${i + 1}. record_pattern({ type: "positive", description: "Avoided: ${p.description.replace(/"/g, '\\"')}", tags: ${JSON.stringify(p.tags || [])}, severity: "low" })`,
  );

  const prompt = `El Coder evitó estos errores frecuentes. Registra como patrones positivos:\n\n${avoidedDescs.join('\n')}\n\nResponde con { "recorded": ${avoided.length} }.`;

  logger.info(`Recording ${avoided.length} avoided patterns as positive`, AGENT_TAG);

  await runAgent({
    name: 'KOMODO',
    systemPrompt: 'Registra patrones positivos en memoria. Llama a record_pattern para cada uno. Responde con JSON.',
    userPrompt: prompt,
    mcpServerNames: ['memory-mcp'],
    maxTurns: 10,
  });
}
