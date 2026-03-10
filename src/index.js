#!/usr/bin/env node

import { Command } from 'commander';
import { run, resume, checkForPendingCheckpoints, watch } from './orchestrator.js';
import { runMultiProject, resolveProjectIds } from './multi-project/multi-project-runner.js';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { doctor } from './doctor/doctor.js';
import { loadProjects, parseProjectsEnv, resolveProjectIdByName } from './multi-project/project-loader.js';

/**
 * Loads projects from PROJECTS env and returns the first projectId.
 * Exits the process with an error if no valid projects are found.
 *
 * @returns {Promise<string>} The first project's ID
 */
async function resolveProjectIdFromEnv() {
  try {
    const projects = await loadProjects();
    if (!projects || projects.length === 0) {
      logger.error('No se encontraron proyectos válidos en PROJECTS', 'KOMODO');
      process.exit(1);
    }
    const projectId = projects[0].projectId;
    logger.info(`Multi-project mode: usando proyecto "${projects[0].name}" (${projectId})`, 'KOMODO');
    if (projects.length > 1) {
      logger.info(`Proyectos disponibles: ${projects.map(p => p.name).join(', ')}`, 'KOMODO');
    }
    return projectId;
  } catch (err) {
    logger.error(`Error cargando proyectos: ${err.message}`, 'KOMODO');
    process.exit(1);
  }
}

const program = new Command();

program
  .name('komodo')
  .description('Orquestador de agentes IA para desarrollo de software')
  .version('1.0.0');

// ============================================
// komodo run
// ============================================
program
  .command('run')
  .description('Ejecuta tareas del backlog de un proyecto')
  .option('-p, --project <id-or-name>', 'ID o nombre del proyecto (default: DEFAULT_PROJECT_ID o PROJECTS en .env)')
  .option('-t, --tasks <number>', 'Número de tareas a ejecutar (default: 1)', '1')
  .option('-c, --continuous', 'Ejecutar hasta vaciar el backlog')
  .option('--cwd <path>', 'Directorio del repositorio')
  .option('--dry-run', 'Simular: muestra qué tarea elegiría sin ejecutar nada')
  .action(async (opts) => {
    // -p flag takes priority; then DEFAULT_PROJECT_ID; then PROJECTS env
    let projectId = opts.project || config.defaultProjectId;

    if (!projectId) {
      const { wildcard, projectIds } = parseProjectsEnv();
      if (!wildcard && projectIds.length === 0) {
        logger.error('Project ID requerido. Usa -p <id-o-nombre>, configura DEFAULT_PROJECT_ID o PROJECTS en .env', 'KOMODO');
        process.exit(1);
      }
    }

    // Resolve project name to ID if needed (for -p flag or DEFAULT_PROJECT_ID)
    if (projectId) {
      try {
        projectId = await resolveProjectIdByName(projectId);
      } catch (err) {
        logger.error(err.message, 'KOMODO');
        process.exit(1);
      }
    }

    const tasks = opts.continuous ? 0 : parseInt(opts.tasks, 10);

    if (!opts.continuous && !opts.dryRun && (isNaN(tasks) || tasks < 1)) {
      logger.error('--tasks debe ser un número >= 1', 'KOMODO');
      process.exit(1);
    }

    // Self-diagnostic antes de arrancar
    if (!doctor()) {
      process.exit(1);
    }

    // Load and validate projects from PROJECTS env (if no -p flag)
    if (!opts.project && !config.defaultProjectId) {
      projectId = await resolveProjectIdFromEnv();
    }

    try {
      // Check for pending checkpoints before starting normal run
      if (!opts.dryRun) {
        const checkpointResult = await checkForPendingCheckpoints({ cwd: opts.cwd });
        if (checkpointResult.resumed) {
          const r = checkpointResult.result;
          logger.info(`Reanudación ${r.success ? 'exitosa' : 'fallida'}`, 'KOMODO');
          if (!r.success) {
            process.exit(1);
          }
          // After successful resume, continue with normal run
        }
      }

      const result = await run(projectId, {
        tasks,
        cwd: opts.cwd,
        dryRun: opts.dryRun || false,
      });

      process.exit(result.tasksFailed > 0 ? 1 : 0);
    } catch (err) {
      logger.error(`Error fatal: ${err.message}`, 'KOMODO');
      process.exit(1);
    }
  });

