import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { runAgent } from '../agents/base-agent.js';
import { extractJSON } from '../utils/parser.js';
import { calculateRealComplexity, getAcceptanceCriteriaCount, getUserStoryLength } from './complexity-classifier.js';

const DECOMPOSITION_AC_THRESHOLD = 6;
const DECOMPOSITION_STORY_CHAR_THRESHOLD = 500;
const REAL_COMPLEXITY_THRESHOLD = 7;
const MIN_SUBTASKS = 2;
const MAX_SUBTASKS = 5;

/**
 * Determines whether a task should be decomposed into subtasks.
 *
 * Uses real complexity (from architect/implementation plan data) when available,
 * falling back to devPoints and heuristic thresholds.
 *
 * A task is NEVER decomposed if:
 * - It already has a parentTaskId (is a subtask — avoids infinite recursion)
 * - TASK_DECOMPOSITION is disabled via .env
 * - It is already marked as decomposed
 *
 * @param {Object} task
 * @returns {{ shouldDecompose: boolean, reasons: string[], realComplexity?: Object }}
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

  // Calculate real complexity using plan data if available
  const realComplexity = calculateRealComplexity(task);
  const hasPlanData = !realComplexity.signals.noPlanData;

  if (hasPlanData) {
    // Use real complexity score as primary threshold
    if (realComplexity.score >= REAL_COMPLEXITY_THRESHOLD) {
      reasons.push(`realComplexity=${realComplexity.score} >= threshold=${REAL_COMPLEXITY_THRESHOLD} (${realComplexity.reasoning})`);
    }
  } else {
    // Fallback: use devPoints threshold (legacy behavior)
    const threshold = config.decompositionThresholdDevpoints;
    if (task.devPoints && task.devPoints >= threshold) {
      reasons.push(`devPoints=${task.devPoints} >= threshold=${threshold}`);
    }
  }

  // Additional heuristic checks (apply regardless of plan data)
  const acCount = getAcceptanceCriteriaCount(task.acceptanceCriteria);
  if (acCount > DECOMPOSITION_AC_THRESHOLD) {
    reasons.push(`acceptanceCriteria=${acCount} > ${DECOMPOSITION_AC_THRESHOLD}`);
  }

  const storyLen = getUserStoryLength(task.userStory);
  if (storyLen > DECOMPOSITION_STORY_CHAR_THRESHOLD) {
    reasons.push(`userStoryLength=${storyLen} > ${DECOMPOSITION_STORY_CHAR_THRESHOLD}`);
  }

  return { shouldDecompose: reasons.length > 0, reasons, realComplexity };
}

/**
 * Decomposes a large task into subtasks by using an AI agent to generate
 * a decomposition plan, then creating the subtasks via planning-task-mcp.
 *
 * When an architectPlan is provided, the decomposition prompt includes
 * implementation order, files, and dependencies so subtasks are coherent
 * with the architect's analysis.
 *
 * @param {Object} task - The parent task to decompose
 * @param {string} projectId - The project ID
 * @param {Object} [options]
 * @param {Object} [options.architectPlan] - Architect plan (filesToCreate, filesToModify, implementationOrder, etc.)
 * @returns {Promise<{ success: boolean, subtaskIds?: string[], error?: string }>}
 */
