import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { config, cliExists } from '../config.js';
import { logger } from '../utils/logger.js';

// ═══════════════════════════════════════════
// Status constants
// ═══════════════════════════════════════════

export const STATUS = {
  OK: 'OK',
  FAIL: 'FAIL',
  WARN: 'WARN',
};

// ═══════════════════════════════════════════
// Individual checks
// ═══════════════════════════════════════════

/**
 * Verifica que los CLIs de agentes IA estén instalados.
 * @returns {Object[]} Array de resultados { name, status, message }
 */
export function checkAgentClis() {
  const roles = [
    { key: 'cliPlanner', role: 'Planner' },
    { key: 'cliCoder', role: 'Coder' },
    { key: 'cliReviewer', role: 'Reviewer' },
  ];

  const results = [];
  const checked = new Set();

  for (const { key, role } of roles) {
    const cli = config[key];
    if (checked.has(cli)) continue;
    checked.add(cli);

    const found = cliExists(cli);
    results.push({
      name: `CLI: ${cli} (${roles.filter(r => config[r.key] === cli).map(r => r.role).join(', ')})`,
      status: found ? STATUS.OK : STATUS.FAIL,
      message: found ? 'instalado' : `no encontrado en PATH`,
    });
  }

  return results;
}

/**
 * Verifica que el CLI de GitHub esté instalado y autenticado.
 * @returns {Object[]}
 */
export function checkGitHubCli() {
  const results = [];

  const ghInstalled = cliExists('gh');
  results.push({
    name: 'CLI: gh (GitHub)',
    status: ghInstalled ? STATUS.OK : STATUS.FAIL,
    message: ghInstalled ? 'instalado' : 'no encontrado — instalar: https://cli.github.com/',
  });

  if (ghInstalled) {
    try {
      execSync('gh auth status', { stdio: 'pipe', encoding: 'utf-8', shell: true });
      results.push({
        name: 'GitHub auth',
        status: STATUS.OK,
        message: 'autenticado',
      });
    } catch {
      results.push({
        name: 'GitHub auth',
        status: STATUS.FAIL,
        message: 'no autenticado — ejecuta: gh auth login',
      });
    }
  }

  return results;
}

/**
 * Verifica que el repo actual sea accesible vía gh.
 * @returns {Object}
 */
export function checkRepoAccess() {
  try {
    execSync('gh repo view --json name', { stdio: 'pipe', encoding: 'utf-8', shell: true });
    return {
      name: 'Repo accesible (gh)',
      status: STATUS.OK,
      message: 'repositorio detectado',
    };
  } catch {
    return {
      name: 'Repo accesible (gh)',
      status: STATUS.WARN,
      message: 'no se pudo acceder al repo — verifica que estés en un repo git con remote',
    };
  }
}

/**
 * Verifica las variables de Firebase.
 * @returns {Object[]}
 */
export function checkFirebase() {
  const results = [];

  // Credentials file
  if (!config.googleCredentials) {
    results.push({
      name: 'Firebase: GOOGLE_APPLICATION_CREDENTIALS',
      status: STATUS.FAIL,
      message: 'variable no configurada en .env',
    });
  } else if (!existsSync(config.googleCredentials)) {
    results.push({
      name: 'Firebase: GOOGLE_APPLICATION_CREDENTIALS',
      status: STATUS.FAIL,
      message: `archivo no encontrado: ${config.googleCredentials}`,
    });
  } else {
    results.push({
      name: 'Firebase: GOOGLE_APPLICATION_CREDENTIALS',
      status: STATUS.OK,
      message: 'archivo existe',
    });
  }

  // Database URL
  results.push({
    name: 'Firebase: FIREBASE_DATABASE_URL',
    status: config.firebaseDatabaseUrl ? STATUS.OK : STATUS.FAIL,
    message: config.firebaseDatabaseUrl ? 'configurada' : 'variable no configurada en .env',
  });

  // User ID
  results.push({
    name: 'Firebase: DEFAULT_USER_ID',
    status: config.defaultUserId ? STATUS.OK : STATUS.FAIL,
    message: config.defaultUserId ? 'configurado' : 'variable no configurada en .env',
  });

  return results;
}

/**
 * Verifica el token de GitHub.
 * @returns {Object}
 */
