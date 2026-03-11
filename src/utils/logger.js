import chalk from 'chalk';

const AGENT_COLORS = {
  KOMODO: chalk.magentaBright,
  PLANNER: chalk.blueBright,
  CODER: chalk.greenBright,
  REVIEWER: chalk.yellowBright,
  SONAR: chalk.cyanBright,
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

// ── Spinner for long-running operations ──

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
let spinnerInterval = null;
let spinnerFrame = 0;

/**
 * Starts a CLI spinner with a message.
 * @param {string} message
 * @param {string} [agent='SYSTEM']
 */
export function startSpinner(message, agent = 'SYSTEM') {
  stopSpinner();
  spinnerFrame = 0;
  spinnerInterval = setInterval(() => {
    const frame = chalk.cyan(SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length]);
    process.stdout.write(`\r${timestamp()} ${agentTag(agent)} ${frame} ${chalk.cyan(message)}`);
    spinnerFrame++;
  }, 80);
}

/**
 * Stops the active spinner.
 */
export function stopSpinner() {
  if (spinnerInterval) {
    clearInterval(spinnerInterval);
    spinnerInterval = null;
    process.stdout.write('\r\x1b[K'); // clear line
  }
}

/**
 * Prints a summary of SonarQube analysis results.
 * @param {Object} report - SonarReport from analyzer
 */
export function sonarSummary(report) {
  const agent = 'SONAR';
  const line = chalk.gray('─'.repeat(40));
  console.log(`${timestamp()} ${agentTag(agent)} ${line}`);
  console.log(`${timestamp()} ${agentTag(agent)} ${chalk.whiteBright.bold('SonarQube Analysis Results')}`);

  // Quality Gate
  const gateColor = report.qualityGate === 'OK' ? chalk.green : report.qualityGate === 'ERROR' ? chalk.red : chalk.yellow;
  console.log(`${timestamp()} ${agentTag(agent)}   Quality Gate: ${gateColor(report.qualityGate || 'N/A')}`);

  // Issues
  if (report.issues) {
    const { BLOCKER, CRITICAL, MAJOR, MINOR, total } = report.issues;
    const parts = [];
    if (BLOCKER > 0) parts.push(chalk.red(`${BLOCKER} blocker`));
    if (CRITICAL > 0) parts.push(chalk.red(`${CRITICAL} critical`));
    if (MAJOR > 0) parts.push(chalk.yellow(`${MAJOR} major`));
    if (MINOR > 0) parts.push(chalk.gray(`${MINOR} minor`));
    console.log(`${timestamp()} ${agentTag(agent)}   Issues: ${parts.length > 0 ? parts.join(', ') : chalk.green('none')} (${total} total)`);
  }

  // Metrics
  if (report.metrics) {
    const { bugs, vulnerabilities, code_smells, coverage } = report.metrics;
    console.log(`${timestamp()} ${agentTag(agent)}   Bugs: ${bugs} | Vulns: ${vulnerabilities} | Smells: ${code_smells} | Coverage: ${coverage}%`);
  }

  console.log(`${timestamp()} ${agentTag(agent)} ${line}`);
}

/**
 * Log de depuración (solo se muestra si DEBUG=true).
 * @param {string} message
 * @param {string} [agent='SYSTEM']
 */
export function debug(message, agent = 'SYSTEM') {
  if (process.env.DEBUG === 'true') {
    console.log(`${timestamp()} ${agentTag(agent)} ${chalk.magenta(message)}`);
  }
}

export const logger = { info, success, warn, error, logStep, taskHeader, startSpinner, stopSpinner, sonarSummary, debug };
