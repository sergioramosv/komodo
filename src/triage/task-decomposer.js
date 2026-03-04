import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { runAgent } from '../agents/base-agent.js';

const DECOMPOSITION_AC_THRESHOLD = 6;
const DECOMPOSITION_STORY_CHAR_THRESHOLD = 500;
const MIN_SUBTASKS = 2;
const MAX_SUBTASKS = 5;

/**
 * Determines whether a task should be decomposed into subtasks.
 *
 * A task is a candidate for decomposition when ANY of:
 * - devPoints >= threshold (default 8)
 * - More than 6 acceptance criteria
 * - User story is very broad (>500 chars combined)
 *
 * A task is NEVER decomposed if:
 * - It already has a parentTaskId (is a subtask — avoids infinite recursion)
 * - TASK_DECOMPOSITION is disabled via .env
 * - It is already marked as decomposed
 *
 * @param {Object} task
 * @returns {{ shouldDecompose: boolean, reasons: string[] }}
 */
export function shouldDecompose(task) {
  if (!config.taskDecomposition) {
    return { shouldDecompose: false, reasons: ['TASK_DECOMPOSITION disabled'] };
  }

  if (task.parentTaskId) {
    return { shouldDecompose: false, reasons: ['Task is already a subtask'] };
  }

  if (task.decomposed) {
    return { shouldDecompose: false, reasons: ['Task already decomposed'] };
  }

  const reasons = [];
  const threshold = config.decompositionThresholdDevpoints;

  if (task.devPoints && task.devPoints >= threshold) {
    reasons.push(`devPoints=${task.devPoints} >= threshold=${threshold}`);
  }

  const acCount = getACCount(task.acceptanceCriteria);
  if (acCount > DECOMPOSITION_AC_THRESHOLD) {
    reasons.push(`acceptanceCriteria=${acCount} > ${DECOMPOSITION_AC_THRESHOLD}`);
  }

  const storyLen = getStoryLength(task.userStory);
  if (storyLen > DECOMPOSITION_STORY_CHAR_THRESHOLD) {
    reasons.push(`userStoryLength=${storyLen} > ${DECOMPOSITION_STORY_CHAR_THRESHOLD}`);
  }

  return { shouldDecompose: reasons.length > 0, reasons };
}

/**
 * Decomposes a large task into subtasks by using an AI agent to generate
 * a decomposition plan, then creating the subtasks via planning-task-mcp.
 *
 * @param {Object} task - The parent task to decompose
 * @param {string} projectId - The project ID
 * @returns {Promise<{ success: boolean, subtaskIds?: string[], error?: string }>}
 */
export async function decomposeTask(task, projectId) {
  const parentDevPoints = task.devPoints || 5;
  const parentBizPoints = task.bizPoints || 3;

  logger.info(`Decomposing task "${task.title}" (devPoints=${parentDevPoints})...`, 'KOMODO');

  const systemPrompt = buildDecompositionPrompt(task, projectId, parentDevPoints, parentBizPoints);

  const userPrompt = `Descompone la tarea "${task.title}" (ID: ${task.taskId}) en subtareas más pequeñas.

La tarea tiene ${parentDevPoints} devPoints y ${getACCount(task.acceptanceCriteria)} criterios de aceptación.

Genera entre ${MIN_SUBTASKS} y ${MAX_SUBTASKS} subtareas. Los devPoints de las subtareas deben sumar aproximadamente ${parentDevPoints}.

Luego:
1. Crea cada subtarea con create_task (projectId="${projectId}")
2. Para cada subtarea, usa update_task para añadir parentTaskId="${task.taskId}" y blockedBy con el ID de la subtarea anterior (excepto la primera)
3. Después de crear todas las subtareas, usa update_task en la tarea padre "${task.taskId}" para marcarla con decomposed=true y status="done"
4. Responde con el JSON indicado en el system prompt`;

  const result = await runAgent({
    name: 'PLANNER',
    systemPrompt,
    userPrompt,
    mcpServerNames: ['planning-task-mcp'],
    maxTurns: 25,
  });

  if (!result.success || !result.result) {
    logger.error(`Decomposition failed: ${result.error || 'No result'}`, 'KOMODO');
    return { success: false, error: result.error || 'Agent did not return a result' };
  }

  const data = result.result;

  if (!data.subtaskIds || !Array.isArray(data.subtaskIds) || data.subtaskIds.length < MIN_SUBTASKS) {
    logger.warn('Agent returned insufficient subtasks', 'KOMODO');
    return { success: false, error: 'Decomposition produced insufficient subtasks' };
  }

  logger.success(`Task decomposed into ${data.subtaskIds.length} subtasks: ${data.subtaskIds.join(', ')}`, 'KOMODO');

  eventBus.emitEvent(EVENT_TYPES.TASK_DECOMPOSED, {
    metadata: {
      parentTaskId: task.taskId,
      parentTitle: task.title,
      subtaskIds: data.subtaskIds,
      subtaskCount: data.subtaskIds.length,
    },
  });

  return { success: true, subtaskIds: data.subtaskIds };
}

