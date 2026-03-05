import { runAgent } from './base-agent.js';
import { getQASystemPrompt } from '../prompts/qa-system.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { validateAgentResponse } from '../utils/parser.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';

/**
 * Build the MCP server list for the QA agent.
 * Uses github-mcp to push test commits.
 */
function getQAMcpServers() {
  return ['github-mcp'];
}

/**
 * Ejecuta el agente QA para generar y ejecutar tests.
 *
 * Se ejecuta entre Coder y Reviewer. Recibe los archivos cambiados,
 * los acceptance criteria, y genera tests adicionales.
 *
 * @param {Object} options
 * @param {Object} options.taskSpec - Especificación de la tarea
 * @param {string[]} options.filesChanged - Archivos cambiados por el Coder
 * @param {string} options.branchName - Branch de la PR
 * @param {string} options.repo - Repositorio owner/repo
 * @param {number} options.prNumber - Número de la PR
 * @param {string} [options.cwd] - Directorio del repositorio
 * @param {string} [options.model] - Modelo a usar
 * @returns {Promise<{success: boolean, qa: Object|null, cost: number|null, duration: number, error?: string}>}
 */
export async function runQAAgent({ taskSpec, filesChanged, branchName, repo, prNumber, cwd, model }) {
  logger.taskHeader(`QA - Generando tests para: ${taskSpec.title}`);

  const systemPrompt = getQASystemPrompt();

  const testTypes = config.qaTestTypes.join(', ');
  const criteriaList = (taskSpec.acceptanceCriteria || [])
    .map((c, i) => `${i + 1}. ${c}`)
    .join('\n');
  const filesList = (filesChanged || [])
    .map(f => `- ${f}`)
    .join('\n');

  const userPrompt = `Genera y ejecuta tests para la PR #${prNumber} en el repositorio "${repo}".

## Tarea
- **Título**: ${taskSpec.title}
- **ID**: ${taskSpec.taskId}
- **Branch**: ${branchName}

## Criterios de aceptación
${criteriaList || 'No especificados'}

## Archivos cambiados por el Coder
${filesList || 'No especificados'}

## Tipos de tests a generar
${testTypes}

## Instrucciones
1. Lee los archivos cambiados para entender qué se implementó
2. Lee los tests existentes para detectar el framework y convenciones (vitest, jest, etc.)
3. Genera tests para cada criterio de aceptación + edge cases
4. Ejecuta los tests con \`npm test\` o el comando equivalente
5. Si TODOS los tests pasan → commitea con \`test: add QA tests for ${taskSpec.title}\` y haz push al branch "${branchName}"
6. Si algún test falla el código del Coder (no el test en sí) → reporta en failedTests con failsCoderCode: true
7. Si un test está mal escrito y falla por error del test → arréglalo y reintenta

Devuelve el resultado como JSON con: testsGenerated, testsPassed, testsFailed, filesCreated, filesChanged, pushed, failedTests, summary.`;

  const result = await runAgent({
    name: 'QA',
    systemPrompt,
    userPrompt,
    mcpServerNames: getQAMcpServers(),
    cwd,
    maxTurns: 30,
    totalTimeout: 600_000, // 10 min
    model,
  });

  if (!result.success || !result.result) {
    return {
      success: false,
      qa: null,
      cost: result.cost,
      duration: result.duration,
      error: result.error || 'El QA no devolvió un resultado válido',
    };
  }

  const data = result.result;
  const { valid, missing } = validateAgentResponse(data, ['testsGenerated', 'testsPassed']);

  if (!valid) {
    logger.warn(`Respuesta del QA incompleta. Faltan: ${missing.join(', ')}`, 'QA');
    return {
      success: false,
      qa: null,
      cost: result.cost,
      duration: result.duration,
      error: `Campos faltantes: ${missing.join(', ')}`,
    };
  }

  const passed = data.testsPassed || 0;
  const failed = data.testsFailed || 0;
  const total = data.testsGenerated || 0;

  // Emit qa:tests-generated event
  eventBus.emitEvent(EVENT_TYPES.QA_TESTS_GENERATED, {
    agentName: 'QA',
    metadata: {
      count: total,
      passed,
      failed,
      prNumber,
      branchName,
      filesCreated: data.filesCreated || [],
    },
  });

  if (failed > 0) {
    const coderFaults = (data.failedTests || []).filter(t => t.failsCoderCode);
    if (coderFaults.length > 0) {
      logger.warn(`QA: ${coderFaults.length} tests fallan el código del Coder`, 'QA');
    }
    logger.info(`QA: ${passed}/${total} tests pasaron, ${failed} fallaron`, 'QA');
  } else {
    logger.success(`QA: ${total} tests generados y pasados`, 'QA');
  }

  return {
    success: true,
    qa: {
      testsGenerated: total,
      testsPassed: passed,
      testsFailed: failed,
      filesCreated: data.filesCreated || [],
      filesChanged: data.filesChanged || [],
      pushed: data.pushed || false,
      failedTests: data.failedTests || [],
      summary: data.summary || '',
    },
    cost: result.cost,
    duration: result.duration,
  };
}
