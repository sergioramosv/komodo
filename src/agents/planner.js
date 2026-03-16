import { runAgent } from './base-agent.js';
import { getPlannerSystemPrompt } from '../prompts/planner-system.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { validateAgentResponse } from '../utils/parser.js';
import { getAll } from '../../skills/planning-task-mcp/src/firebase.js';
import { komodoState } from '../state/komodo-state.js';
import { rankWithContextAffinity, buildAffinityHint } from '../smart-ordering/context-affinity.js';
import { estimateTaskTokens } from '../estimation/token-estimator.js';
import { getUnresolvedPreviousParts } from './multi-part-filter.js';
import { classifyAndEmit } from '../triage/complexity-classifier.js';

/**
 * Fetches sprints for a project, sorted by startDate ASC (earliest first).
 * Used to enforce sprint ordering: tasks from earlier sprints are prioritized.
 */
async function fetchSprintOrder(projectId) {
  const allSprints = await getAll('sprints');
  return allSprints
    .filter(s => s.projectId === projectId && (s.status === 'active' || s.status === 'planned') && s.startDate)
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
    .map((s, index) => ({ id: s.id, name: s.name, order: index, startDate: s.startDate }));
}

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

    // Check implicit multi-part ordering (e.g. "Task (2/4)" needs "Task (1/4)" done first)
    const multiPartBlockers = getUnresolvedPreviousParts(task, allTasks);

    if (blockers.length === 0 && multiPartBlockers.length === 0) {
      eligible.push(task);
      continue;
    }

    const unresolvedBlockers = [...multiPartBlockers];
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

  // ── Step 1: Fetch and filter tasks ──
  const allTasks = await fetchProjectTasks(projectId);
  let eligibleTasks = [];
  let affinityHint = '';

  // Priority: in-progress tasks should be completed before picking new ones
  const inProgressTasks = allTasks.filter(t => t.status === 'in-progress');
  if (inProgressTasks.length > 0) {
    logger.info(`Found ${inProgressTasks.length} in-progress task(s) — prioritizing these`, 'PLANNER');
    // For in-progress tasks, we only care about their IDs for the prompt,
    // as the Planner should just re-select one of them.
    eligibleTasks = inProgressTasks.map(task => ({
      ...task,
      estimatedTokens: 0, // Not relevant for in-progress re-selection
      efficiency: 0,
    }));
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

    // ── Step 1b: Fetch sprint order for sprint-first sorting ──
    const sprintOrder = await fetchSprintOrder(projectId);
    const sprintOrderMap = new Map(sprintOrder.map(s => [s.id, s.order]));

    // Calculate estimated tokens and efficiency for eligible tasks
    eligibleTasks = eligible.map(task => {
      const classification = classifyAndEmit(task);
      const complexityLevel = classification.level;
      const estimatedTokens = estimateTaskTokens(task, complexityLevel).total;
      const efficiency = task.bizPoints > 0 ? (task.bizPoints / estimatedTokens) : 0;
      const sprintIdx = sprintOrderMap.has(task.sprintId) ? sprintOrderMap.get(task.sprintId) : 9999;
      return { ...task, estimatedTokens, efficiency, complexityLevel, sprintOrder: sprintIdx };
    });

    // ── Step 1c: Context affinity boost ──
    const previousContext = komodoState.lastCompletedTaskContext;
    if (previousContext && previousContext.filesChanged?.length > 0) {
      const ranked = rankWithContextAffinity(eligibleTasks, previousContext);
      affinityHint = buildAffinityHint(ranked);
    }
  }

  // Sort eligible tasks: first by sprint order ASC, then by efficiency DESC within same sprint
  eligibleTasks.sort((a, b) => {
    const sprintDiff = (a.sprintOrder ?? 9999) - (b.sprintOrder ?? 9999);
    if (sprintDiff !== 0) return sprintDiff;
    return b.efficiency - a.efficiency;
  });

  // ── Step 2: Run the Planner agent with eligible task context ──
  const systemPrompt = getPlannerSystemPrompt({
    projectId,
    defaultUserId: config.defaultUserId,
    defaultUserName: config.defaultUserName,
  });

  let userPrompt = '';
  if (inProgressTasks.length > 0) {
    userPrompt = `Hay ${inProgressTasks.length} tarea(s) IN-PROGRESS que deben completarse primero. Selecciona una de ellas (ya está en in-progress, NO cambies su estado). Devuélveme los detalles en JSON.

Tareas IN-PROGRESS:
${inProgressTasks.map(t => `- ID: ${t.id}, Título: "${t.title}"`).join('\n')}`;
  } else {
    userPrompt = `Analiza el backlog del proyecto "${projectId}" y elige la siguiente tarea a implementar. Cambia su estado a in-progress y devuélveme los detalles en JSON.

REGLA PRINCIPAL: Siempre elige tareas del sprint con startDate más temprana primero. Solo pasa al siguiente sprint cuando el sprint anterior no tenga tareas to-do elegibles.
Dentro del mismo sprint, prioriza por eficiencia (bizPoints / estimatedTokens).

Las tareas ya están ordenadas: primero por sprint (más antiguo primero), luego por eficiencia decreciente. ELIGE LA PRIMERA TAREA DE LA LISTA.

Tareas elegibles (ordenadas por sprint → eficiencia):
${eligibleTasks.map(t => `- ID: ${t.id}, Sprint: "${t.sprintId}", Título: "${t.title}", BizPoints: ${t.bizPoints}, DevPoints: ${t.devPoints}, EstimatedTokens: ${t.estimatedTokens}, Eficiencia: ${t.efficiency.toFixed(3)}, Complejidad: ${t.complexityLevel}`).join('\n')}`;
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