export async function decomposeTask(task, projectId, { architectPlan } = {}) {
  const parentDevPoints = task.devPoints || 5;
  const parentBizPoints = task.bizPoints || 3;

  // Merge architectPlan into task for prompt building (prefer runtime plan over stored plan)
  const effectivePlan = architectPlan || task.architectPlan || task.implementationPlan || null;

  logger.info(`Decomposing task "${task.title}" (devPoints=${parentDevPoints}, plan=${effectivePlan ? 'yes' : 'no'})...`, 'KOMODO');

  const systemPrompt = buildDecompositionPrompt(task, projectId, parentDevPoints, parentBizPoints, effectivePlan);

  // Calculate real complexity if plan data is available, for context in the user prompt
  const taskForComplexity = effectivePlan ? { ...task, architectPlan: effectivePlan } : task;
  const realComplexity = calculateRealComplexity(taskForComplexity);
  const complexityLine = realComplexity.signals.noPlanData
    ? ''
    : `\nComplejidad real calculada: ${realComplexity.score}/10 (${realComplexity.reasoning})`;

  const userPrompt = `Descompone la tarea "${task.title}" (ID: ${task.taskId}) en subtareas más pequeñas.

La tarea tiene ${parentDevPoints} devPoints y ${getAcceptanceCriteriaCount(task.acceptanceCriteria)} criterios de aceptación.${complexityLine}

Genera entre ${MIN_SUBTASKS} y ${MAX_SUBTASKS} subtareas. Los devPoints de las subtareas deben sumar aproximadamente ${parentDevPoints}.

Luego:
1. Crea cada subtarea con create_task (projectId="${projectId}")
2. Para cada subtarea, usa update_task para añadir parentTaskId="${task.taskId}" y blockedBy según las dependencias entre subtareas
3. Después de crear todas las subtareas, usa update_task en la tarea padre "${task.taskId}" para marcarla con decomposed=true y status="done"
4. Responde con el JSON indicado en el system prompt`;

  let result;
  try {
    result = await runAgent({
      name: 'PLANNER',
      systemPrompt,
      userPrompt,
      mcpServerNames: ['planning-task-mcp'],
      maxTurns: 25,
    });
  } catch (err) {
    logger.error(`Decomposition agent error: ${err.message}`, 'KOMODO');
    return { success: false, error: err.message };
  }

  if (!result.success || !result.result) {
    logger.error(`Decomposition failed: ${result.error || 'No result'}`, 'KOMODO');
    return { success: false, error: result.error || 'Agent did not return a result' };
  }

  let data = result.result;

  // If agent returned a string, try to extract JSON from it
  if (typeof data === 'string') {
    data = extractJSON(data);
    if (!data) {
      logger.warn('Agent returned non-JSON string response', 'KOMODO');
      return { success: false, error: 'Agent response is not valid JSON' };
    }
  }

  if (typeof data !== 'object' || data === null || !Array.isArray(data.subtaskIds) || data.subtaskIds.length < MIN_SUBTASKS) {
    logger.warn('Agent returned insufficient or invalid subtasks', 'KOMODO');
    return { success: false, error: 'Decomposition produced insufficient or invalid subtasks' };
  }

  logger.success(`Task decomposed into ${data.subtaskIds.length} subtasks: ${data.subtaskIds.join(', ')}`, 'KOMODO');

  eventBus.emitEvent(EVENT_TYPES.TASK_DECOMPOSED, {
    metadata: {
      parentTaskId: task.taskId,
      parentTitle: task.title,
      subtaskIds: data.subtaskIds,
      subtaskCount: data.subtaskIds.length,
      hasArchitectPlan: !!effectivePlan,
    },
  });

  return { success: true, subtaskIds: data.subtaskIds };
}

/**
 * Builds the system prompt for the decomposition agent.
 * When a plan is available, includes implementation order, files, and dependencies
 * so subtasks follow the architect's analysis.
 * @private
 */
