import { execFileSync } from 'child_process';

/**
 * Valida que gh CLI esté instalado y autenticado.
 * @returns {string[]} Array de errores (vacío si todo OK)
 */
export function validateConfig() {
  const errors = [];

  // Verificar que gh está instalado
  try {
    execFileSync('gh', ['--version'], { stdio: 'pipe', encoding: 'utf-8' });
  } catch {
    errors.push('GitHub CLI (gh) no está instalado. Instalar: https://cli.github.com/');
    return errors;
  }

  // Verificar que gh está autenticado
  try {
    execFileSync('gh', ['auth', 'status'], { stdio: 'pipe', encoding: 'utf-8' });
  } catch {
    errors.push('GitHub CLI no está autenticado. Ejecutar: gh auth login');
  }

  return errors;
}
