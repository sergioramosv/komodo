import { runAgent } from './base-agent.js';
import { getReviewerSystemPrompt } from '../prompts/reviewer-system.js';
import { logger } from '../utils/logger.js';
import { validateAgentResponse } from '../utils/parser.js';

/**
 * Ejecuta el agente Reviewer para revisar una PR.
 *
 * @param {Object} options
 * @param {number} options.prNumber - Número de la PR
 * @param {string} options.repo - Repositorio en formato owner/repo
 * @param {Object} options.taskSpec - Especificación original de la tarea
 * @param {string} [options.cwd] - Directorio del repositorio (para leer código)
 * @returns {Promise<{
 *   success: boolean,
 *   review: {verdict, score, issues[], positives[], summary} | null,
 *   cost: number | null,
 *   duration: number,
 *   error?: string
 * }>}
 */
export async function reviewPR({ prNumber, repo, taskSpec, cwd }) {
  logger.taskHeader(`REVIEWER - Revisando PR #${prNumber}`);

  const systemPrompt = getReviewerSystemPrompt();

  const criteriaList = (taskSpec.acceptanceCriteria || [])
    .map((c, i) => `${i + 1}. ${c}`)
    .join('\n');

  const userPrompt = `Revisa la Pull Request #${prNumber} del repositorio "${repo}".

## Contexto de la tarea
- **Título**: ${taskSpec.title}
- **User Story**: Como ${taskSpec.userStory?.who || 'usuario'}, quiero ${taskSpec.userStory?.what || taskSpec.title}, para ${taskSpec.userStory?.why || 'mejorar la app'}

## Criterios de aceptación
${criteriaList || 'No especificados'}

## Instrucciones
1. Llama a get_review_brief() para ver errores frecuentes del coder
2. Lee el diff completo con get_pr_diff({ repo: "${repo}", prNumber: ${prNumber} })
3. Revisa cada criterio (correctitud, error handling, edge cases, naming, tests, seguridad)
4. Registra cada issue en memoria con record_pattern()
5. Envía la review con create_review():
   - APPROVE si score >= 8 y sin issues critical/major
   - REQUEST_CHANGES si hay issues critical/major o score < 8
6. Devuelve el resultado como JSON con: verdict, score, issues, positives, summary`;

  const result = await runAgent({
    name: 'REVIEWER',
    systemPrompt,
    userPrompt,
    mcpServerNames: ['github-mcp', 'memory-mcp'],
    cwd,
    maxTurns: 30,
    // El Reviewer NO puede modificar código
    disallowedTools: ['Write', 'Edit', 'NotebookEdit'],
  });

  if (!result.success || !result.result) {
    return {
      success: false,
      review: null,
      cost: result.cost,
      duration: result.duration,
      error: result.error || 'El Reviewer no devolvió un resultado válido',
    };
  }

  const data = result.result;
  const { valid, missing } = validateAgentResponse(data, ['verdict', 'score']);

  if (!valid) {
    logger.warn(`Respuesta del Reviewer incompleta. Faltan: ${missing.join(', ')}`, 'REVIEWER');
    return {
      success: false,
      review: null,
      cost: result.cost,
      duration: result.duration,
      error: `Campos faltantes: ${missing.join(', ')}`,
    };
  }

  // Normalizar el verdict
  const verdict = normalizeVerdict(data.verdict, data.score, data.issues);

  // Log del resultado
  if (verdict === 'APPROVED') {
    logger.success(`PR #${prNumber} APROBADA (score: ${data.score}/10)`, 'REVIEWER');
  } else {
    const issueCount = (data.issues || []).length;
    logger.warn(`PR #${prNumber} REQUEST_CHANGES (score: ${data.score}/10, ${issueCount} issues)`, 'REVIEWER');
  }

  if (data.positives?.length) {
    data.positives.forEach(p => logger.info(`  + ${p}`, 'REVIEWER'));
  }

  return {
    success: true,
    review: {
      verdict,
      score: data.score,
      issues: data.issues || [],
      positives: data.positives || [],
      summary: data.summary || '',
    },
    cost: result.cost,
    duration: result.duration,
  };
}

/**
 * Normaliza el veredicto asegurando consistencia con las reglas:
 * - APPROVED solo si score >= 8 y 0 issues critical/major
 * - REQUEST_CHANGES en cualquier otro caso
 */
function normalizeVerdict(rawVerdict, score, issues = []) {
  const hasCritical = issues.some(i => i.severity === 'critical');
  const hasMajor = issues.some(i => i.severity === 'major');

  // Forzar REQUEST_CHANGES si no cumple el umbral
  if (score < 8 || hasCritical || hasMajor) {
    return 'REQUEST_CHANGES';
  }

  // Normalizar variantes (APPROVED, Approved, approve, etc.)
  const normalized = (rawVerdict || '').toUpperCase().trim();
  if (normalized.includes('APPROV')) return 'APPROVED';

  return 'REQUEST_CHANGES';
}
