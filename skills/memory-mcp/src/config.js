import { existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..', '..', '..');

export const MEMORY_DIR = resolve(ROOT_DIR, 'memory');
export const PATTERNS_FILE = resolve(MEMORY_DIR, 'patterns.json');

/**
 * Valida que el directorio de memoria exista (lo crea si no).
 * @returns {string[]} Array de errores (vacío si todo OK)
 */
export function validateConfig() {
  const errors = [];

  try {
    if (!existsSync(MEMORY_DIR)) {
      mkdirSync(MEMORY_DIR, { recursive: true });
    }
  } catch (err) {
    errors.push(`No se pudo crear el directorio de memoria (${MEMORY_DIR}): ${err.message}`);
  }

  return errors;
}
