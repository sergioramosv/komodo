import { runAgent } from './base-agent.js';
import { getReviewerSystemPrompt } from '../prompts/reviewer-system.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { validateAgentResponse } from '../utils/parser.js';
import { buildCoverageSection } from '../coverage/coverage-analyzer.js';
import {
  shouldUseIncrementalReview,
  buildIncrementalContext,
  buildIncrementalPromptSection,
  calculateSavings,
  getHeadSHA,
  getFullDiffTokenEstimate,
} from '../cycle/incremental-review.js';
import { selectReviewDepth, REVIEW_DEPTHS } from '../review/review-depth.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';

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
 * Construye la sección de QA Agent report para el prompt del Reviewer.
 *
 * @param {Object} qaReport - Reporte del QA agent
 * @returns {string} Sección markdown formateada
 */
function buildQASection(qaReport) {
  let section = `
## QA Agent Report

- **Tests generated**: ${qaReport.testsGenerated}
- **Passed**: ${qaReport.testsPassed} | **Failed**: ${qaReport.testsFailed}
- **Files created**: ${(qaReport.filesCreated || []).join(', ') || 'none'}
- **Pushed to branch**: ${qaReport.pushed ? 'yes' : 'no'}`;

  const coderFaults = (qaReport.failedTests || []).filter(t => t.failsCoderCode);
  if (coderFaults.length > 0) {
    section += `

### Tests that fail Coder code (IMPORTANT)
${coderFaults.map(f => `- **${f.name}** (${f.type}): ${f.error}`).join('\n')}

**These failures indicate bugs in the Coder's implementation. Factor them into your review verdict.**`;
  }

  section += `

### Instructions
- Review the QA-generated tests for quality and correctness
- If QA tests reveal bugs in the Coder's code, include them as issues in your review
- Evaluate if the QA tests adequately cover the acceptance criteria
`;

  return section;
}

/**
 * Construye la sección de Security Agent report para el prompt del Reviewer.
 *
 * @param {Object} securityReport - Reporte del Security agent
 * @returns {string} Sección markdown formateada, o cadena vacía si no hay reporte
 */
function buildSecuritySection(securityReport) {
  if (!securityReport) return '';

  const verdictLabel = {
    PASS: '✅ PASS',
    WARN: '⚠️ WARN',
    BLOCK: '🚫 BLOCK',
  }[securityReport.verdict] || securityReport.verdict;

  let section = `
## Security Agent Report

- **Verdict**: ${verdictLabel}
- **Findings**: ${securityReport.criticalCount} CRITICAL, ${securityReport.highCount} HIGH, ${securityReport.mediumCount} MEDIUM, ${securityReport.lowCount} LOW
- **Summary**: ${securityReport.summary}`;

  const notable = (securityReport.findings || []).filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH' || f.severity === 'MEDIUM');
  if (notable.length > 0) {
    section += `

### Findings
| Severity | File | Line | Description |
|----------|------|------|-------------|
${notable.map(f => `| ${f.severity} | ${f.file || '-'} | ${f.line || '-'} | ${f.description} |`).join('\n')}`;
  }

  section += `

### Instructions for Reviewer
- Security findings are pre-analyzed. Focus your review on logic, correctness, and acceptance criteria.
- If verdict is WARN, include the MEDIUM findings in your review and factor them into your score.
- Do not duplicate security analysis already covered above.
`;

  return section;
}

/**
 * Construye la sección de Plugin Issues para el prompt del Reviewer.
 *
 * @param {string[]} issues - Issues reportados por plugins before-review
 * @returns {string} Sección markdown formateada, o cadena vacía si no hay issues
 */
