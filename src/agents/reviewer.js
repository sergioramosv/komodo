import { runAgent } from './base-agent.js';
import { getReviewerSystemPrompt } from '../prompts/reviewer-system.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { validateAgentResponse } from '../utils/parser.js';

/**
 * Build the MCP server list for the Reviewer agent.
 * Always includes github-mcp and memory-mcp; adds chrome-devtools when ENABLE_BROWSER_MCP=true.
 */
function getReviewerMcpServers() {
  const servers = ['github-mcp', 'memory-mcp'];
  if (config.enableBrowserMcp) {
    servers.push('chrome-devtools');
  }
  return servers;
}

/**
 * Construye la sección de SonarQube Analysis para el prompt del Reviewer.
 *
 * @param {Object} sonarReport - Reporte de SonarQube
 * @returns {string} Sección markdown formateada
 */
function buildSonarSection(sonarReport) {
  const qgStatus = sonarReport.qualityGate === 'OK' ? 'PASSED' : 'FAILED';
  const { issues, metrics, issueDetails = [] } = sonarReport;

  let section = `
## SonarQube Analysis

### Quality Gate: ${qgStatus}
- **Status**: ${sonarReport.qualityGate}
- **Bugs**: ${metrics.bugs} | **Vulnerabilities**: ${metrics.vulnerabilities} | **Code Smells**: ${metrics.code_smells}
- **Coverage**: ${metrics.coverage}% | **Duplication**: ${metrics.duplicated_lines_density}%
- **Issues total**: ${issues.BLOCKER} blocker, ${issues.CRITICAL} critical, ${issues.MAJOR} major, ${issues.MINOR} minor (${issues.total} total)`;

  if (issueDetails.length > 0) {
    section += `

### Issues BLOCKER y CRITICAL
| Severity | File | Line | Description |
|----------|------|------|-------------|
${issueDetails.map(i => `| ${i.severity} | ${i.file} | ${i.line} | ${i.message} |`).join('\n')}`;
  }

  section += `

### Instrucciones para el Reviewer
- **DEBES mencionar en tu review** si hay issues de SonarQube que el Coder debe corregir.
- Si el Quality Gate es **FAILED** y hay issues **BLOCKER**, tu verdict DEBE ser **REQUEST_CHANGES** obligatoriamente.
- No dupliques esfuerzo en lo que SonarQube ya cubre — enfócate en lógica de negocio, edge cases y criterios de aceptación.
- Si SonarQube reporta issues que consideras falsos positivos, menciónalo en tu review pero no los cuentes como issues.
`;

  return section;
}

/**
 * Ejecuta el agente Reviewer para revisar una PR.
 *
 * @param {Object} options
 * @param {number} options.prNumber - Número de la PR
 * @param {string} options.repo - Repositorio en formato owner/repo
 * @param {Object} options.taskSpec - Especificación original de la tarea
 * @param {string} [options.cwd] - Directorio del repositorio (para leer código)
 * @param {Object} [options.sonarReport] - Reporte de análisis SonarQube
 * @returns {Promise<{
 *   success: boolean,
 *   review: {verdict, score, issues[], positives[], summary} | null,
 *   cost: number | null,
 *   duration: number,
 *   error?: string
 * }>}
 */
export async function reviewPR({ prNumber, repo, taskSpec, cwd, sonarReport, model, codingGuidelines }) {
  logger.taskHeader(`REVIEWER - Revisando PR #${prNumber}`);

  const systemPrompt = getReviewerSystemPrompt({
    enableBrowserMcp: config.enableBrowserMcp,
  });

  const criteriaList = (taskSpec.acceptanceCriteria || [])
    .map((c, i) => `${i + 1}. ${c}`)
    .join('\n');

  const browserCheckInstruction = config.enableBrowserMcp
    ? `
5. Si la PR toca código frontend, haz browser validation:
   a. Levanta el dev server con Bash en background
   b. Navega a la app con navigate_page
   c. Revisa consola con list_console_messages buscando errores y excepciones
   d. Compara visualmente con los criterios de aceptación
   e. Toma screenshot con take_screenshot como evidencia
   f. Detén el dev server cuando termines
   g. Incluye los resultados en una sección "Browser Validation" de tu review
6. Registra cada issue en memoria con record_pattern()
7. Envía la review con create_review():
   - APPROVE si score >= 8 y sin issues critical/major
   - REQUEST_CHANGES si hay issues critical/major o score < 8
8. Devuelve el resultado como JSON con: verdict, score, issues, positives, summary`
    : `
5. Registra cada issue en memoria con record_pattern()
6. Envía la review con create_review():
   - APPROVE si score >= 8 y sin issues critical/major
   - REQUEST_CHANGES si hay issues critical/major o score < 8
7. Devuelve el resultado como JSON con: verdict, score, issues, positives, summary`;

  // Build SonarQube section if report is available and successful
  const sonarSection = sonarReport?.success
    ? buildSonarSection(sonarReport)
    : '';

  // Build coding guidelines section if provided
  const guidelinesSection = codingGuidelines
    ? `\n## Project Coding Guidelines (MANDATORY — verify compliance)\n${codingGuidelines}\n`
    : '';

  const userPrompt = `Revisa la Pull Request #${prNumber} del repositorio "${repo}".

## Contexto de la tarea
- **Título**: ${taskSpec.title}
- **User Story**: Como ${taskSpec.userStory?.who || 'usuario'}, quiero ${taskSpec.userStory?.what || taskSpec.title}, para ${taskSpec.userStory?.why || 'mejorar la app'}

## Criterios de aceptación
${criteriaList || 'No especificados'}
${guidelinesSection}${sonarSection}
## Instrucciones
1. Llama a get_review_brief() para ver errores frecuentes del coder
2. Lee el diff completo con get_pr_diff({ repo: "${repo}", prNumber: ${prNumber} })
3. Revisa cada criterio (correctitud, error handling, edge cases, naming, tests, seguridad)
4. Si necesitas más contexto, lee archivos del repo con Read/Glob/Grep${browserCheckInstruction}`;

  const maxTurns = 15;

  const result = await runAgent({
    name: 'REVIEWER',
    systemPrompt,
    userPrompt,
    mcpServerNames: getReviewerMcpServers(),
    cwd,
    maxTurns,
    model,
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
  const verdict = normalizeVerdict(data.verdict, data.score, data.issues, sonarReport);

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
 * - REQUEST_CHANGES si Quality Gate falla con issues BLOCKER
 * - REQUEST_CHANGES en cualquier otro caso que no cumpla el umbral
 */
function normalizeVerdict(rawVerdict, score, issues = [], sonarReport) {
  const hasCritical = issues.some(i => i.severity === 'critical');
  const hasMajor = issues.some(i => i.severity === 'major');

  // Forzar REQUEST_CHANGES si Quality Gate falló con BLOCKERs
  if (sonarReport?.success && sonarReport.qualityGate !== 'OK' && sonarReport.issues?.BLOCKER > 0) {
    return 'REQUEST_CHANGES';
  }

  // Forzar REQUEST_CHANGES si no cumple el umbral
  if (score < 8 || hasCritical || hasMajor) {
    return 'REQUEST_CHANGES';
  }

  // Normalizar variantes (APPROVED, Approved, approve, etc.)
  const normalized = (rawVerdict || '').toUpperCase().trim();
  if (normalized.includes('APPROV')) return 'APPROVED';

  return 'REQUEST_CHANGES';
}
