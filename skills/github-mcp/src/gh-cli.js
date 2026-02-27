import { execFileSync, execSync } from 'child_process';

/**
 * Ejecuta un comando gh CLI y devuelve la salida.
 *
 * @param {string[]} args - Argumentos para gh (ej: ['pr', 'list', '--json', 'number,title'])
 * @param {object} [options]
 * @param {string} [options.cwd] - Directorio de trabajo
 * @param {boolean} [options.json] - Si true, parsea la salida como JSON
 * @param {boolean} [options.allowFailure] - Si true, no lanza error en exit code != 0
 * @returns {string|object} Salida como texto o como objeto JSON
 */
export function runGh(args, options = {}) {
  const { cwd, json = false, allowFailure = false } = options;

  try {
    const output = execFileSync('gh', args, {
      encoding: 'utf-8',
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
    }).trim();

    if (json && output) {
      try {
        return JSON.parse(output);
      } catch {
        return output;
      }
    }

    return output;
  } catch (err) {
    if (allowFailure) return null;

    const stderr = err.stderr?.toString().trim() || '';
    const message = stderr || err.message;

    // Errores conocidos con mensajes claros
    if (message.includes('not logged')) {
      throw new Error('GitHub CLI no autenticado. Ejecutar: gh auth login');
    }
    if (message.includes('Could not resolve')) {
      throw new Error(`Repositorio no encontrado: ${args.join(' ')}`);
    }
    if (message.includes('already exists')) {
      throw new Error(`Ya existe: ${message}`);
    }

    throw new Error(`gh ${args.join(' ')} falló: ${message}`);
  }
}

/**
 * Ejecuta un comando git y devuelve la salida.
 *
 * @param {string[]} args - Argumentos para git
 * @param {object} [options]
 * @param {string} [options.cwd] - Directorio de trabajo
 * @returns {string} Salida del comando
 */
export function runGit(args, options = {}) {
  const { cwd } = options;

  try {
    return execFileSync('git', args, {
      encoding: 'utf-8',
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
    }).trim();
  } catch (err) {
    const stderr = err.stderr?.toString().trim() || '';
    throw new Error(`git ${args.join(' ')} falló: ${stderr || err.message}`);
  }
}

/**
 * Ejecuta gh api y devuelve el resultado como JSON.
 *
 * @param {string} endpoint - Endpoint de la API (ej: '/repos/{owner}/{repo}/pulls/1')
 * @param {object} [options]
 * @param {string} [options.method] - Método HTTP (GET, POST, PUT, DELETE)
 * @param {object} [options.body] - Body como objeto (se convierte a JSON)
 * @param {string[]} [options.fields] - Campos -f key=value
 * @returns {object} Respuesta parseada como JSON
 */
export function runGhApi(endpoint, options = {}) {
  const { method = 'GET', body, fields = [] } = options;

  const args = ['api', endpoint, '--method', method];

  if (body) {
    args.push('--input', '-');
  }

  for (const field of fields) {
    args.push('-f', field);
  }

  try {
    const input = body ? JSON.stringify(body) : undefined;
    const output = execSync(`gh ${args.join(' ')}${input ? ` <<< '${input}'` : ''}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
      shell: true,
    }).trim();

    if (output) {
      try {
        return JSON.parse(output);
      } catch {
        return output;
      }
    }
    return null;
  } catch (err) {
    const stderr = err.stderr?.toString().trim() || '';
    throw new Error(`gh api ${endpoint} falló: ${stderr || err.message}`);
  }
}
