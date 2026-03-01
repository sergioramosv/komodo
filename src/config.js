import 'dotenv/config';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { execFileSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..');

/**
 * Detecta si un CLI está instalado en el sistema.
 * On Windows, npm installs CLIs as .cmd/.ps1 wrappers that require shell to resolve.
 * We use `where` (Windows) or `which` (Unix) to check if the command is in PATH.
 * @param {string} command
 * @returns {boolean}
 */
function cliExists(command) {
  try {
    const checkCmd = process.platform === 'win32' ? 'where' : 'which';
    execFileSync(checkCmd, [command], { stdio: 'pipe', encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

export const config = {
  // CLIs de agentes IA (terminales, NO APIs)
  // Cada agente usa un CLI real: claude, codex, gemini, etc.
  cliPlanner: process.env.CLI_PLANNER || 'claude',
  cliCoder: process.env.CLI_CODER || 'claude',
  cliReviewer: process.env.CLI_REVIEWER || 'claude',

  // Firebase (para planning-task-mcp)
  googleCredentials: process.env.GOOGLE_APPLICATION_CREDENTIALS || '',
  firebaseDatabaseUrl: process.env.FIREBASE_DATABASE_URL || '',

  // Usuario por defecto
  defaultUserId: process.env.DEFAULT_USER_ID || '',
  defaultUserName: process.env.DEFAULT_USER_NAME || '',

  // GitHub
  githubToken: process.env.GITHUB_TOKEN || '',

  // Komodo
  wsPort: parseInt(process.env.WS_PORT || '4681', 10),
  maxReviewCycles: parseInt(process.env.MAX_REVIEW_CYCLES || '5', 10),
  autoMerge: process.env.AUTO_MERGE !== 'false', // default: true
  defaultProjectId: process.env.DEFAULT_PROJECT_ID || '',

  // Paths
  rootDir: ROOT_DIR,
  memoryDir: resolve(ROOT_DIR, 'memory'),
  skillsDir: resolve(ROOT_DIR, 'skills'),
  planningMcpDir: resolve(ROOT_DIR, 'skills', 'planning-task-mcp'),
  githubMcpDir: resolve(ROOT_DIR, 'skills', 'github-mcp'),
  memoryMcpDir: resolve(ROOT_DIR, 'skills', 'memory-mcp'),
};

/**
 * Valida que las dependencias obligatorias estén configuradas.
 * @returns {string[]} Array de mensajes de error (vacío si todo OK)
 */
export function validateConfig() {
  const errors = [];

  // Verificar que al menos un CLI de IA está instalado
  const clis = [config.cliPlanner, config.cliCoder, config.cliReviewer];
  const uniqueClis = [...new Set(clis)];

  for (const cli of uniqueClis) {
    if (!cliExists(cli)) {
      errors.push(`CLI "${cli}" no encontrado. Instálalo o cambia la config en .env`);
    }
  }

  // Verificar gh CLI
  if (!cliExists('gh')) {
    errors.push('GitHub CLI (gh) no instalado. Instalar: https://cli.github.com/');
  }

  // Firebase
  if (!config.googleCredentials) {
    errors.push('GOOGLE_APPLICATION_CREDENTIALS no configurada');
  }

  if (!config.firebaseDatabaseUrl) {
    errors.push('FIREBASE_DATABASE_URL no configurada');
  }

  if (!config.defaultUserId) {
    errors.push('DEFAULT_USER_ID no configurado');
  }

  return errors;
}
