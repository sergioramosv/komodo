import readline from 'readline';
import { config } from '../config.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { komodoState, EXECUTION_STATES } from '../state/komodo-state.js';
import { logger } from '../utils/logger.js';

/**
 * Waits for human approval before continuing the pipeline.
 *
 * In interactive mode (TTY), prompts the user on stdin and waits up to
 * APPROVAL_TIMEOUT_MINUTES. If the timeout expires or stdin is not a TTY
 * (daemon/pipe mode), the gate auto-approves and emits AUTONOMY_TIMED_OUT.
 *
 * @param {Object} options
 * @param {string} options.step - The gate step name (e.g. GATE_STEPS.AFTER_PLANNING)
 * @param {string} [options.description] - Human-readable description shown in the prompt
 * @param {Object} [options.metadata] - Extra metadata attached to emitted events
 * @returns {Promise<{ approved: boolean, timedOut: boolean }>}
 */
export async function waitForApproval({ step, description = '', metadata = {} } = {}) {
  const timeoutMs = config.approvalTimeoutMinutes * 60 * 1000;

  logger.info(
    `[APPROVAL GATE] ${step}${description ? ' — ' + description : ''}`,
    'AUTONOMY',
  );
  logger.info(
    `Esperando aprobación humana (timeout: ${config.approvalTimeoutMinutes} min)...`,
    'AUTONOMY',
  );

  komodoState.setExecutionState(EXECUTION_STATES.AWAITING_APPROVAL);

  eventBus.emitEvent(EVENT_TYPES.AUTONOMY_APPROVAL_REQUESTED, {
    metadata: { step, description, timeoutMs, ...metadata },
  });

  // In non-TTY environments (CI, daemon, piped), auto-approve immediately
  if (!process.stdin.isTTY) {
    logger.warn(
      `stdin no es TTY (modo daemon/pipe). Auto-aprobando inmediatamente para "${step}".`,
      'AUTONOMY',
    );
    komodoState.setExecutionState(EXECUTION_STATES.RUNNING);
    eventBus.emitEvent(EVENT_TYPES.AUTONOMY_AUTO_APPROVED, {
      metadata: { step, description, reason: 'non-tty', ...metadata },
    });
    return { approved: true, timedOut: false };
  }

  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    let resolved = false;

    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      rl.close();
      komodoState.setExecutionState(EXECUTION_STATES.RUNNING);
      eventBus.emitEvent(EVENT_TYPES.AUTONOMY_TIMED_OUT, {
        metadata: { step, description, ...metadata },
      });
      logger.warn(`Timeout de aprobación alcanzado para "${step}". Continuando automáticamente.`, 'AUTONOMY');
      resolve({ approved: true, timedOut: true });
    }, timeoutMs);

    rl.question('\n  Presiona [ENTER] para aprobar o escribe "reject" para rechazar: ', answer => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      rl.close();

      const rejected = answer.trim().toLowerCase() === 'reject';

      komodoState.setExecutionState(EXECUTION_STATES.RUNNING);

      if (rejected) {
        eventBus.emitEvent(EVENT_TYPES.AUTONOMY_REJECTED, {
          metadata: { step, description, ...metadata },
        });
        logger.warn(`Aprobación rechazada para "${step}".`, 'AUTONOMY');
        resolve({ approved: false, timedOut: false });
      } else {
        eventBus.emitEvent(EVENT_TYPES.AUTONOMY_APPROVED, {
          metadata: { step, description, ...metadata },
        });
        logger.info(`Aprobado por el usuario para "${step}".`, 'AUTONOMY');
        resolve({ approved: true, timedOut: false });
      }
    });
  });
}