export function checkGitHubToken() {
  return {
    name: 'GITHUB_TOKEN',
    status: config.githubToken ? STATUS.OK : STATUS.WARN,
    message: config.githubToken ? 'configurado' : 'no configurado — algunas funciones podrían no funcionar',
  };
}

/**
 * Verifica la configuración de SonarQube (solo si está habilitado).
 * @returns {Object[]}
 */
export function checkSonar() {
  if (!config.enableSonar) {
    return [{
      name: 'SonarQube',
      status: STATUS.WARN,
      message: 'deshabilitado (ENABLE_SONAR=false)',
    }];
  }

  const results = [];
  const checks = [
    { key: 'sonarToken', label: 'SONAR_TOKEN' },
    { key: 'sonarHostUrl', label: 'SONAR_HOST_URL' },
    { key: 'sonarProjectKey', label: 'SONAR_PROJECT_KEY' },
  ];

  for (const { key, label } of checks) {
    results.push({
      name: `SonarQube: ${label}`,
      status: config[key] ? STATUS.OK : STATUS.FAIL,
      message: config[key] ? 'configurado' : 'variable no configurada en .env',
    });
  }

  return results;
}

/**
 * Verifica la configuración de Telegram (solo si está habilitado).
 * @returns {Object[]}
 */
export function checkTelegram() {
  if (!config.enableTelegram) {
    return [{
      name: 'Telegram',
      status: STATUS.WARN,
      message: 'deshabilitado (ENABLE_TELEGRAM=false)',
    }];
  }

  const results = [];
  const checks = [
    { key: 'telegramBotToken', label: 'TELEGRAM_BOT_TOKEN' },
    { key: 'telegramChatId', label: 'TELEGRAM_CHAT_ID' },
  ];

  for (const { key, label } of checks) {
    results.push({
      name: `Telegram: ${label}`,
      status: config[key] ? STATUS.OK : STATUS.FAIL,
      message: config[key] ? 'configurado' : 'variable no configurada en .env',
    });
  }

  return results;
}

// ═══════════════════════════════════════════
// Run all diagnostics
// ═══════════════════════════════════════════

/**
 * Ejecuta todos los checks de diagnóstico.
 * @returns {{ results: Object[], hasFails: boolean, hasWarns: boolean }}
 */
export function runDiagnostics() {
  const results = [
    ...checkAgentClis(),
    ...checkGitHubCli(),
    checkRepoAccess(),
    ...checkFirebase(),
    checkGitHubToken(),
    ...checkSonar(),
    ...checkTelegram(),
  ];

  const hasFails = results.some(r => r.status === STATUS.FAIL);
  const hasWarns = results.some(r => r.status === STATUS.WARN);

  return { results, hasFails, hasWarns };
}

// ═══════════════════════════════════════════
// Output formatting
// ═══════════════════════════════════════════

const STATUS_LABELS = {
  [STATUS.OK]: '[OK]',
  [STATUS.FAIL]: '[FAIL]',
  [STATUS.WARN]: '[WARN]',
};

/**
 * Imprime la checklist de diagnóstico al logger.
 * @param {{ results: Object[], hasFails: boolean, hasWarns: boolean }} diagnostics
 */
export function printDiagnostics({ results, hasFails, hasWarns }) {
  logger.taskHeader('Komodo Self-Diagnostic');

  for (const { name, status, message } of results) {
    const label = STATUS_LABELS[status];
    if (status === STATUS.OK) {
      logger.success(`  ${label}  ${name} — ${message}`, 'KOMODO');
    } else if (status === STATUS.WARN) {
      logger.warn(`  ${label} ${name} — ${message}`, 'KOMODO');
    } else {
      logger.error(`  ${label} ${name} — ${message}`, 'KOMODO');
    }
  }

  console.log('');

  if (hasFails) {
    logger.error('Diagnóstico falló — corrige los errores [FAIL] antes de continuar', 'KOMODO');
  } else if (hasWarns) {
    logger.warn('Diagnóstico OK con advertencias — Komodo puede arrancar', 'KOMODO');
  } else {
    logger.success('Diagnóstico completo — todo OK', 'KOMODO');
  }
}

/**
 * Ejecuta diagnóstico completo e imprime resultados.
 * Retorna true si puede arrancar (sin FAILs), false si hay FAILs críticos.
 * @returns {boolean}
 */
export function doctor() {
  const diagnostics = runDiagnostics();
  printDiagnostics(diagnostics);
  return !diagnostics.hasFails;
}
