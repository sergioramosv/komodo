import { runAgent } from './base-agent.js';
import { getSecuritySystemPrompt } from '../prompts/security-system.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { validateAgentResponse } from '../utils/parser.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { runAllExternalTools } from '../security/external-tools.js';

/**
 * Ejecuta el agente de seguridad para escanear el código de una PR.
 *
 * Analiza los archivos cambiados en busca de vulnerabilidades OWASP Top 10,
 * secrets hardcodeados, dependencias inseguras y otros problemas de seguridad.
 *
 * @param {Object} options
 * @param {Object} options.taskSpec - Especificación de la tarea
 * @param {string[]} options.filesChanged - Archivos cambiados por el Coder
 * @param {string} options.branchName - Branch de la PR
 * @param {string} options.repo - Repositorio owner/repo
 * @param {number} options.prNumber - Número de la PR
 * @param {string} [options.cwd] - Directorio del repositorio
 * @param {string} [options.model] - Modelo a usar (default: config.forceModel_SECURITY)
 * @returns {Promise<{success: boolean, security: Object|null, cost: number|null, duration: number, error?: string}>}
 */
export async function runSecurityAgent({ taskSpec, filesChanged, branchName, repo, prNumber, cwd, model }) {
  logger.taskHeader(`SECURITY - Escaneando PR #${prNumber}: ${taskSpec.title}`);

  eventBus.emitEvent(EVENT_TYPES.SECURITY_SCAN_START, {
    agentName: 'SECURITY',
    metadata: { prNumber, branchName, filesChanged },
  });

  const systemPrompt = getSecuritySystemPrompt();

  const filesList = (filesChanged || [])
    .map(f => `- ${f}`)
    .join('\n');

  // Run external tools before LLM analysis to include their findings as context
  const externalTools = await runAllExternalTools({ cwd });
  const externalFindingsCount = externalTools.findings.length;
  const externalFindingsSummary = externalFindingsCount > 0
    ? externalTools.findings
      .map(f => `- [${f.severity}] ${f.description}${f.file ? ` (${f.file}${f.line ? `:${f.line}` : ''})` : ''}`)
      .join('\n')
    : 'Ningún finding de herramientas externas.';

  const userPrompt = `Escanea el código de la PR #${prNumber} en el repositorio "${repo}" en busca de vulnerabilidades de seguridad.

## Tarea
- **Título**: ${taskSpec.title}
- **ID**: ${taskSpec.taskId}
- **Branch**: ${branchName}

## Archivos cambiados
${filesList || 'No especificados'}

## Findings de herramientas externas (npm audit, gitleaks, semgrep)
Los siguientes findings fueron detectados automáticamente por herramientas estáticas. Tenlos en cuenta en tu análisis pero no los dupliques si ya los cubre tu revisión del código:

${externalFindingsSummary}

## Instrucciones
1. Lee cada archivo cambiado con las herramientas disponibles
2. Analiza el código siguiendo las categorías OWASP Top 10 y los checks adicionales del system prompt
3. Para cada vulnerabilidad encontrada, incluye severidad, categoría, descripción clara, archivo y línea
4. Incorpora los findings de herramientas externas al análisis si son relevantes
5. Determina el verdict según las reglas: BLOCK (CRITICAL o 1+ HIGH), WARN (MEDIUM sin CRITICAL/HIGH), PASS (solo LOW o ninguno)
6. Devuelve ÚNICAMENTE el JSON con: verdict, findings, summary`;

  const result = await runAgent({
    name: 'SECURITY',
    systemPrompt,
    userPrompt,
    cwd,
    maxTurns: 20,
    totalTimeout: 300_000, // 5 min — scans are lighter than coding tasks
    model: model || config.forceModel_SECURITY,
  });

  if (!result.success || !result.result) {
    return {
      success: false,
      security: null,
      cost: result.cost,
      duration: result.duration,
      error: result.error || 'El agente de seguridad no devolvió un resultado válido',
    };
  }

  const data = result.result;
  const { valid, missing } = validateAgentResponse(data, ['verdict', 'findings', 'summary']);

  if (!valid) {
    logger.warn(`Respuesta del Security agent incompleta. Faltan: ${missing.join(', ')}`, 'SECURITY');
    return {
      success: false,
      security: null,
      cost: result.cost,
      duration: result.duration,
      error: `Campos faltantes: ${missing.join(', ')}`,
    };
  }

  const findings = data.findings || [];
  const criticalCount = findings.filter(f => f.severity === 'CRITICAL').length;
  const highCount = findings.filter(f => f.severity === 'HIGH').length;
  const mediumCount = findings.filter(f => f.severity === 'MEDIUM').length;
  const lowCount = findings.filter(f => f.severity === 'LOW').length;

  // Re-derive verdict in code to prevent LLM hallucination bypass
  const computedVerdict = (criticalCount > 0 || highCount >= 1) ? 'BLOCK'
    : (mediumCount > 0) ? 'WARN'
    : 'PASS';

  if (data.verdict !== computedVerdict) {
    logger.warn(
      `Verdict mismatch: LLM said "${data.verdict}" but findings indicate "${computedVerdict}". Using computed verdict.`,
      'SECURITY'
    );
  }

  const verdict = computedVerdict;

  eventBus.emitEvent(EVENT_TYPES.SECURITY_SCAN_COMPLETE, {
    agentName: 'SECURITY',
    metadata: {
      verdict,
      findingsCount: findings.length,
      criticalCount,
      highCount,
      mediumCount,
      lowCount,
      prNumber,
      branchName,
    },
  });

  if (verdict === 'BLOCK') {
    eventBus.emitEvent(EVENT_TYPES.SECURITY_SCAN_BLOCKED, {
      agentName: 'SECURITY',
      metadata: {
        prNumber,
        branchName,
        criticalCount,
        highCount,
        findings: findings.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH'),
      },
    });
    logger.warn(
      `SECURITY BLOCK: ${criticalCount} CRITICAL, ${highCount} HIGH findings en PR #${prNumber}`,
      'SECURITY'
    );
  } else if (verdict === 'WARN') {
    logger.warn(
      `SECURITY WARN: ${mediumCount} MEDIUM findings en PR #${prNumber}`,
      'SECURITY'
    );
  } else {
    logger.success(`SECURITY PASS: PR #${prNumber} sin vulnerabilidades críticas`, 'SECURITY');
  }

  return {
    success: true,
    security: {
      verdict,
      findings,
      summary: data.summary || '',
      criticalCount,
      highCount,
      mediumCount,
      lowCount,
    },
    toolResults: externalTools.toolResults,
    cost: result.cost,
    duration: result.duration,
  };
}
