import readline from 'readline';
import { config } from '../config.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { komodoState, EXECUTION_STATES } from '../state/komodo-state.js';
import { logger } from '../utils/logger.js';
import { approvalChannelManager } from './approval-channels.js';

/**
 * Waits for human approval before continuing the pipeline.
 *
 * If APPROVAL_CHANNELS is set (e.g. 'telegram', 'dashboard', 'webhook'), the gate
 * creates a pending approval in the approvalChannelManager and waits for a channel
 * to call resolveApproval(). Timeout behavior is controlled by APPROVAL_ON_TIMEOUT.
 *
 * Falls back to TTY stdin when APPROVAL_CHANNELS is empty/unset and stdin is a TTY.
 * In non-TTY environments without channels, auto-approves immediately.
 *
 * @param {Object} options
 * @param {string} options.step - The gate step name (e.g. GATE_STEPS.AFTER_PLANNING)
 * @param {string} [options.description] - Human-readable description shown in the prompt
 * @param {Object} [options.metadata] - Extra metadata attached to emitted events
 * @returns {Promise<{ approved: boolean, timedOut: boolean }>}
 */
export async function waitForApproval({ step, description = '', metadata = {} } = {}) {
  const timeoutMs = config.approvalTimeoutMinutes * 60 * 1000;
  const requestId = `${step}-${Date.now()}`;

  logger.info(
    `[APPROVAL GATE] ${step}${description ? ' — ' + description : ''}`,
    'AUTONOMY',
  );
  logger.info(
    `Esperando aprobación humana (timeout: ${config.approvalTimeoutMinutes} min)...`,
    'AUTONOMY',
  );

  komodoState.setExecutionState(EXECUTION_STATES.AWAITING_APPROVAL);
  komodoState.pendingApproval = { step, description, timeoutMs, requestId };

  eventBus.emitEvent(EVENT_TYPES.AUTONOMY_APPROVAL_REQUESTED, {
    metadata: { step, description, timeoutMs, requestId, ...metadata },
  });

  // Use channel manager when APPROVAL_CHANNELS is configured
  if (config.approvalChannels?.length > 0) {
    const result = await approvalChannelManager.requestApproval({ step, description, metadata });
    komodoState.pendingApproval = null;
    komodoState.setExecutionState(EXECUTION_STATES.RUNNING);
    return result;
  }

  // In non-TTY environments (CI, daemon, piped), auto-approve immediately
  if (!process.stdin.isTTY) {
    logger.warn(
      `stdin no es TTY (modo daemon/pipe). Auto-aprobando inmediatamente para "${step}".`,
      'AUTONOMY',
    );
    komodoState.pendingApproval = null;
    komodoState.setExecutionState(EXECUTION_STATES.RUNNING);
    eventBus.emitEvent(EVENT_TYPES.AUTONOMY_AUTO_APPROVED, {
      metadata: { step, description, reason: 'non-tty', requestId, ...metadata },
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
      komodoState.pendingApproval = null;
      komodoState.setExecutionState(EXECUTION_STATES.RUNNING);
      eventBus.emitEvent(EVENT_TYPES.AUTONOMY_TIMED_OUT, {
        metadata: { step, description, requestId, ...metadata },
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

      komodoState.pendingApproval = null;
      komodoState.setExecutionState(EXECUTION_STATES.RUNNING);

      if (rejected) {
        eventBus.emitEvent(EVENT_TYPES.AUTONOMY_REJECTED, {
          metadata: { step, description, requestId, ...metadata },
        });
        logger.warn(`Aprobación rechazada para "${step}".`, 'AUTONOMY');
        resolve({ approved: false, timedOut: false });
      } else {
        eventBus.emitEvent(EVENT_TYPES.AUTONOMY_APPROVED, {
          metadata: { step, description, requestId, ...metadata },
        });
        logger.info(`Aprobado por el usuario para "${step}".`, 'AUTONOMY');
        resolve({ approved: true, timedOut: false });
      }
    });
  });
}
