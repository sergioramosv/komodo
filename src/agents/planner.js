import { runAgent } from './base-agent.js';
import { getPlannerSystemPrompt } from '../prompts/planner-system.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { validateAgentResponse } from '../utils/parser.js';

/**
 * Ejecuta el agente Planner para elegir la siguiente tarea del backlog.
 *
 * @param {string} projectId - ID del proyecto en planning-task-mcp
 * @returns {Promise<{
 *   success: boolean,
 *   task: {taskId, title, userStory, acceptanceCriteria, branchName, repoUrl, sprintId, devPoints, bizPoints} | null,
 *   cost: number | null,
 *   duration: number,
 *   error?: string
 * }>}
 */
export async function pickNextTask(projectId) {
  logger.taskHeader('PLANNER - Seleccionando siguiente tarea');

  const systemPrompt = getPlannerSystemPrompt({
    projectId,
    defaultUserId: config.defaultUserId,
    defaultUserName: config.defaultUserName,
  });

  const userPrompt = `Analiza el backlog del proyecto "${projectId}" y elige la siguiente tarea a implementar. Cambia su estado a in-progress y devuélveme los detalles en JSON.`;

  const result = await runAgent({
    name: 'PLANNER',
    systemPrompt,
    userPrompt,
    mcpServerNames: ['planning-task-mcp'],
    maxTurns: 15,
  });

  if (!result.success || !result.result) {
    return {
      success: false,
      task: null,
      cost: result.cost,
      duration: result.duration,
      error: result.error || 'El Planner no devolvió un resultado válido',
    };
  }

  const data = result.result;

  // Caso: no hay tareas pendientes
  if (data.taskId === null) {
    logger.info(data.message || 'No hay tareas pendientes', 'PLANNER');
    return {
      success: true,
      task: null,
      cost: result.cost,
      duration: result.duration,
    };
  }

  // Validar que tenga los campos necesarios
  const { valid, missing } = validateAgentResponse(data, ['taskId', 'title', 'branchName']);
  if (!valid) {
    logger.warn(`Respuesta del Planner incompleta. Faltan: ${missing.join(', ')}`, 'PLANNER');
    return {
      success: false,
      task: null,
      cost: result.cost,
      duration: result.duration,
      error: `Campos faltantes: ${missing.join(', ')}`,
    };
  }

  logger.success(`Tarea seleccionada: "${data.title}"`, 'PLANNER');
  logger.info(`Branch: ${data.branchName}`, 'PLANNER');

  return {
    success: true,
    task: {
      taskId: data.taskId,
      title: data.title,
      userStory: data.userStory || {},
      acceptanceCriteria: data.acceptanceCriteria || [],
      branchName: data.branchName,
      repoUrl: data.repoUrl || '',
      sprintId: data.sprintId || '',
      devPoints: data.devPoints || 0,
      bizPoints: data.bizPoints || 0,
    },
    cost: result.cost,
    duration: result.duration,
  };
}
