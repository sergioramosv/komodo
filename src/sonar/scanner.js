import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { promisify } from 'util';
import { config, cliExists } from '../config.js';
import { logger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);
const AGENT = 'SYSTEM';

/**
 * Verifica si SonarQube está correctamente configurado.
 * @returns {{ ready: boolean, reason?: string }}
 */
export function checkSonarConfig() {
  if (!config.enableSonar) {
    return { ready: false, reason: 'ENABLE_SONAR no está habilitado' };
  }

  if (!config.sonarToken) {
    return { ready: false, reason: 'SONAR_TOKEN no configurado' };
  }

  if (!config.sonarHostUrl) {
    return { ready: false, reason: 'SONAR_HOST_URL no configurado' };
  }

  if (!config.sonarProjectKey) {
    return { ready: false, reason: 'SONAR_PROJECT_KEY no configurado' };
  }

  if (!cliExists('sonar-scanner')) {
    return { ready: false, reason: 'sonar-scanner no instalado (npm i -g sonar-scanner)' };
  }

  return { ready: true };
}

/**
 * Ejecuta sonar-scanner en el directorio especificado (async, no bloquea el event loop).
 * Degradación elegante: si SonarQube no está configurado, loguea un warning y continúa.
 *
 * Requiere SonarScanner CLI >= 5.0 cuando se usa sonar-project.properties con sintaxis ${env:VAR}.
 *
 * @param {string} [cwd] - Directorio del proyecto a analizar (default: rootDir)
 * @returns {Promise<{ success: boolean, skipped: boolean, reason?: string, output?: string }>}
 */
export async function runSonarScan(cwd) {
  const projectDir = cwd || config.rootDir;

  // Degradación elegante — si no está configurado, seguir sin error
  const check = checkSonarConfig();
  if (!check.ready) {
    logger.warn(`SonarQube omitido: ${check.reason}`, AGENT);
    return { success: false, skipped: true, reason: check.reason };
  }

  // Verificar que existe sonar-project.properties en el directorio
  const propsFile = resolve(projectDir, 'sonar-project.properties');
  if (!existsSync(propsFile)) {
    logger.warn('sonar-project.properties no encontrado, usando parámetros inline', AGENT);
  }

  logger.info('Ejecutando sonar-scanner...', AGENT);

  try {
    const args = [];

    // Si no hay sonar-project.properties, pasar parámetros inline
    if (!existsSync(propsFile)) {
      args.push(
        `-Dsonar.projectKey=${config.sonarProjectKey}`,
        `-Dsonar.host.url=${config.sonarHostUrl}`,
        `-Dsonar.token=${config.sonarToken}`,
        `-Dsonar.sources=src`,
        `-Dsonar.sourceEncoding=UTF-8`,
      );
    }

    const { stdout } = await execFileAsync('sonar-scanner', args, {
      cwd: projectDir,
      encoding: 'utf-8',
      timeout: 300000, // 5 minutos
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        SONAR_TOKEN: config.sonarToken,
        SONAR_HOST_URL: config.sonarHostUrl,
        SONAR_PROJECT_KEY: config.sonarProjectKey,
      },
    });

    logger.success('Análisis SonarQube completado', AGENT);
    return { success: true, skipped: false, output: stdout };
  } catch (err) {
    logger.error(`Error en sonar-scanner: ${err.message}`, AGENT);
    return { success: false, skipped: false, reason: err.message };
  }
}