// ============================================
// komodo resume
// ============================================
program
  .command('resume')
  .description('Reanuda la ejecución desde el último checkpoint guardado')
  .option('--cwd <path>', 'Directorio del repositorio')
  .action(async (opts) => {
    try {
      const result = await resume({ cwd: opts.cwd });

      if (result.tasksCompleted === 0 && result.tasksFailed === 0) {
        // No checkpoints found — already logged by resume()
        process.exit(0);
      }

      process.exit(result.tasksFailed > 0 ? 1 : 0);
    } catch (err) {
      logger.error(`Error fatal: ${err.message}`, 'KOMODO');
      process.exit(1);
    }
  });

// ============================================
// komodo watch
// ============================================
program
  .command('watch')
  .description('Modo daemon: escucha el backlog y ejecuta tareas automáticamente')
  .option('-p, --project <id-or-name>', 'ID o nombre del proyecto (default: DEFAULT_PROJECT_ID o PROJECTS en .env)')
  .option('--cwd <path>', 'Directorio del repositorio')
  .action(async (opts) => {
    let projectId = opts.project || config.defaultProjectId;

    if (!projectId) {
      const { wildcard, projectIds } = parseProjectsEnv();
      if (!wildcard && projectIds.length === 0) {
        logger.error('Project ID requerido. Usa -p <id-o-nombre>, configura DEFAULT_PROJECT_ID o PROJECTS en .env', 'KOMODO');
        process.exit(1);
      }
    }

    // Resolve project name to ID if needed
    if (projectId) {
      try {
        projectId = await resolveProjectIdByName(projectId);
      } catch (err) {
        logger.error(err.message, 'KOMODO');
        process.exit(1);
      }
    }

    // Self-diagnostic antes de arrancar
    if (!doctor()) {
      process.exit(1);
    }

    // Load and validate projects from PROJECTS env (if no -p flag)
    if (!opts.project && !config.defaultProjectId) {
      projectId = await resolveProjectIdFromEnv();
    }

    try {
      const result = await watch(projectId, { cwd: opts.cwd });
      process.exit(result.tasksFailed > 0 ? 1 : 0);
    } catch (err) {
      logger.error(`Error fatal: ${err.message}`, 'KOMODO');
      process.exit(1);
    }
  });

// ============================================
// komodo multi
// ============================================
program
  .command('multi')
  .description('Ejecuta tareas de múltiples proyectos simultáneamente')
  .option('-p, --projects <ids>', 'IDs de proyectos separados por coma (o * para todos)', '')
  .option('-t, --tasks <number>', 'Número total de tareas a ejecutar (default: 1)', '1')
  .option('-c, --continuous', 'Ejecutar hasta vaciar todos los backlogs')
  .option('-s, --strategy <type>', 'Estrategia: round-robin|priority|backlog-size')
  .option('--cwd <path>', 'Directorio del repositorio')
  .action(async (opts) => {
    // Self-diagnostic
    if (!doctor()) {
      process.exit(1);
    }

    try {
      // Resolve project IDs: CLI flag > PROJECTS env var
      let projectIds;
      if (opts.projects) {
        const raw = opts.projects.split(',').map(s => s.trim()).filter(Boolean);
        // Temporarily override config for resolveProjectIds
        config.projects = raw;
        projectIds = await resolveProjectIds();
      } else if (config.projects.length > 0) {
        projectIds = await resolveProjectIds();
      } else {
        logger.error('Projects required. Use -p <id1,id2,...> or set PROJECTS in .env', 'KOMODO');
        process.exit(1);
      }

      if (projectIds.length < 2) {
        logger.warn('Only 1 project specified. Use "komodo run" for single-project mode.', 'KOMODO');
      }

      const tasks = opts.continuous ? 0 : parseInt(opts.tasks, 10);
      if (!opts.continuous && (isNaN(tasks) || tasks < 1)) {
        logger.error('--tasks must be >= 1', 'KOMODO');
        process.exit(1);
      }

      const result = await runMultiProject(projectIds, {
        tasks,
        cwd: opts.cwd,
        strategy: opts.strategy,
      });

      process.exit(result.tasksFailed > 0 ? 1 : 0);
    } catch (err) {
      logger.error(`Fatal error: ${err.message}`, 'KOMODO');
      process.exit(1);
    }
  });

// ============================================
// komodo setup
// ============================================
program
  .command('setup')
  .description('Wizard de configuración interactivo')
  .action(async () => {
    const { runSetup } = await import('./setup.js');
    await runSetup();
  });

// ============================================
// komodo doctor
// ============================================
program
  .command('doctor')
  .description('Diagnóstico completo: verifica CLIs, Firebase, GitHub, tokens y servicios')
  .action(() => {
    const ok = doctor();
    process.exit(ok ? 0 : 1);
  });

program.parse();
