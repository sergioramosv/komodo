import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { runSonarScan, checkSonarConfig } from './scanner.js';

const AGENT = 'SONAR';
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 60; // 5 min max wait

/**
 * Estructura vacía de SonarReport (usada cuando SonarQube no está disponible).
 * @returns {SonarReport}
 */
function emptySonarReport(reason) {
  return {
    success: false,
    skipped: true,
    reason,
    qualityGate: null,
    issues: { BLOCKER: 0, CRITICAL: 0, MAJOR: 0, MINOR: 0, INFO: 0, total: 0 },
    issueDetails: [],
    metrics: { bugs: 0, vulnerabilities: 0, code_smells: 0, duplicated_lines_density: 0, coverage: 0 },
  };
}

/**
 * Hace una petición al API de SonarQube.
 *
 * @param {string} path - Ruta del endpoint (ej: /api/ce/activity)
 * @param {Record<string, string>} [params] - Query parameters
 * @returns {Promise<Object>} Respuesta JSON
 */
async function sonarApi(path, params = {}) {
  const url = new URL(path, config.sonarHostUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${config.sonarToken}`,
    },
  });

  if (!res.ok) {
    throw new Error(`SonarQube API ${path} respondió ${res.status}: ${res.statusText}`);
  }

  return res.json();
}

/**
 * Espera a que SonarQube termine de procesar el análisis (polling de CE tasks).
 *
 * @returns {Promise<boolean>} true si el análisis terminó exitosamente
 */
async function waitForAnalysis() {
  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
    const data = await sonarApi('/api/ce/activity', {
      component: config.sonarProjectKey,
      status: 'PENDING,IN_PROGRESS',
    });

    const pendingTasks = data.tasks || [];
    if (pendingTasks.length === 0) {
      // Verify the most recent task finished successfully
      const history = await sonarApi('/api/ce/activity', {
        component: config.sonarProjectKey,
        ps: '1',
      });
      const lastTask = (history.tasks || [])[0];
      if (lastTask && lastTask.status === 'FAILED') {
        const errorMsg = lastTask.errorMessage || 'Unknown error';
        throw new Error(`SonarQube CE task falló: ${errorMsg}`);
      }

      logger.success('Análisis SonarQube procesado', AGENT);
      return true;
    }

    logger.info(`Esperando análisis SonarQube (${attempt}/${MAX_POLL_ATTEMPTS})...`, AGENT);
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error('Timeout esperando a que SonarQube procese el análisis');
}

/**
 * Obtiene el estado del Quality Gate para el proyecto.
 *
 * @param {string} [branch] - Nombre del branch (opcional)
 * @returns {Promise<string>} Estado: 'OK', 'WARN', 'ERROR', 'NONE'
 */
async function fetchQualityGateStatus(branch) {
  const params = { projectKey: config.sonarProjectKey };
  if (branch) params.branch = branch;

  const data = await sonarApi('/api/qualitygates/project_status', params);
  return data.projectStatus?.status || 'NONE';
}

/**
 * Obtiene los issues agrupados por severidad.
 *
 * @param {string} [branch] - Nombre del branch (opcional)
 * @returns {Promise<{ BLOCKER: number, CRITICAL: number, MAJOR: number, MINOR: number, INFO: number, total: number }>}
 */
async function fetchIssuesBySeverity(branch) {
  const params = {
    componentKeys: config.sonarProjectKey,
    resolved: 'false',
    ps: '1',
    facets: 'severities',
  };
  if (branch) params.branch = branch;

  const data = await sonarApi('/api/issues/search', params);

  const counts = { BLOCKER: 0, CRITICAL: 0, MAJOR: 0, MINOR: 0, INFO: 0, total: 0 };
  const facet = (data.facets || []).find(f => f.property === 'severities');
  if (facet) {
    for (const val of facet.values) {
      if (val.val in counts) {
        counts[val.val] = val.count;
      }
    }
  }
  counts.total = data.total || 0;

  return counts;
}

/**
 * Obtiene los detalles de issues BLOCKER y CRITICAL (archivo, línea, mensaje).
 *
 * @param {string} [branch] - Nombre del branch (opcional)
 * @returns {Promise<Array<{ severity: string, file: string, line: number, message: string, rule: string }>>}
 */
async function fetchBlockerCriticalDetails(branch) {
  const params = {
    componentKeys: config.sonarProjectKey,
    resolved: 'false',
    severities: 'BLOCKER,CRITICAL',
    ps: '100',
  };
  if (branch) params.branch = branch;

  const data = await sonarApi('/api/issues/search', params);

  return (data.issues || []).map(issue => ({
    severity: issue.severity,
    file: (issue.component || '').replace(`${config.sonarProjectKey}:`, ''),
    line: issue.line || 0,
    message: issue.message || '',
    rule: issue.rule || '',
  }));
}

/**
 * Obtiene métricas clave del proyecto.
 *
 * @param {string} [branch] - Nombre del branch (opcional)
 * @returns {Promise<{ bugs: number, vulnerabilities: number, code_smells: number, duplicated_lines_density: number, coverage: number }>}
 */
async function fetchMetrics(branch) {
  const metricKeys = 'bugs,vulnerabilities,code_smells,duplicated_lines_density,coverage';
  const params = {
    component: config.sonarProjectKey,
    metricKeys,
  };
  if (branch) params.branch = branch;

  const data = await sonarApi('/api/measures/component', params);

  const metrics = { bugs: 0, vulnerabilities: 0, code_smells: 0, duplicated_lines_density: 0, coverage: 0 };
  for (const measure of data.component?.measures || []) {
    if (measure.metric in metrics) {
      metrics[measure.metric] = parseFloat(measure.value) || 0;
    }
  }

  return metrics;
}

/**
 * Ejecuta el análisis completo de SonarQube: scan → polling → parsing de resultados.
 *
 * Degradación elegante: si SonarQube no está configurado o falla,
 * devuelve un reporte vacío y el flujo continúa.
 *
 * @param {Object} options
 * @param {string} [options.branch] - Nombre del branch a analizar
 * @param {string} [options.cwd] - Directorio del proyecto
 * @param {number} [options.prNumber] - Número de PR para PR decoration en SonarCloud
 * @param {string} [options.baseBranch] - Rama base/target de la PR (default: main)
 * @returns {Promise<SonarReport>}
 *
 * @typedef {Object} SonarReport
 * @property {boolean} success - true si el análisis se completó
 * @property {boolean} skipped - true si se omitió (no configurado)
 * @property {string} [reason] - Razón si fue omitido o falló
 * @property {string|null} qualityGate - Estado del quality gate (OK, WARN, ERROR, NONE)
 * @property {{ BLOCKER: number, CRITICAL: number, MAJOR: number, MINOR: number, INFO: number, total: number }} issues
 * @property {Array<{ severity: string, file: string, line: number, message: string, rule: string }>} issueDetails - Detalles de issues BLOCKER y CRITICAL
 * @property {{ bugs: number, vulnerabilities: number, code_smells: number, duplicated_lines_density: number, coverage: number }} metrics
 */
export async function analyzeSonar({ branch, cwd, prNumber, baseBranch = 'main' } = {}) {
  // Check config first — graceful degradation
  const check = checkSonarConfig();
  if (!check.ready) {
    logger.warn(`SonarQube omitido: ${check.reason}`, AGENT);
    return emptySonarReport(check.reason);
  }

  eventBus.emitEvent(EVENT_TYPES.SONAR_ANALYSIS_START, {
    metadata: { branch, projectKey: config.sonarProjectKey },
  });

  try {
    // Step 1: Run sonar-scanner
    logger.info(`Ejecutando análisis SonarQube${branch ? ` (branch: ${branch})` : ''}...`, AGENT);
    const scanResult = await runSonarScan({ cwd, prNumber, branch, baseBranch });

    if (!scanResult.success) {
      const reason = scanResult.reason || 'sonar-scanner falló';
      logger.warn(`Scan falló: ${reason}`, AGENT);
      const report = emptySonarReport(reason);
      eventBus.emitEvent(EVENT_TYPES.SONAR_ANALYSIS_ERROR, {
        metadata: { reason, branch },
      });
      return report;
    }

    // Step 2: Wait for SonarQube to process
    logger.info('Esperando a que SonarQube procese los resultados...', AGENT);
    await waitForAnalysis();

    // Step 3: Fetch results
    const [qualityGate, issues, metrics, issueDetails] = await Promise.all([
      fetchQualityGateStatus(branch),
      fetchIssuesBySeverity(branch),
      fetchMetrics(branch),
      fetchBlockerCriticalDetails(branch),
    ]);

    const report = {
      success: true,
      skipped: false,
      qualityGate,
      issues,
      issueDetails,
      metrics,
    };

    // Log summary
    logger.success(`Quality Gate: ${qualityGate}`, AGENT);
    logger.info(`Issues: ${issues.BLOCKER} blocker, ${issues.CRITICAL} critical, ${issues.MAJOR} major`, AGENT);
    logger.info(`Metrics: ${metrics.bugs} bugs, ${metrics.vulnerabilities} vulns, ${metrics.code_smells} smells`, AGENT);

    eventBus.emitEvent(EVENT_TYPES.SONAR_ANALYSIS_COMPLETE, {
      metadata: { report },
    });

    return report;
  } catch (err) {
    logger.error(`Error en análisis SonarQube: ${err.message}`, AGENT);
    const report = emptySonarReport(err.message);

    eventBus.emitEvent(EVENT_TYPES.SONAR_ANALYSIS_ERROR, {
      metadata: { reason: err.message, branch },
    });

    return report;
  }
}
