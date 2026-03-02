#!/usr/bin/env node

import { Command } from 'commander';
import { run, resume, checkForPendingCheckpoints } from './orchestrator.js';
import { config } from './config.js';
import { logger } from './utils/logger.js';

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
  .option('-p, --project <id>', 'ID del proyecto (default: DEFAULT_PROJECT_ID en .env)')
  .option('-t, --tasks <number>', 'Número de tareas a ejecutar (default: 1)', '1')
  .option('-c, --continuous', 'Ejecutar hasta vaciar el backlog')
  .option('--cwd <path>', 'Directorio del repositorio')
  .option('--dry-run', 'Simular: muestra qué tarea elegiría sin ejecutar nada')
  .action(async (opts) => {
    const projectId = opts.project || config.defaultProjectId;

    if (!projectId) {
      logger.error('Project ID requerido. Usa -p <id> o configura DEFAULT_PROJECT_ID en .env', 'KOMODO');
      process.exit(1);
    }

    const tasks = opts.continuous ? 0 : parseInt(opts.tasks, 10);

    if (!opts.continuous && !opts.dryRun && (isNaN(tasks) || tasks < 1)) {
      logger.error('--tasks debe ser un número >= 1', 'KOMODO');
      process.exit(1);
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
// komodo setup
// ============================================
program
  .command('setup')
  .description('Wizard de configuración interactivo')
  .action(async () => {
    const { runSetup } = await import('./setup.js');
    await runSetup();
  });

program.parse();
