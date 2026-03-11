import { runAgent } from './base-agent.js';
import { getPlannerSystemPrompt } from '../prompts/planner-system.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { validateAgentResponse } from '../utils/parser.js';
import { getAll } from '../../skills/planning-task-mcp/src/firebase.js';
import { komodoState } from '../state/komodo-state.js';
import { rankWithContextAffinity, buildAffinityHint } from '../smart-ordering/context-affinity.js';
import { estimateTaskTokens } from '../estimation/token-estimator.js'; // Import estimateTaskTokens

/**
 * Fetches all tasks for a project from Firebase RTDB.
 * @param {string} projectId
 * @returns {Promise<Array<{id: string, status: string, blockedBy?: string[], title: string, priority?: number, devPoints?: number, bizPoints?: number}>>}
 */
export async function fetchProjectTasks(projectId) {
  const allTasks = await getAll('tasks');
  return allTasks.filter(t => t.projectId === projectId);
}

/**
 * Filters to-do tasks by their blockedBy dependencies.
 * A task is "blocked" if its blockedBy[] contains at least one taskId whose status is not "done".
 *
 * @param {Array} todoTasks - Tasks with status "to-do"
 * @param {Array} allTasks  - All project tasks (to resolve blocker statuses)
 * @returns {{ eligible: Array, blocked: Array<{task: object, unresolvedBlockers: Array<{id: string, title: string, status: string}>}> }}
 */
export function filterBlockedTasks(todoTasks, allTasks) {
  const taskMap = new Map(allTasks.map(t => [t.id, t]));

  const eligible = [];
  const blocked = [];

  for (const task of todoTasks) {
    const blockers = Array.isArray(task.blockedBy) ? task.blockedBy : [];

    if (blockers.length === 0) {
      eligible.push(task);
      continue;
    }

    const unresolvedBlockers = [];
    for (const blockerId of blockers) {
      const blocker = taskMap.get(blockerId);
      if (!blocker || blocker.status !== 'done') {
        unresolvedBlockers.push({
          id: blockerId,
          title: blocker?.title || '(unknown)',
          status: blocker?.status || '(not found)',
        });
      }
    }

    if (unresolvedBlockers.length === 0) {
      eligible.push(task);
    } else {
      blocked.push({ task, unresolvedBlockers });
    }
  }

  return { eligible, blocked };
}

/**
 * Ejecuta el agente Planner para elegir la siguiente tarea del backlog.
 *
 * @param {string} projectId - ID del proyecto en planning-task-mcp
 * @returns {Promise<{
 *   success: boolean,
 *   task: {taskId, title, userStory, acceptanceCriteria, branchName, repoUrl, sprintId, devPoints, bizPoints, assignedTo} | null,
 *   cost: number | null,
 *   duration: number,
 *   error?: string
 * }>}
 */
