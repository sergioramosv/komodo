import { komodoState, EXECUTION_STATES } from '../state/komodo-state.js';
import { logger } from './logger.js';

/**
 * Solicita una pausa en la ejecución actual.
 *
 * @param {string} source - 'API' | 'WS' | 'CLI'
 */
export function requestPause(source = 'system') {
  logger.info(`Pause requested via ${source}`, source);
  komodoState.setExecutionState(EXECUTION_STATES.PAUSED);
}

/**
 * Solicita una detención en la ejecución actual.
 *
 * @param {string} source - 'API' | 'WS' | 'CLI'
 */
export function requestStop(source = 'system') {
  logger.info(`Stop requested via ${source}`, source);
  komodoState.setExecutionState(EXECUTION_STATES.STOPPED);
}

/**
 * Verifica si Komodo está actualmente activo (ejecutando tareas o en daemon).
 *
 * @returns {boolean} true si está activo
 */
export function isKomodoActive() {
  return [
    EXECUTION_STATES.RUNNING,
    EXECUTION_STATES.DAEMON_RUNNING,
    EXECUTION_STATES.DAEMON_IDLE,
    EXECUTION_STATES.SCHEDULER_WAITING
  ].includes(komodoState.executionState);
}