/**
 * Builds the system prompt for the decomposition agent.
 * @private
 */
function buildDecompositionPrompt(task, projectId, parentDevPoints, parentBizPoints) {
  const acList = Array.isArray(task.acceptanceCriteria)
    ? task.acceptanceCriteria.map((ac, i) => `${i + 1}. ${ac}`).join('\n')
    : '';

  const storyText = task.userStory
    ? `Como ${task.userStory.who || '?'}, quiero ${task.userStory.what || '?'}, para ${task.userStory.why || '?'}`
    : '';

  return `Eres el PLANNER de Komodo. Tu tarea es DESCOMPONER una tarea grande en subtareas más pequeñas.

## Tarea padre
- ID: ${task.taskId}
- Título: ${task.title}
- devPoints: ${parentDevPoints}
- bizPoints: ${parentBizPoints}
- User Story: ${storyText}
- Criterios de aceptación:
${acList}

## Reglas de descomposición
1. Genera entre ${MIN_SUBTASKS} y ${MAX_SUBTASKS} subtareas
2. Cada subtarea debe tener devPoints en Fibonacci (1, 2, 3, 5) — máximo 5 por subtarea
3. La SUMA de devPoints de las subtareas debe ser aproximadamente ${parentDevPoints} (±1 punto)
4. Cada subtarea debe tener bizPoints proporcionales (total ≈ ${parentBizPoints})
5. Los criterios de aceptación de la tarea padre deben distribuirse entre las subtareas
6. Cada subtarea necesita al menos 1 criterio de aceptación y 1 test
7. Las subtareas deben tener bloqueo SECUENCIAL: la 2a espera a la 1a, la 3a espera a la 2a, etc.
8. El título de cada subtarea debe tener el formato: "[Parte N/${MAX_SUBTASKS}] descripción"

## Pasos a ejecutar
1. Para cada subtarea, llama a create_task con:
   - projectId: "${projectId}"
   - title: "[Parte N/total] descripción"
   - userStory: { who, what, why } (derivada de la tarea padre)
   - acceptanceCriteria: array de criterios relevantes
   - bizPoints y devPoints (Fibonacci)
   - tests: al menos 1 test por subtarea
   - sprintId: "${task.sprintId || ''}"

2. Después de crear cada subtarea (excepto la primera), usa update_task para añadir:
   - blockedBy: [ID de la subtarea anterior]
   - parentTaskId: "${task.taskId}"
   Para la primera subtarea, solo añade parentTaskId.

3. Tras crear todas, usa update_task en la tarea padre "${task.taskId}" para:
   - decomposed: true
   - status: "done"

## Respuesta
Responde con JSON:
{
  "subtaskIds": ["id1", "id2", ...],
  "decomposed": true
}`;
}

/**
 * @private
 */
function getACCount(acceptanceCriteria) {
  if (!acceptanceCriteria) return 0;
  if (Array.isArray(acceptanceCriteria)) return acceptanceCriteria.length;
  if (typeof acceptanceCriteria === 'string') {
    return acceptanceCriteria.split('\n').filter(l => l.trim().length > 0).length;
  }
  return 0;
}

/**
 * @private
 */
function getStoryLength(userStory) {
  if (!userStory) return 0;
  if (typeof userStory === 'string') return userStory.length;
  const parts = [userStory.who, userStory.what, userStory.why].filter(Boolean);
  return parts.join(' ').length;
}
