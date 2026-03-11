import { runAgent } from './base-agent.js';
import { getArchitectSystemPrompt } from '../prompts/architect-system.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { validateAgentResponse } from '../utils/parser.js';

/**
 * Ejecuta el agente Architect para analizar el codebase y generar un plan de implementación.
 *
 * El Architect analiza los archivos relevantes para la tarea y genera un plan estructurado
 * que el Coder usará directamente, sin necesidad de explorar el codebase por su cuenta.
 *
 * @param {Object} taskSpec - Especificación de la tarea (viene del Planner)
 * @param {string} taskSpec.taskId
 * @param {string} taskSpec.title
 * @param {Object} taskSpec.userStory - { who, what, why }
 * @param {string[]} taskSpec.acceptanceCriteria
 * @param {string} taskSpec.branchName
 * @param {string} taskSpec.repoUrl
 * @param {string} [cwd] - Directorio del repositorio a analizar
 * @param {Object} [options]
 * @param {string} [options.model] - Modelo a usar
 * @returns {Promise<{success: boolean, plan: Object|null, cost: number|null, duration: number, error?: string}>}
 */
export async function analyzeTask(taskSpec, cwd, { model } = {}) {
  logger.taskHeader(`ARCHITECT - Analizando: ${taskSpec.title}`);

  const systemPrompt = getArchitectSystemPrompt();

  const userPrompt = `Analiza el codebase y genera un plan de implementación para la siguiente tarea:

## Tarea
- **ID**: ${taskSpec.taskId}
- **Título**: ${taskSpec.title}

## User Story
- **Como** ${taskSpec.userStory?.who || 'usuario'}
- **Quiero** ${taskSpec.userStory?.what || taskSpec.title}
- **Para** ${taskSpec.userStory?.why || 'mejorar la aplicación'}

## Criterios de aceptación
${(taskSpec.acceptanceCriteria || []).map((c, i) => `${i + 1}. ${c}`).join('\n')}

## Instrucciones
1. Lee los archivos del proyecto relevantes para esta tarea
2. Identifica exactamente qué archivos crear y cuáles modificar
3. Determina el orden de implementación
4. Detecta riesgos o dependencias importantes
5. Devuelve el plan como JSON

El Coder recibirá tu plan y lo implementará directamente sin explorar el codebase.

Devuelve el resultado como JSON con: filesToCreate, filesToModify, dependencies, dataModelChanges, apiChanges, implementationOrder, risks, estimatedComplexity.`;

  const result = await runAgent({
    name: 'ARCHITECT',
    systemPrompt,
    userPrompt,
    mcpServerNames: [], // Architect only reads the local codebase, no MCPs needed
    cwd,
    maxTurns: 20,
    idleTimeout: 300_000, // 5 min idle timeout (read-only, fast)
    model,
  });

  if (!result.success || !result.result) {
    return {
      success: false,
      plan: null,
      cost: result.cost,
      duration: result.duration,
      error: result.error || 'El Architect no devolvió un resultado válido',
    };
  }

  const data = result.result;
  const { valid, missing } = validateAgentResponse(data, ['filesToCreate', 'filesToModify', 'implementationOrder']);

  if (!valid) {
    logger.warn(`Respuesta del Architect incompleta. Faltan: ${missing.join(', ')}`, 'ARCHITECT');
    return {
      success: false,
      plan: null,
      cost: result.cost,
      duration: result.duration,
      error: `Campos faltantes: ${missing.join(', ')}`,
    };
  }

  logger.success(
    `Plan generado: ${data.filesToCreate?.length || 0} archivos a crear, ${data.filesToModify?.length || 0} a modificar`,
    'ARCHITECT',
  );

  return {
    success: true,
    plan: {
      filesToCreate: data.filesToCreate || [],
      filesToModify: data.filesToModify || [],
      dependencies: data.dependencies || [],
      dataModelChanges: data.dataModelChanges || 'None',
      apiChanges: data.apiChanges || 'None',
      implementationOrder: data.implementationOrder || [],
      risks: data.risks || [],
      estimatedComplexity: data.estimatedComplexity || 'medium',
    },
    cost: result.cost,
    duration: result.duration,
  };
}