export async function pickNextTask(projectId, { model } = {}) {
  logger.taskHeader('PLANNER - Seleccionando siguiente tarea');

  // ── Step 1: Check for in-progress tasks FIRST (priority resume) ──
  let eligibleTasks = [];
  let inProgressTasks = [];
  let affinityHint = '';

  try {
    const allTasks = await fetchProjectTasks(projectId);

    // Priority: in-progress tasks should be completed before picking new ones
    inProgressTasks = allTasks.filter(t => t.status === 'in-progress');
    if (inProgressTasks.length > 0) {
      logger.info(`Found ${inProgressTasks.length} in-progress task(s) — prioritizing these`, 'PLANNER');
      eligibleTasks = inProgressTasks;
    } else {
      // No in-progress tasks, fall back to to-do
      const todoTasks = allTasks.filter(t => t.status === 'to-do');

      if (todoTasks.length === 0) {
        logger.info('No hay tareas to-do en el backlog', 'PLANNER');
        return { success: true, task: null, cost: null, duration: 0 };
      }

      const { eligible, blocked } = filterBlockedTasks(todoTasks, allTasks);

      if (eligible.length === 0 && blocked.length > 0) {
        const blockedInfo = blocked.map(({ task, unresolvedBlockers }) => {
          const blockerList = unresolvedBlockers
            .map(b => `"${b.title}" (status: ${b.status})`)
            .join(', ');
          return `- "${task.title}" (${task.id}) blocked by: ${blockerList}`;
        }).join('\n');

        const message = `All to-do tasks are blocked by unfinished dependencies:\n${blockedInfo}`;
        logger.info(message, 'PLANNER');
        return { success: true, task: null, cost: null, duration: 0 };
      }

      if (blocked.length > 0) {
        logger.info(`Filtered out ${blocked.length} blocked task(s), ${eligible.length} eligible`, 'PLANNER');
      }

      eligibleTasks = eligible;

      // ── Step 1b: Context affinity boost ──
      const previousContext = komodoState.lastCompletedTaskContext;
      if (previousContext && previousContext.filesChanged?.length > 0) {
        eligibleTasks = rankWithContextAffinity(eligibleTasks, previousContext);
        affinityHint = buildAffinityHint(eligibleTasks);
      }

      // ── Step 1c: Calculate efficiency (bizPoints / estimatedTokens) ──
      for (const task of eligibleTasks) {
        const estimatedTokens = estimateTaskTokens(task).total;
        task.estimatedTokens = estimatedTokens;
        task.efficiency = task.bizPoints && estimatedTokens > 0 ? task.bizPoints / estimatedTokens : 0;
      }

      // Sort by efficiency (descending)
      eligibleTasks.sort((a, b) => b.efficiency - a.efficiency);
    }
  } catch (err) {
    logger.warn(`Could not pre-filter blocked tasks or calculate efficiency: ${err.message}. Proceeding without full prioritization.`, 'PLANNER');
    // Fallback to just using the available eligible tasks without advanced sorting
    const allTasks = await fetchProjectTasks(projectId);
    eligibleTasks = allTasks.filter(t => t.status === 'to-do'); // or in-progress if any
  }

  // ── Step 2: Run the Planner agent with eligible task context ──
  const systemPrompt = getPlannerSystemPrompt({
    projectId,
    defaultUserId: config.defaultUserId,
    defaultUserName: config.defaultUserName,
  });

  let userPrompt = '';
  if (inProgressTasks.length > 0) {
    userPrompt = `Hay ${inProgressTasks.length} tarea(s) IN-PROGRESS que deben completarse primero. Selecciona una de ellas (ya está en in-progress, NO cambies su estado). Prioriza la de mayor eficiencia (bizPoints/estimatedTokens). Devuélveme los detalles en JSON.
    \n\nAquí están las tareas elegibles, ordenadas por eficiencia (mayor primero):\n${eligibleTasks.map(t => `- ID: ${t.id}, Título: "${t.title}", Puntos de Negocio: ${t.bizPoints}, Puntos de Desarrollo: ${t.devPoints}, Tokens Estimados: ${t.estimatedTokens}, Eficiencia (Biz/Tokens): ${t.efficiency.toFixed(5)}`).join('\n')}`;
  } else if (eligibleTasks.length > 0) {
    userPrompt = `Analiza el backlog del proyecto "${projectId}" y elige la siguiente tarea a implementar. Prioriza la de mayor eficiencia (bizPoints/estimatedTokens). Cambia su estado a in-progress y devuélveme los detalles en JSON.
    \n\nAquí están las tareas elegibles, ordenadas por eficiencia (mayor primero):\n${eligibleTasks.map(t => `- ID: ${t.id}, Título: "${t.title}", Puntos de Negocio: ${t.bizPoints}, Puntos de Desarrollo: ${t.devPoints}, Tokens Estimados: ${t.estimatedTokens}, Eficiencia (Biz/Tokens): ${t.efficiency.toFixed(5)}`).join('\n')}`;
  } else {
    logger.info('No hay tareas pendientes en el backlog.', 'PLANNER');
    return { success: true, task: null, cost: null, duration: 0 };
  }

  if (affinityHint) {
    userPrompt += `\n\n${affinityHint}`;
  }

  const result = await runAgent({
    name: 'PLANNER',
    systemPrompt,
    userPrompt,
    mcpServerNames: ['planning-task-mcp'],
    maxTurns: 15,
    model,
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
      assignedTo: data.assignedTo || null,
    },
    cost: result.cost,
    duration: result.duration,
  };
}
