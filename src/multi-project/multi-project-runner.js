import { runTask } from '../cycle/task-runner.js';
import { validateConfig, config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { komodoState, PHASES, EXECUTION_STATES } from '../state/komodo-state.js';
import { KomodoWsServer } from '../server/ws-server.js';
// Dynamic import — api-server.js may not exist yet (created by task [25.2])
let KomodoApiServer = null;
try {
  ({ KomodoApiServer } = await import('../server/api-server.js'));
} catch {
  // API server not available yet — skip
}
import { checkpointManager } from '../state/checkpoint-manager.js';
import { shutdownManager } from '../shutdown/shutdown-manager.js';
import { budgetManager } from '../cost/budget-manager.js';
import { selectNextProject, STRATEGIES } from './project-selector.js';
import { getAll } from '../../skills/planning-task-mcp/src/firebase.js';

const AGENT = 'MULTI-PROJECT';

// Multi-project event types
export const MULTI_PROJECT_EVENTS = {
  PROJECT_SELECTED: 'multi-project:project-selected',
  PROJECT_SWITCH: 'multi-project:project-switch',
  ALL_BACKLOGS_EMPTY: 'multi-project:all-backlogs-empty',
  MULTI_RUN_STARTED: 'multi-project:run-started',
  MULTI_RUN_COMPLETED: 'multi-project:run-completed',
};

/**
 * Resolves the list of project IDs from config.
 * If PROJECTS=* , fetches all projects where the user is a member.
 *
 * @returns {Promise<string[]>}
 */
export async function resolveProjectIds() {
  const raw = config.projects;

  // PROJECTS=* → fetch all projects the user is a member of
  if (raw === '*' || (Array.isArray(raw) && raw.length === 1 && raw[0] === '*')) {
    const userId = config.defaultUserId;
    if (!userId) {
      throw new Error('PROJECTS=* requires DEFAULT_USER_ID to be set');
    }

    const allProjects = await getAll('projects');
    const userProjects = allProjects.filter(p => {
      if (!p.members) return false;
      return Object.keys(p.members).includes(userId);
    });

    if (userProjects.length === 0) {
      throw new Error(`No projects found for user ${userId}`);
    }

    return userProjects.map(p => p.id);
  }

  // PROJECTS=id1,id2,... → parse comma-separated string into array
  if (typeof raw === 'string') {
    return raw.split(',').map(id => id.trim()).filter(Boolean);
  }

  // Already an array (e.g. from tests)
  return raw;
}

/**
 * Runs tasks across multiple projects using the configured strategy.
 *
 * @param {string[]} projectIds - List of project IDs
 * @param {Object} [options]
 * @param {number} [options.tasks=1] - Number of tasks to execute total (0 = all)
 * @param {string} [options.cwd] - Working directory
 * @param {string} [options.strategy] - Selection strategy override
 * @returns {Promise<{ tasksCompleted: number, tasksFailed: number, results: Object[], perProject: Object }>}
 */
export async function runMultiProject(projectIds, options = {}) {
  const { tasks: maxTasks = 1, cwd, strategy: strategyOverride } = options;
  const continuous = maxTasks === 0;
  const strategy = strategyOverride || config.multiProjectStrategy;

  // Validate config
  const errors = validateConfig();
  if (errors.length > 0) {
    logger.error('Configuration errors:', AGENT);
    errors.forEach(e => logger.error(`  - ${e}`, AGENT));
    return { tasksCompleted: 0, tasksFailed: 0, results: [], perProject: {} };
  }

  // Validate strategy
  const validStrategies = Object.values(STRATEGIES);
  if (!validStrategies.includes(strategy)) {
    logger.error(`Invalid strategy "${strategy}". Valid: ${validStrategies.join(', ')}`, AGENT);
    return { tasksCompleted: 0, tasksFailed: 0, results: [], perProject: {} };
  }

  const mode = continuous ? 'continuous (until all backlogs empty)' : `${maxTasks} task(s)`;
  logger.taskHeader(`KOMODO MULTI-PROJECT — ${mode}`);
  logger.info(`Projects: ${projectIds.join(', ')}`, AGENT);
  logger.info(`Strategy: ${strategy}`, AGENT);
  logger.info(`Auto-merge: ${config.autoMerge ? 'yes' : 'no (manual)'}`, AGENT);

  // Reset global state
  komodoState.updatePhase(PHASES.IDLE, {
    currentTask: null,
    currentPR: null,
    reviewCycle: 0,
    tasksCompleted: 0,
  });
  komodoState.setExecutionState(EXECUTION_STATES.RUNNING);

  // Initialize multi-project state
  komodoState.multiProject = {
    enabled: true,
    projects: projectIds,
    strategy,
    activeProject: null,
    perProject: {},
  };
  for (const pid of projectIds) {
    komodoState.multiProject.perProject[pid] = {
      tasksCompleted: 0,
      tasksFailed: 0,
      dailySpent: 0,
    };
  }

  // Start infrastructure
  checkpointManager.start();
  budgetManager.start({ projectId: projectIds[0] });

  const wsServer = new KomodoWsServer();
  try {
    await wsServer.start();
  } catch (err) {
    logger.warn(`Could not start WS server: ${err.message}`, AGENT);
  }

  let apiServer = null;
  if (config.apiServerEnabled && KomodoApiServer) {
    apiServer = new KomodoApiServer();
    try {
      await apiServer.start();
    } catch (err) {
      logger.warn(`Could not start API server: ${err.message}`, AGENT);
    }
  }

  shutdownManager.register({ wsServer });

  eventBus.emitEvent(MULTI_PROJECT_EVENTS.MULTI_RUN_STARTED, {
    metadata: { projectIds, strategy, maxTasks },
  });

  const results = [];
  let tasksCompleted = 0;
  let tasksFailed = 0;
  let taskNumber = 0;
  let emptyRoundsInRow = 0;

  // Context for round-robin (tracks last selected index)
  const selectorContext = { lastIndex: -1 };

  while (true) {
    taskNumber++;

    // Check stop/pause signals
    if (komodoState.isStopRequested()) {
      logger.info('Stop requested. Stopping multi-project runner.', AGENT);
      break;
    }
    if (komodoState.isPauseRequested()) {
      logger.info('Pause requested. Pausing after last task.', AGENT);
      break;
    }

    // Check budget
    if (komodoState.executionState === EXECUTION_STATES.BUDGET_PAUSED) {
      logger.warn('Budget exceeded. Stopping multi-project runner.', AGENT);
      break;
    }

    // Task limit reached?
    if (!continuous && taskNumber > maxTasks) break;

    // Select next project
    const selection = await selectNextProject(projectIds, strategy, selectorContext);

    if (!selection) {
      emptyRoundsInRow++;
      if (emptyRoundsInRow >= 2) {
        logger.info('All project backlogs empty. Stopping.', AGENT);
        eventBus.emitEvent(MULTI_PROJECT_EVENTS.ALL_BACKLOGS_EMPTY, {
          metadata: { projectIds },
        });
        break;
      }
      // First empty round — retry once (tasks may have been added)
      taskNumber--;
      continue;
    }

    emptyRoundsInRow = 0;
    const { projectId } = selection;

    // Track active project
    komodoState.multiProject.activeProject = projectId;

    eventBus.emitEvent(MULTI_PROJECT_EVENTS.PROJECT_SELECTED, {
      metadata: { projectId, strategy, taskNumber },
    });

    logger.taskHeader(`TASK ${taskNumber}${continuous ? '' : `/${maxTasks}`} — Project: ${projectId}`);

    try {
      const result = await runTask(projectId, cwd);
      results.push({ ...result, projectId });

      if (!result.taskId) {
        // This project's backlog is empty now
        taskNumber--;
        continue;
      }

      const projectStats = komodoState.multiProject.perProject[projectId];
      if (result.success) {
        tasksCompleted++;
        projectStats.tasksCompleted++;
        komodoState.updatePhase(PHASES.IDLE, { tasksCompleted });
        logger.success(`Task "${result.taskTitle}" completed (project: ${projectId})`, AGENT);
      } else {
        tasksFailed++;
        projectStats.tasksFailed++;
        komodoState.updatePhase(PHASES.IDLE);
        logger.error(`Task "${result.taskTitle}" failed: ${result.error} (project: ${projectId})`, AGENT);

        if (!continuous) break;
      }
    } catch (err) {
      tasksFailed++;
      const projectStats = komodoState.multiProject.perProject[projectId];
      projectStats.tasksFailed++;
      logger.error(`Unexpected error in task ${taskNumber} (project: ${projectId}): ${err.message}`, AGENT);
      results.push({ success: false, error: err.message, projectId });

      if (!continuous) break;
    }
  }

  // Cleanup
  shutdownManager.unregister();
  checkpointManager.stop();
  budgetManager.stop();

  if (komodoState.executionState !== EXECUTION_STATES.PAUSED) {
    komodoState.setExecutionState(EXECUTION_STATES.STOPPED);
  }

  if (apiServer) await apiServer.stop();
  await wsServer.stop();

  const perProject = komodoState.multiProject.perProject;

  eventBus.emitEvent(MULTI_PROJECT_EVENTS.MULTI_RUN_COMPLETED, {
    metadata: { tasksCompleted, tasksFailed, perProject },
  });

  // Summary
  logger.taskHeader('MULTI-PROJECT SUMMARY');
  logger.info(`Total tasks completed: ${tasksCompleted}`, AGENT);
  if (tasksFailed > 0) {
    logger.warn(`Total tasks failed: ${tasksFailed}`, AGENT);
  }
  for (const pid of projectIds) {
    const stats = perProject[pid];
    logger.info(`  ${pid}: ${stats.tasksCompleted} completed, ${stats.tasksFailed} failed`, AGENT);
  }

  return { tasksCompleted, tasksFailed, results, perProject };
}
