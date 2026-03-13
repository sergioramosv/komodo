import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { logger } from '../utils/logger.js';
import { komodoState, EXECUTION_STATES } from '../state/komodo-state.js';
import { getActiveLevel, AUTONOMY_LEVELS } from '../autonomy/autonomy-engine.js';

/**
 * Listens for SELF_HEAL_EXHAUSTED events and escalates according to the
 * active Autonomy Level:
 *
 * - SUPERVISED / SEMI_AUTONOMOUS: pause Komodo and request human intervention
 * - AUTONOMOUS: pause Komodo and log a critical error (no human gate)
 * - GUARDIAN: pause Komodo and log a critical error (no human gate)
 */
export const escalationHandler = {
  _handler: null,

  /** Register the SELF_HEAL_EXHAUSTED listener. */
  start() {
    this._handler = (payload) => {
      const { taskId, errorMessage, attempts } = payload.metadata ?? {};
      const level = getActiveLevel();

      logger.error(
        `Self-healing exhausted after ${attempts} attempt(s) for task "${taskId ?? 'unknown'}" — ${errorMessage ?? ''}`,
        'ESCALATION',
      );

      if (level === AUTONOMY_LEVELS.SUPERVISED || level === AUTONOMY_LEVELS.SEMI_AUTONOMOUS) {
        logger.warn(
          `Autonomy level "${level}": pausing Komodo and requesting human intervention.`,
          'ESCALATION',
        );
        komodoState.setExecutionState(EXECUTION_STATES.AWAITING_APPROVAL);
        eventBus.emitEvent(EVENT_TYPES.AUTONOMY_APPROVAL_REQUESTED, {
          metadata: {
            step: 'self-heal:exhausted',
            description: `Self-healing exhausted for task "${taskId ?? 'unknown'}". Manual intervention required.`,
            taskId,
            errorMessage,
            attempts,
          },
        });
      } else {
        // AUTONOMOUS / GUARDIAN — pause without human gate
        logger.error(
          `Autonomy level "${level}": pausing Komodo — manual restart required.`,
          'ESCALATION',
        );
        komodoState.setExecutionState(EXECUTION_STATES.PAUSED);
      }
    };

    eventBus.on(EVENT_TYPES.SELF_HEAL_EXHAUSTED, this._handler);
    logger.info('Escalation handler started', 'ESCALATION');
  },

  /** Remove the SELF_HEAL_EXHAUSTED listener. */
  stop() {
    if (this._handler) {
      eventBus.removeListener(EVENT_TYPES.SELF_HEAL_EXHAUSTED, this._handler);
      this._handler = null;
    }
  },
};
