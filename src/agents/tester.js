import { runAgent } from './base-agent.js';
import { getTesterSystemPrompt } from '../prompts/tester-system.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { validateAgentResponse } from '../utils/parser.js';
import { eventBus, EVENT_TYPES, AGENT_STATES } from '../events/event-bus.js';
import { buildTesterContext } from '../knowledge/knowledge-graph.js';

/**
 * Build the MCP server list for the Tester agent.
 * Uses github-mcp to push test commits.
 */
function getTesterMcpServers() {
  return ['github-mcp'];
}

/**
 * Ejecuta el agente Tester para generar tests quirúrgicos basados en el Knowledge Graph.
 *
 * Se ejecuta entre Coder y Reviewer. Lee el plan del Architect y las decisiones
 * del Coder desde el Knowledge Graph para generar tests que cubran exactamente
 * lo implementado.
 *
 * @param {Object} options
 * @param {Object} options.taskSpec - Especificación de la tarea
 * @param {string[]} options.filesChanged - Archivos cambiados por el Coder
 * @param {string} options.branchName - Branch de la PR
 * @param {string} options.repo - Repositorio owner/repo
 * @param {number} options.prNumber - Número de la PR
 * @param {string} options.projectId - ID del proyecto para el Knowledge Graph
 * @param {string} [options.cwd] - Directorio del repositorio
 * @param {string} [options.model] - Modelo a usar
 * @returns {Promise<{success: boolean, tester: Object|null, cost: number|null, duration: number, error?: string}>}
 */
export async function runTesterAgent({ taskSpec, filesChanged, branchName, repo, prNumber, projectId, cwd, model, signal }) {
  logger.taskHeader(`TESTER - Generando tests quirúrgicos para: ${taskSpec.title}`);

  eventBus.emitEvent(EVENT_TYPES.AGENT_STATE_CHANGE, {
    agentName: 'TESTER',
    previousState: AGENT_STATES.IDLE,
    newState: AGENT_STATES.WORKING,
    metadata: { phase: 'testing', taskId: taskSpec.taskId, taskTitle: taskSpec.title },
  });

  const systemPrompt = getTesterSystemPrompt();

  const criteriaList = (taskSpec.acceptanceCriteria || [])
    .map((c, i) => `${i + 1}. ${c}`)
    .join('\n');
  const filesList = (filesChanged || [])
    .map(f => `- ${f}`)
    .join('\n');

  // Load Knowledge Graph context for surgical test generation
  const kgContext = projectId
    ? buildTesterContext(projectId, taskSpec.taskId, taskSpec.acceptanceCriteria || [])
    : null;

  const kgSection = kgContext?.testerBrief
    ? `\n## Knowledge Graph Context\n${kgContext.testerBrief}`
    : '';

  const userPrompt = `Genera y ejecuta tests quirúrgicos para la PR #${prNumber} en el repositorio "${repo}".

## Tarea
- **Título**: ${taskSpec.title}
- **ID**: ${taskSpec.taskId}
- **Branch**: ${branchName}

## Criterios de aceptación
${criteriaList || 'No especificados'}

## Archivos cambiados por el Coder
${filesList || 'No especificados'}
${kgSection}

## Instrucciones
1. Lee el Knowledge Graph Context para entender el plan del Architect y decisiones del Coder
2. Lee los archivos cambiados para entender la implementación concreta
3. Detecta el framework de tests del proyecto (vitest, jest, etc.)
4. Genera tests quirúrgicos que cubran: cada acceptance criteria, happy path, error path, edge cases de los risks, regression si toca código existente
5. Ejecuta los tests con \`npm test\` o el comando equivalente
6. Si TODOS los tests pasan → commitea con \`test: add Tester tests for ${taskSpec.title}\` y haz push al branch "${branchName}"
7. Si algún test falla el código del Coder (no el test en sí) → reporta en failedTests con failsCoderCode: true
8. Si un test está mal escrito y falla por error del test → arréglalo y reintenta

Devuelve el resultado como JSON con: testsGenerated, testsPassed, testsFailed, coverage, filesCreated, filesChanged, pushed, failedTests, summary.`;

  const resolvedModel = model || config.forceModel_TESTER || undefined;

  const result = await runAgent({
    name: 'TESTER',
    systemPrompt,
    userPrompt,
    mcpServerNames: getTesterMcpServers(),
    cwd,
    maxTurns: 30,
    totalTimeout: 600_000, // 10 min
    model: resolvedModel,
    signal,
  });

  if (!result.success || !result.result) {
    eventBus.emitEvent(EVENT_TYPES.AGENT_STATE_CHANGE, {
      agentName: 'TESTER',
      previousState: AGENT_STATES.WORKING,
      newState: AGENT_STATES.IDLE,
      metadata: { phase: 'idle' },
    });
    return {
      success: false,
      tester: null,
      cost: result.cost,
      duration: result.duration,
      error: result.error || 'El Tester no devolvió un resultado válido',
    };
  }

  const data = result.result;
  const { valid, missing } = validateAgentResponse(data, ['testsGenerated', 'testsPassed']);

  if (!valid) {
    logger.warn(`Respuesta del Tester incompleta. Faltan: ${missing.join(', ')}`, 'TESTER');
    eventBus.emitEvent(EVENT_TYPES.AGENT_STATE_CHANGE, {
      agentName: 'TESTER',
      previousState: AGENT_STATES.WORKING,
      newState: AGENT_STATES.IDLE,
      metadata: { phase: 'idle' },
    });
    return {
      success: false,
      tester: null,
      cost: result.cost,
      duration: result.duration,
      error: `Campos faltantes: ${missing.join(', ')}`,
    };
  }

  const passed = data.testsPassed || 0;
  const failed = data.testsFailed || 0;
  const total = data.testsGenerated || 0;

  // Emit tester:tests-generated event
  eventBus.emitEvent(EVENT_TYPES.TESTER_TESTS_GENERATED, {
    agentName: 'TESTER',
    metadata: {
      count: total,
      passed,
      failed,
      coverage: data.coverage || null,
      prNumber,
      branchName,
      filesCreated: data.filesCreated || [],
    },
  });

  if (failed > 0) {
    const coderFaults = (data.failedTests || []).filter(t => t.failsCoderCode);
    if (coderFaults.length > 0) {
      logger.warn(`TESTER: ${coderFaults.length} tests fallan el código del Coder`, 'TESTER');
    }
    logger.info(`TESTER: ${passed}/${total} tests pasaron, ${failed} fallaron`, 'TESTER');
  } else {
    logger.success(`TESTER: ${total} tests quirúrgicos generados y pasados`, 'TESTER');
  }

  eventBus.emitEvent(EVENT_TYPES.AGENT_STATE_CHANGE, {
    agentName: 'TESTER',
    previousState: AGENT_STATES.WORKING,
    newState: AGENT_STATES.IDLE,
    metadata: { phase: 'idle' },
  });

  return {
    success: true,
    tester: {
      testsGenerated: total,
      testsPassed: passed,
      testsFailed: failed,
      coverage: data.coverage || null,
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
