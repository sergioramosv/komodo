import { execSync, execFile } from 'child_process';
import { promisify } from 'util';
import { tmpdir } from 'os';
import { join } from 'path';
import { logger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

const AGENT = 'SECURITY';

/**
 * Verifica si un comando está disponible en el PATH.
 *
 * @param {string} cmd - Nombre del comando
 * @returns {boolean}
 */
function isCommandAvailable(cmd) {
  try {
    execSync(`${cmd} --version`, { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Mapea la severidad de npm audit al formato estándar del Security Agent.
 *
 * @param {string} severity - Severidad de npm (critical, high, moderate, low, info)
 * @returns {'CRITICAL'|'HIGH'|'MEDIUM'|'LOW'|'INFO'}
 */
function mapNpmSeverity(severity) {
  const map = {
    critical: 'CRITICAL',
    high: 'HIGH',
    moderate: 'MEDIUM',
    low: 'LOW',
    info: 'INFO',
  };
  return map[severity?.toLowerCase()] || 'LOW';
}

/**
 * Ejecuta npm audit y devuelve findings en el formato estándar del Security Agent.
 *
 * @param {Object} options
 * @param {string} [options.cwd] - Directorio del repositorio
 * @returns {Promise<{ tool: string, available: boolean, findings: Array, error?: string }>}
 */
export async function runNpmAudit({ cwd } = {}) {
  if (!isCommandAvailable('npm')) {
    logger.warn('npm no está instalado — omitiendo npm audit', AGENT);
    return { tool: 'npm-audit', available: false, findings: [] };
  }

  try {
    const { stdout: output } = await execFileAsync('npm', ['audit', '--json'], {
      cwd,
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    const auditData = JSON.parse(output.toString());
    const findings = [];

    // npm audit v7+ format: auditData.vulnerabilities is an object keyed by package name
    const vulnerabilities = auditData.vulnerabilities || {};
    for (const [pkgName, vuln] of Object.entries(vulnerabilities)) {
      const severity = mapNpmSeverity(vuln.severity);
      const via = Array.isArray(vuln.via) ? vuln.via.filter(v => typeof v === 'object') : [];
      const description = via.length > 0
        ? via.map(v => v.title || v.url || '').filter(Boolean).join('; ')
        : `Vulnerabilidad en ${pkgName}`;

      findings.push({
        severity,
        category: 'A06:2021 - Vulnerable and Outdated Components',
        description: `npm audit: ${description}`,
        file: 'package.json',
        line: null,
        tool: 'npm-audit',
        package: pkgName,
        fixAvailable: !!vuln.fixAvailable,
      });
    }

    logger.info(`npm audit: ${findings.length} vulnerabilidades encontradas`, AGENT);
    return { tool: 'npm-audit', available: true, findings };
  } catch (err) {
    // npm audit exits with non-zero when vulnerabilities are found — parse stdout anyway
    if (err.stdout) {
      try {
        const auditData = JSON.parse(err.stdout.toString());
        const vulnerabilities = auditData.vulnerabilities || {};
        const findings = [];

        for (const [pkgName, vuln] of Object.entries(vulnerabilities)) {
          const severity = mapNpmSeverity(vuln.severity);
          const via = Array.isArray(vuln.via) ? vuln.via.filter(v => typeof v === 'object') : [];
          const description = via.length > 0
            ? via.map(v => v.title || v.url || '').filter(Boolean).join('; ')
            : `Vulnerabilidad en ${pkgName}`;

          findings.push({
            severity,
            category: 'A06:2021 - Vulnerable and Outdated Components',
            description: `npm audit: ${description}`,
            file: 'package.json',
            line: null,
            tool: 'npm-audit',
            package: pkgName,
            fixAvailable: !!vuln.fixAvailable,
          });
        }

        logger.info(`npm audit: ${findings.length} vulnerabilidades encontradas`, AGENT);
        return { tool: 'npm-audit', available: true, findings };
      } catch {
        // fall through to error return
      }
    }

    logger.warn(`npm audit falló: ${err.message}`, AGENT);
    return { tool: 'npm-audit', available: true, findings: [], error: err.message };
  }
}

/**
 * Mapea la severidad de gitleaks al formato estándar del Security Agent.
 *
 * @param {string} severity - Severidad de gitleaks (critical, high, medium, low, info, warning, error)
 * @returns {'CRITICAL'|'HIGH'|'MEDIUM'|'LOW'|'INFO'}
 */
function mapGitleaksSeverity(severity) {
  const map = {
    critical: 'CRITICAL',
    high: 'HIGH',
    medium: 'MEDIUM',
    low: 'LOW',
    info: 'INFO',
    warning: 'MEDIUM',
    error: 'HIGH',
  };
  return map[severity?.toLowerCase()] || 'HIGH';
}

/**
 * Ejecuta gitleaks para detectar secrets y keys hardcodeados.
 *
 * @param {Object} options
 * @param {string} [options.cwd] - Directorio del repositorio
 * @returns {Promise<{ tool: string, available: boolean, findings: Array, error?: string }>}
 */
export async function runGitleaks({ cwd } = {}) {
  if (!isCommandAvailable('gitleaks')) {
    logger.warn('gitleaks no está instalado — omitiendo escaneo de secrets', AGENT);
    return { tool: 'gitleaks', available: false, findings: [] };
  }

  const reportPath = join(tmpdir(), 'gitleaks-report.json');

  try {
    await execFileAsync(
      'gitleaks',
      ['detect', '--source', '.', '--report-format', 'json', '--report-path', reportPath, '--no-git', '--exit-code', '0'],
      { cwd, timeout: 120_000 }
    );

    let report = [];
    try {
      const { readFileSync } = await import('fs');
      const content = readFileSync(reportPath, 'utf8');
      report = JSON.parse(content);
    } catch {
      // No report file means no leaks found
      logger.info('gitleaks: sin secrets detectados', AGENT);
      return { tool: 'gitleaks', available: true, findings: [] };
    }

    const findings = (Array.isArray(report) ? report : []).map(leak => ({
      severity: mapGitleaksSeverity(leak.Severity || 'high'),
      category: 'A02:2021 - Cryptographic Failures / Secrets Exposure',
      description: `gitleaks: ${leak.Description || leak.RuleID || 'Secret detectado'} en ${leak.File || ''}`,
      file: leak.File || null,
      line: leak.StartLine || null,
      tool: 'gitleaks',
      ruleId: leak.RuleID || null,
      match: leak.Match ? leak.Match.replace(/./g, '*').slice(0, 20) : null, // redact actual secret
    }));

    logger.info(`gitleaks: ${findings.length} secrets detectados`, AGENT);
    return { tool: 'gitleaks', available: true, findings };
  } catch (err) {
    logger.warn(`gitleaks falló: ${err.message}`, AGENT);
    return { tool: 'gitleaks', available: true, findings: [], error: err.message };
  }
}

/**
 * Mapea la severidad de semgrep al formato estándar del Security Agent.
 *
 * @param {string} severity - Severidad semgrep (ERROR, WARNING, INFO)
 * @returns {'CRITICAL'|'HIGH'|'MEDIUM'|'LOW'|'INFO'}
 */
function mapSemgrepSeverity(severity) {
  const map = {
    ERROR: 'HIGH',
    WARNING: 'MEDIUM',
    INFO: 'LOW',
  };
  return map[severity?.toUpperCase()] || 'MEDIUM';
}

/**
 * Ejecuta semgrep con reglas OWASP y devuelve findings en formato estándar.
 *
 * @param {Object} options
 * @param {string} [options.cwd] - Directorio del repositorio
 * @returns {Promise<{ tool: string, available: boolean, findings: Array, error?: string }>}
 */
export async function runSemgrep({ cwd } = {}) {
  if (!isCommandAvailable('semgrep')) {
    logger.warn('semgrep no está instalado — omitiendo análisis estático OWASP', AGENT);
    return { tool: 'semgrep', available: false, findings: [] };
  }

  try {
    const { stdout: output } = await execFileAsync(
      'semgrep',
      ['--config', 'p/owasp-top-ten', '--json', '--quiet', '.'],
      { cwd, timeout: 180_000, maxBuffer: 10 * 1024 * 1024 }
    );

    const semgrepData = JSON.parse(output.toString());
    const results = semgrepData.results || [];

    const findings = results.map(result => ({
      severity: mapSemgrepSeverity(result.extra?.severity || result.severity),
      category: result.extra?.metadata?.['owasp-category'] || 'OWASP Top 10',
      description: `semgrep: ${result.extra?.message || result.check_id || 'Regla OWASP violada'}`,
      file: result.path || null,
      line: result.start?.line || null,
      tool: 'semgrep',
      ruleId: result.check_id || null,
    }));

    logger.info(`semgrep: ${findings.length} findings con reglas OWASP`, AGENT);
    return { tool: 'semgrep', available: true, findings };
  } catch (err) {
    // semgrep exits with non-zero on findings — parse stdout anyway
    if (err.stdout) {
      try {
        const semgrepData = JSON.parse(err.stdout.toString());
        const results = semgrepData.results || [];

        const findings = results.map(result => ({
          severity: mapSemgrepSeverity(result.extra?.severity || result.severity),
          category: result.extra?.metadata?.['owasp-category'] || 'OWASP Top 10',
          description: `semgrep: ${result.extra?.message || result.check_id || 'Regla OWASP violada'}`,
          file: result.path || null,
          line: result.start?.line || null,
          tool: 'semgrep',
          ruleId: result.check_id || null,
        }));

        logger.info(`semgrep: ${findings.length} findings con reglas OWASP`, AGENT);
        return { tool: 'semgrep', available: true, findings };
      } catch {
        // fall through to error return
      }
    }

    logger.warn(`semgrep falló: ${err.message}`, AGENT);
    return { tool: 'semgrep', available: true, findings: [], error: err.message };
  }
}

/**
 * Ejecuta todas las herramientas externas de seguridad disponibles y consolida los resultados.
 *
 * Las herramientas no instaladas se omiten con un warning — el análisis continúa
 * con las disponibles (degradación elegante).
 *
 * @param {Object} options
 * @param {string} [options.cwd] - Directorio del repositorio
 * @returns {Promise<{
 *   findings: Array,
 *   toolResults: { npmAudit: Object, gitleaks: Object, semgrep: Object }
 * }>}
 */
export async function runAllExternalTools({ cwd } = {}) {
  logger.info('Ejecutando herramientas externas de seguridad...', AGENT);

  const [npmAudit, gitleaks, semgrep] = await Promise.all([
    runNpmAudit({ cwd }),
    runGitleaks({ cwd }),
    runSemgrep({ cwd }),
  ]);

  const allFindings = [
    ...npmAudit.findings,
    ...gitleaks.findings,
    ...semgrep.findings,
  ];

  const availableTools = [
    npmAudit.available && 'npm-audit',
    gitleaks.available && 'gitleaks',
    semgrep.available && 'semgrep',
  ].filter(Boolean);

  logger.info(
    `Herramientas externas completadas. Tools: [${availableTools.join(', ') || 'ninguna'}]. Total findings: ${allFindings.length}`,
    AGENT
  );

  return {
    findings: allFindings,
    toolResults: { npmAudit, gitleaks, semgrep },
  };
}