export function buildPluginIssuesSection(issues) {
  if (!issues || issues.length === 0) return '';

  return `
## Plugin Analysis Issues (MANDATORY — must address)

The following issues were detected by automated plugins before this review:
${issues.map(issue => `- ${issue}`).join('\n')}

**You MUST include these issues in your review.** If any are critical or major, your verdict MUST be REQUEST_CHANGES.
`;
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
export async function reviewPR({ prNumber, repo, taskSpec, cwd, sonarReport, coverageReport, qaReport, securityReport, model, codingGuidelines, reviewCycle, previousReview, lastReviewSHA, pluginIssues, knowledgeContext, filesChanged }) {
  const isIncremental = shouldUseIncrementalReview(reviewCycle || 1);

  // Select review depth based on task complexity and security findings
  const depthResult = selectReviewDepth({
    devPoints: taskSpec?.devPoints,
    filesChanged: filesChanged || [],
    sonarReport,
  });

  const selectedDepth = depthResult.depth;
  const depthModel = model || depthResult.model;
  const depthMaxTurns = depthResult.maxTurns;

  eventBus.emitEvent(EVENT_TYPES.REVIEW_DEPTH_SELECTED, {
    agentName: 'REVIEWER',
    metadata: {
      depth: selectedDepth,
      model: depthModel,
      maxTurns: depthMaxTurns,
      estimatedMaxTokens: depthResult.estimatedMaxTokens,
      criteria: depthResult.criteria,
      devPoints: taskSpec?.devPoints,
      filesChangedCount: (filesChanged || []).length,
    },
  });

  logger.info(
    `Review depth: ${selectedDepth.toUpperCase()} (model: ${depthModel}, maxTurns: ${depthMaxTurns}, criteria: ${depthResult.criteria.length})`,
    'REVIEWER',
  );

  const modeLabel = isIncremental ? 'INCREMENTAL' : 'FULL';
  logger.taskHeader(`REVIEWER - Revisando PR #${prNumber} (${modeLabel} / ${selectedDepth.toUpperCase()})`);

  // Capture HEAD SHA before review so next cycle can diff against it
  let currentSHA = null;
  if (cwd) {
    try {
      currentSHA = await getHeadSHA(cwd);
    } catch (err) {
      logger.warn(`Could not get HEAD SHA: ${err.message}`, 'REVIEWER');
    }
  }

  const systemPrompt = getReviewerSystemPrompt({
    enableBrowserMcp: config.enableBrowserMcp,
    depth: selectedDepth,
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

  // Build coverage delta section if report is available
  const coverageSection = buildCoverageSection(coverageReport);

  // Build QA report section if available
  const qaSection = qaReport ? buildQASection(qaReport) : '';

  // Build Security Agent section if available
  const securitySection = securityReport ? buildSecuritySection(securityReport) : '';

  // Build coding guidelines section if provided
  const guidelinesSection = codingGuidelines
    ? `\n## Project Coding Guidelines (MANDATORY — verify compliance)\n${codingGuidelines}\n`
    : '';

  // Build plugin issues section from before-review plugins
  const pluginIssuesSection = buildPluginIssuesSection(pluginIssues);

  // Build incremental review section if in fix cycle
  let incrementalSection = '';
  let incrementalMetrics = null;

  if (isIncremental && previousReview && cwd) {
    try {
      const incrementalContext = await buildIncrementalContext({
        previousReview,
        cwd,
        cycle: reviewCycle,
        lastReviewSHA,
      });

      incrementalSection = buildIncrementalPromptSection(incrementalContext);

      // Detect base branch from remote HEAD (fallback to 'main')
      let baseBranch = 'main';
      try {
        const { execFile } = await import('child_process');
        const { promisify } = await import('util');
        const execFileAsync = promisify(execFile);
        const { stdout } = await execFileAsync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'], { cwd });
        baseBranch = stdout.trim().replace('origin/', '');
      } catch { /* fallback to 'main' */ }

      // Get actual full diff tokens for savings calculation
      const fullDiffTokenEstimate = await getFullDiffTokenEstimate(cwd, baseBranch);
      if (fullDiffTokenEstimate > 0) {
        incrementalMetrics = calculateSavings(fullDiffTokenEstimate, incrementalContext.incrementalDiffTokenEstimate);
        logger.info(
          `Incremental review: ~${incrementalMetrics.tokensSaved} tokens saved (~${incrementalMetrics.percentageSaved}%)`,
          'REVIEWER',
        );
      }
    } catch (err) {
      logger.warn(`Could not build incremental context, falling back to full review: ${err.message}`, 'REVIEWER');
    }
  }

  const diffInstruction = isIncremental && incrementalSection
    ? `2. Lee SOLO el diff del último fix commit (ya incluido abajo). Si necesitas contexto adicional, usa get_pr_diff({ repo: "${repo}", prNumber: ${prNumber} })`
    : `2. Lee el diff completo con get_pr_diff({ repo: "${repo}", prNumber: ${prNumber} })`;

  // Build prior-agent context section from Knowledge Graph (if available)
  const priorAgentSection = knowledgeContext?.reviewerBrief
    ? `\n${knowledgeContext.reviewerBrief}\n`
    : '';

  const userPrompt = `Revisa la Pull Request #${prNumber} del repositorio "${repo}".

## Contexto de la tarea
- **Título**: ${taskSpec.title}
- **User Story**: Como ${taskSpec.userStory?.who || 'usuario'}, quiero ${taskSpec.userStory?.what || taskSpec.title}, para ${taskSpec.userStory?.why || 'mejorar la app'}

## Criterios de aceptación
${criteriaList || 'No especificados'}
${guidelinesSection}${priorAgentSection}${pluginIssuesSection}${sonarSection}${coverageSection}${qaSection}${securitySection}${incrementalSection}
## Instrucciones
1. Llama a get_review_brief() para ver errores frecuentes del coder
${diffInstruction}
3. Revisa cada criterio (correctitud, error handling, edge cases, naming, tests, seguridad)
4. Si necesitas más contexto, lee archivos del repo con Read/Glob/Grep${browserCheckInstruction}`;

  const result = await runAgent({
    name: 'REVIEWER',
    systemPrompt,
    userPrompt,
    mcpServerNames: getReviewerMcpServers(),
    cwd,
    maxTurns: depthMaxTurns,
    model: depthModel,
    totalTimeout: 600_000, // 10 min — reviewer is read-only, should not take longer
    // El Reviewer NO puede modificar código
    disallowedTools: ['Write', 'Edit', 'NotebookEdit'],
  });

  // Log token usage metrics by depth
  if (result.usage) {
    logger.info(
      `[depth:${selectedDepth}] tokens used — input: ${result.usage.input_tokens ?? '?'}, output: ${result.usage.output_tokens ?? '?'}`,
      'REVIEWER',
    );
  }

  // Early termination: reviewer emitted APPROVED in the first 3K chars
  if (result.earlyTerminated && result.earlyTerminationReason === 'reviewer_early_approved') {
    logger.success(
      `PR #${prNumber} EARLY APPROVED — reviewer approved within first chars (tokens saved: ~${result.tokensSavedEstimate})`,
      'REVIEWER'
    );

    // Try to extract a partial JSON verdict from rawResult, otherwise synthesize one
    let earlyReview = null;
    if (result.rawResult) {
      try {
        const { extractJSON } = await import('../utils/parser.js');
        const partial = extractJSON(result.rawResult);
        if (partial?.verdict) {
          earlyReview = partial;
        }
      } catch {
        // ignore parse failure
      }
    }

    if (!earlyReview) {
      earlyReview = {
        verdict: 'APPROVED',
        score: 10,
        issues: [],
        positives: ['Early approval: implementation meets acceptance criteria'],
        summary: 'Early approval: implementation meets acceptance criteria. Score inferred as 10/10.',
      };
    }

    const scoreInferred = earlyReview.score == null;
    const baseSummary = earlyReview.summary || 'Early approval.';
    const summary = scoreInferred && !baseSummary.includes('inferred')
      ? `${baseSummary} (score inferred as 10/10 — early termination before full analysis)`
      : baseSummary;

    return {
      success: true,
      review: {
        verdict: 'APPROVED',
        score: earlyReview.score ?? 10,
        issues: earlyReview.issues || [],
        positives: earlyReview.positives || [],
        summary,
      },
      cost: result.cost,
      duration: result.duration,
      reviewSHA: currentSHA,
      reviewDepth: selectedDepth,
      earlyTerminated: true,
      tokensSavedEstimate: result.tokensSavedEstimate,
    };
  }

  if (!result.success || !result.result) {
    return {
      success: false,
      review: null,
      cost: result.cost,
      duration: result.duration,
      reviewSHA: currentSHA,
      error: result.error || `El Reviewer no devolvió un resultado válido. Raw: ${(result.rawResult || '').slice(0, 300)}`,
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
  const verdict = normalizeVerdict(data.verdict, data.score, data.issues, sonarReport, coverageReport);

  const normalScore = verdict === 'APPROVED' && data.score == null ? 10 : data.score;
  const baseSummaryNormal = data.summary || '';
  const normalSummary = verdict === 'APPROVED' && data.score == null && !baseSummaryNormal.includes('inferred')
    ? `${baseSummaryNormal} (score inferred as 10/10 — LLM returned null score with APPROVED verdict)`.trim()
    : baseSummaryNormal;

  // Log del resultado
  if (verdict === 'APPROVED') {
    logger.success(`PR #${prNumber} APROBADA (score: ${normalScore}/10)`, 'REVIEWER');
  } else {
    const issueCount = (data.issues || []).length;
    logger.warn(`PR #${prNumber} REQUEST_CHANGES (score: ${normalScore}/10, ${issueCount} issues)`, 'REVIEWER');
  }

  if (data.positives?.length) {
    data.positives.forEach(p => logger.info(`  + ${p}`, 'REVIEWER'));
  }

  return {
    success: true,
    review: {
      verdict,
      score: normalScore,
      issues: data.issues || [],
      positives: data.positives || [],
      summary: normalSummary,
    },
    cost: result.cost,
    duration: result.duration,
    incremental: isIncremental,
    incrementalMetrics: incrementalMetrics || null,
    reviewSHA: currentSHA,
    reviewDepth: selectedDepth,
  };
}

/**
 * Normaliza el veredicto asegurando consistencia con las reglas:
 * - APPROVED solo si score >= 8 y 0 issues critical/major
 * - REQUEST_CHANGES si Quality Gate falla con issues BLOCKER
 * - REQUEST_CHANGES en cualquier otro caso que no cumpla el umbral
 */
export function normalizeVerdict(rawVerdict, score, issues = [], sonarReport, coverageReport) {
  const hasCritical = issues.some(i => i.severity === 'critical');
  const hasMajor = issues.some(i => i.severity === 'major');

  // Forzar REQUEST_CHANGES si Quality Gate falló (cualquier severidad)
  if (sonarReport?.success && sonarReport.qualityGate !== 'OK') {
    return 'REQUEST_CHANGES';
  }

  // Forzar REQUEST_CHANGES si coverage baja más del umbral permitido
  if (coverageReport?.success && coverageReport.belowThreshold) {
    return 'REQUEST_CHANGES';
  }

  // Forzar REQUEST_CHANGES si no cumple el umbral
  // score == null covers both null and undefined — null < 8 is true (coerces to 0), but undefined < 8 is false (NaN)
  if (score == null || score < 8 || hasCritical || hasMajor) {
    return 'REQUEST_CHANGES';
  }

  // Normalizar variantes (APPROVED, Approved, approve, etc.)
  const normalized = (rawVerdict || '').toUpperCase().trim();
  if (normalized.includes('APPROV')) return 'APPROVED';

  return 'REQUEST_CHANGES';
}
