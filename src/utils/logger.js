import chalk from 'chalk';

const AGENT_COLORS = {
  KOMODO: chalk.magentaBright,
  PLANNER: chalk.blueBright,
  CODER: chalk.greenBright,
  REVIEWER: chalk.yellowBright,
  SYSTEM: chalk.gray,
};

function timestamp() {
  return chalk.gray(new Date().toLocaleTimeString('es-ES', { hour12: false }));
}

function agentTag(agent) {
  const colorFn = AGENT_COLORS[agent] || chalk.white;
  return colorFn(`[${agent}]`);
}

/**
 * Log de información general.
 * @param {string} message
 * @param {string} [agent='SYSTEM']
 */
export function info(message, agent = 'SYSTEM') {
  console.log(`${timestamp()} ${agentTag(agent)} ${chalk.cyan(message)}`);
}

/**
 * Log de éxito.
 * @param {string} message
 * @param {string} [agent='SYSTEM']
 */
export function success(message, agent = 'SYSTEM') {
  console.log(`${timestamp()} ${agentTag(agent)} ${chalk.green(message)}`);
}

/**
 * Log de advertencia.
 * @param {string} message
 * @param {string} [agent='SYSTEM']
 */
export function warn(message, agent = 'SYSTEM') {
  console.log(`${timestamp()} ${agentTag(agent)} ${chalk.yellow(message)}`);
}

/**
 * Log de error.
 * @param {string} message
 * @param {string} [agent='SYSTEM']
 */
export function error(message, agent = 'SYSTEM') {
  console.log(`${timestamp()} ${agentTag(agent)} ${chalk.red(message)}`);
}

/**
 * Log de paso de progreso.
 * @param {number} current - Paso actual
 * @param {number} total - Total de pasos
 * @param {string} message
 * @param {string} [agent='KOMODO']
 */
export function logStep(current, total, message, agent = 'KOMODO') {
  const progress = chalk.white(`[${current}/${total}]`);
  console.log(`${timestamp()} ${agentTag(agent)} ${progress} ${chalk.cyan(message)}`);
}

/**
 * Separador visual para nueva tarea.
 * @param {string} taskTitle
 */
export function taskHeader(taskTitle) {
  const line = chalk.gray('─'.repeat(60));
  console.log(`\n${line}`);
  console.log(`${timestamp()} ${agentTag('KOMODO')} ${chalk.whiteBright.bold(taskTitle)}`);
  console.log(`${line}\n`);
}

export const logger = { info, success, warn, error, logStep, taskHeader };