function buildDecompositionPrompt(task, projectId, parentDevPoints, parentBizPoints, plan) {
  const acList = Array.isArray(task.acceptanceCriteria)
    ? task.acceptanceCriteria.map((ac, i) => `${i + 1}. ${ac}`).join('\n')
    : '';

  const storyText = task.userStory
    ? `Como ${task.userStory.who || '?'}, quiero ${task.userStory.what || '?'}, para ${task.userStory.why || '?'}`
    : '';

  let planSection = '';
  if (plan) {
    const parts = [];

    const filesToCreate = Array.isArray(plan.filesToCreate) ? plan.filesToCreate : [];
    const filesToModify = Array.isArray(plan.filesToModify) ? plan.filesToModify : [];
    if (filesToCreate.length > 0 || filesToModify.length > 0) {
      const fileLines = [];
      for (const f of filesToCreate) {
        fileLines.push(`  - [CREATE] ${f.path || f} — ${f.purpose || ''}`);
      }
      for (const f of filesToModify) {
        fileLines.push(`  - [MODIFY] ${f.path || f} — ${f.changes || ''}`);
      }
      parts.push(`### Archivos afectados\n${fileLines.join('\n')}`);
    }

    const deps = Array.isArray(plan.dependencies) ? plan.dependencies : [];
    if (deps.length > 0) {
      parts.push(`### Dependencias externas\n${deps.map(d => `  - ${d}`).join('\n')}`);
    }

    if (plan.dataModelChanges && String(plan.dataModelChanges).toLowerCase() !== 'none') {
      parts.push(`### Cambios en data model\n${plan.dataModelChanges}`);
    }

    if (plan.apiChanges && String(plan.apiChanges).toLowerCase() !== 'none') {
      parts.push(`### Cambios en API\n${plan.apiChanges}`);
    }

    const implOrder = Array.isArray(plan.implementationOrder)
      ? plan.implementationOrder
      : (Array.isArray(plan.steps) ? plan.steps : []);
    if (implOrder.length > 0) {
      parts.push(`### Orden de implementación (del Architect)\n${implOrder.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}`);
    }

    const risks = Array.isArray(plan.risks) ? plan.risks : [];
    if (risks.length > 0) {
      parts.push(`### Riesgos identificados\n${risks.map(r => `  - ${r}`).join('\n')}`);
    }

    if (parts.length > 0) {
      planSection = `\n## Plan del Architect\nEl Architect ya analizó esta tarea. DEBES seguir este plan al descomponer:\n\n${parts.join('\n\n')}\n`;
    }
  }

  const dependencyRules = plan
    ? `7. Las subtareas DEBEN seguir el orden de implementación del Architect
8. Subtareas que NO dependen entre sí se marcan como parallelizable=true (sin blockedBy entre ellas)
9. Subtareas que SÍ dependen de otra se marcan con blockedBy=[ID de la subtarea previa]
10. Cada subtarea debe incluir los archivos específicos que toca (campo "files" en la subtarea)`
    : `7. Las subtareas deben tener bloqueo SECUENCIAL: la 2a espera a la 1a, la 3a espera a la 2a, etc.`;

  return `Eres el PLANNER de Komodo. Tu tarea es DESCOMPONER una tarea grande en subtareas más pequeñas.

## Tarea padre
- ID: ${task.taskId}
- Título: ${task.title}
- devPoints: ${parentDevPoints}
- bizPoints: ${parentBizPoints}
- User Story: ${storyText}
- Criterios de aceptación:
${acList}
${planSection}
## Reglas de descomposición
1. Genera entre ${MIN_SUBTASKS} y ${MAX_SUBTASKS} subtareas
2. Cada subtarea debe tener devPoints en Fibonacci (1, 2, 3, 5) — máximo 5 por subtarea
3. La SUMA de devPoints de las subtareas debe ser aproximadamente ${parentDevPoints} (±1 punto)
4. Cada subtarea debe tener bizPoints proporcionales (total ≈ ${parentBizPoints})
5. Los criterios de aceptación de la tarea padre deben distribuirse entre las subtareas
6. Cada subtarea necesita al menos 1 criterio de aceptación y 1 test
${dependencyRules}

## Pasos a ejecutar
1. Para cada subtarea, llama a create_task con:
   - projectId: "${projectId}"
   - title: "[Parte N/total] descripción"
   - userStory: { who, what, why } (derivada de la tarea padre)
   - acceptanceCriteria: array de criterios relevantes
   - bizPoints y devPoints (Fibonacci)
   - tests: al menos 1 test por subtarea
   - sprintId: "${task.sprintId || ''}"

2. Después de crear cada subtarea, usa update_task para añadir:
   - parentTaskId: "${task.taskId}"
   - blockedBy: según las dependencias (subtareas parallelizables NO se bloquean entre sí)
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
