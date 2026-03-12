#!/usr/bin/env node

import { createInterface } from 'readline/promises';
import { stdin, stdout } from 'process';
import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ═══════════════════════════════════════════
// ANSI Colors (sin dependencias externas)
// ═══════════════════════════════════════════
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

function log(msg = '') { console.log(msg); }
function ok(msg) { log(`  ${c.green}✓${c.reset} ${msg}`); }
function fail(msg) { log(`  ${c.red}✗${c.reset} ${msg}`); }
function warn(msg) { log(`  ${c.yellow}⚠${c.reset} ${msg}`); }
function step(n, total, msg) { log(`\n${c.bold}[${n}/${total}]${c.reset} ${c.cyan}${msg}${c.reset}`); }
function header(msg) { log(`\n${c.bold}${c.cyan}${msg}${c.reset}`); }
function section(msg) { log(`\n  ${c.magenta}── ${msg} ──${c.reset}`); }

// ═══════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════

function cliVersion(cmd) {
  try {
    return execSync(`${cmd} --version`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 3000,
      shell: true,
    }).trim().split('\n')[0];
  } catch {
    try {
      const checkCmd = process.platform === 'win32' ? 'where' : 'which';
      execSync(`${checkCmd} ${cmd}`, { stdio: 'pipe', encoding: 'utf-8', timeout: 3000 });
      return `${cmd} (installed)`;
    } catch {
      return null;
    }
  }
}

function loadExistingEnv() {
  const envPath = resolve(ROOT, '.env');
  if (!existsSync(envPath)) return {};
  const content = readFileSync(envPath, 'utf-8');
  const env = {};
  for (const line of content.split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match) env[match[1]] = match[2];
  }
  return env;
}

async function ask(rl, question, defaultValue = '') {
  const suffix = defaultValue ? ` ${c.dim}(${defaultValue})${c.reset}` : '';
  const answer = await rl.question(`  ${question}${suffix}: `);
  return answer.trim() || defaultValue;
}

async function askChoice(rl, question, options, defaultValue = '') {
  const optStr = options.join('/');
  const suffix = defaultValue ? ` ${c.dim}(${defaultValue})${c.reset}` : '';
  while (true) {
    const answer = await rl.question(`  ${question} [${optStr}]${suffix}: `);
    const value = answer.trim() || defaultValue;
    if (options.includes(value)) return value;
    log(`  ${c.red}Opción no válida. Elige: ${optStr}${c.reset}`);
  }
}

async function askYesNo(rl, question, defaultYes = true) {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  const answer = await rl.question(`  ${question} ${c.dim}(${hint})${c.reset}: `);
  const val = answer.trim().toLowerCase();
  if (val === '') return defaultYes;
  return val === 'y' || val === 'yes' || val === 'si' || val === 'sí';
}

async function askNumber(rl, question, defaultValue, min = 0, max = Infinity) {
  const suffix = ` ${c.dim}(${defaultValue})${c.reset}`;
  while (true) {
    const answer = await rl.question(`  ${question}${suffix}: `);
    const val = answer.trim() || String(defaultValue);
    const num = parseFloat(val);
    if (!isNaN(num) && num >= min && num <= max) return num;
    log(`  ${c.red}Debe ser un número entre ${min} y ${max}${c.reset}`);
  }
}

// ═══════════════════════════════════════════
// Wizard
// ═══════════════════════════════════════════

const TOTAL_STEPS = 12;

async function main() {
  const rl = createInterface({ input: stdin, output: stdout });
  const existing = loadExistingEnv();

  // Banner
  log(`\n${c.bold}${c.green}  🦎 Komodo Setup Wizard${c.reset}`);
  log(`${c.dim}  ─────────────────────────${c.reset}`);
  log(`${c.dim}  Configura tu orquestador de agentes IA${c.reset}`);

  // ═══════════════════════════════════════════
  // Step 1: Prerequisites
  // ═══════════════════════════════════════════
  step(1, TOTAL_STEPS, 'Verificando requisitos...');

  const nodeVer = cliVersion('node');
  if (nodeVer) ok(`Node.js ${nodeVer}`);
  else { fail('Node.js no encontrado'); process.exit(1); }

  const gitVer = cliVersion('git');
  if (gitVer) ok(`git ${gitVer}`);
  else { fail('git no encontrado'); process.exit(1); }

  const ghVer = cliVersion('gh');
  if (ghVer) ok(`gh CLI ${ghVer}`);
  else warn('gh CLI no encontrado (instalar: https://cli.github.com/)');

  // Detect AI CLIs
  const availableClis = [];
  for (const cli of ['claude', 'codex', 'gemini']) {
    const ver = cliVersion(cli);
    if (ver) {
      ok(`${cli} CLI detectado`);
      availableClis.push(cli);
    } else {
      warn(`${cli} CLI no encontrado`);
    }
  }

  if (availableClis.length === 0) {
    fail('Ningún CLI de IA detectado. Instala al menos uno: claude, codex o gemini');
    process.exit(1);
  }

  // ═══════════════════════════════════════════
  // Step 2: Agent CLIs
  // ═══════════════════════════════════════════
  step(2, TOTAL_STEPS, 'Configurando agentes...');
  log(`${c.dim}  CLIs disponibles: ${availableClis.join(', ')}${c.reset}`);

  const cliPlanner = await askChoice(rl, 'CLI para Planner', availableClis, existing.CLI_PLANNER || availableClis[0]);
  const cliCoder = await askChoice(rl, 'CLI para Coder', availableClis, existing.CLI_CODER || availableClis[0]);
  const cliReviewer = await askChoice(rl, 'CLI para Reviewer', availableClis, existing.CLI_REVIEWER || availableClis[0]);

  // ═══════════════════════════════════════════
  // Step 3: Firebase
  // ═══════════════════════════════════════════
  step(3, TOTAL_STEPS, 'Configurando Firebase...');

  const defaultCreds = existing.GOOGLE_APPLICATION_CREDENTIALS || './serviceAccountKey.json';
  const googleCreds = await ask(rl, 'Ruta a serviceAccountKey.json', defaultCreds);

  if (!existsSync(resolve(ROOT, googleCreds))) {
    warn(`Archivo no encontrado: ${googleCreds}`);
  } else {
    ok('Credenciales encontradas');
  }

  const defaultDbUrl = existing.FIREBASE_DATABASE_URL || '';
  const firebaseUrl = await ask(rl, 'Firebase Database URL', defaultDbUrl);

  // ═══════════════════════════════════════════
  // Step 4: User identity
  // ═══════════════════════════════════════════
  step(4, TOTAL_STEPS, 'Configurando identidad...');

  const userId = await ask(rl, 'Tu User ID (Firebase UID)', existing.DEFAULT_USER_ID || '');
  const userName = await ask(rl, 'Tu nombre', existing.DEFAULT_USER_NAME || '');

  if (!userId) warn('Sin User ID — algunas operaciones no funcionarán');

  // ═══════════════════════════════════════════
  // Step 5: GitHub
  // ═══════════════════════════════════════════
  step(5, TOTAL_STEPS, 'Configurando GitHub...');

  let ghAuthed = false;
  try {
    execSync('gh auth status', { stdio: 'pipe', encoding: 'utf-8', shell: true });
    ghAuthed = true;
    ok('gh CLI ya autenticado');
  } catch {
    warn('gh CLI no autenticado (ejecuta: gh auth login)');
  }

  let githubToken = '';
  if (!ghAuthed) {
    githubToken = await ask(rl, 'GitHub token (ghp_...)', existing.GITHUB_TOKEN || '');
  } else {
    log(`${c.dim}  Token opcional (gh CLI ya autenticado)${c.reset}`);
  }

  // GitHub Issue Sync
  section('GitHub Issue Sync');
  const githubIssueSync = await askYesNo(rl, 'Sincronizar GitHub Issues al backlog?', existing.GITHUB_ISSUE_SYNC === 'true');
  let githubIssueRepo = '';
  let githubIssuePollMinutes = '5';
  let githubIssueLabel = 'komodo';

  if (githubIssueSync) {
    githubIssueRepo = await ask(rl, 'Repositorio (owner/repo)', existing.GITHUB_ISSUE_REPO || '');
    githubIssuePollMinutes = await ask(rl, 'Intervalo de polling (minutos)', existing.GITHUB_ISSUE_POLL_MINUTES || '5');
    githubIssueLabel = await ask(rl, 'Label que activa sync', existing.GITHUB_ISSUE_LABEL || 'komodo');
  }

  // ═══════════════════════════════════════════
  // Step 6: Basic Preferences
  // ═══════════════════════════════════════════
  step(6, TOTAL_STEPS, 'Preferencias básicas...');

  const projectId = await ask(rl, 'Project ID del backlog', existing.DEFAULT_PROJECT_ID || '');
  const autoMerge = await askYesNo(rl, 'Auto-merge PRs aprobadas?', existing.AUTO_MERGE !== 'false');
  const maxCycles = await askNumber(rl, 'Máximo rondas de review', existing.MAX_REVIEW_CYCLES || 5, 1, 10);

  section('Tests y CI');
  const prePrTests = await askYesNo(rl, 'Ejecutar tests antes de abrir PRs?', existing.PRE_PR_TESTS !== 'false');
  let prePrTestCmd = 'auto';
  if (prePrTests) {
    prePrTestCmd = await ask(rl, 'Comando de tests (auto = detectar)', existing.PRE_PR_TEST_CMD || 'auto');
  }

  const ciMonitor = await askYesNo(rl, 'Monitorear GitHub Actions después de merge?', existing.CI_MONITOR === 'true');
  let ciMonitorTimeout = '15';
  let autoRevert = false;
  if (ciMonitor) {
    ciMonitorTimeout = await ask(rl, 'Timeout CI (minutos)', existing.CI_MONITOR_TIMEOUT_MINUTES || '15');
    autoRevert = await askYesNo(rl, 'Auto-revert si CI falla?', existing.AUTO_REVERT === 'true');
  }

  // ═══════════════════════════════════════════
  // Step 7: Budget
  // ═══════════════════════════════════════════
  step(7, TOTAL_STEPS, 'Configurando presupuesto...');
  log(`${c.dim}  Limita el gasto de API para evitar sorpresas${c.reset}`);

  const dailyBudget = await askNumber(rl, 'Presupuesto diario USD (0 = sin límite)', existing.DAILY_BUDGET_USD || 10, 0);
  const weeklyBudget = await askNumber(rl, 'Presupuesto semanal USD (0 = sin límite)', existing.WEEKLY_BUDGET_USD || 50, 0);
  const budgetWarning = await askNumber(rl, 'Umbral de aviso (0-1, ej: 0.8 = 80%)', existing.BUDGET_WARNING_THRESHOLD || 0.8, 0, 1);

  // ═══════════════════════════════════════════
  // Step 8: Rate Limit & Fallback
  // ═══════════════════════════════════════════
  step(8, TOTAL_STEPS, 'Rate limit y fallback...');

  const rateLimitFallback = await askYesNo(rl, 'Auto-fallback a otro CLI si hay rate limit?', existing.RATE_LIMIT_FALLBACK !== 'false');
  let fallbackOrder = 'claude,codex,gemini';
  let cooldownMinutes = '15';

  if (rateLimitFallback) {
    fallbackOrder = await ask(rl, 'Orden de fallback (separado por coma)', existing.FALLBACK_CLI_ORDER || 'claude,codex,gemini');
    cooldownMinutes = await ask(rl, 'Cooldown antes de reintentar (minutos)', existing.RATE_LIMIT_COOLDOWN_MINUTES || '15');
  }

  // Complexity thresholds
  section('Clasificación de complejidad');
  log(`${c.dim}  Score 1-10: trivial, standard, complex${c.reset}`);
  const trivialMax = await askNumber(rl, 'Score máximo para "trivial"', existing.COMPLEXITY_TRIVIAL_MAX || 3, 1, 9);
  const standardMax = await askNumber(rl, 'Score máximo para "standard"', existing.COMPLEXITY_STANDARD_MAX || 6, trivialMax + 1, 9);

  // ═══════════════════════════════════════════
  // Step 9: WebSocket & API Server
  // ═══════════════════════════════════════════
  step(9, TOTAL_STEPS, 'Servidores...');

  const wsPort = await ask(rl, 'Puerto WebSocket (dashboard)', existing.WS_PORT || '3001');

  section('API Server (control externo)');
  const apiServer = await askYesNo(rl, 'Habilitar API HTTP REST?', existing.API_SERVER === 'true');
  let apiPort = '3002';
  let komodoApiKey = '';

  if (apiServer) {
    apiPort = await ask(rl, 'Puerto API', existing.API_PORT || '3002');
    komodoApiKey = await ask(rl, 'API Key (header X-Komodo-Key)', existing.KOMODO_API_KEY || '');
    if (!komodoApiKey) warn('Sin API Key — cualquiera puede controlar Komodo');
  }

  // ═══════════════════════════════════════════
  // Step 10: Browser MCP
  // ═══════════════════════════════════════════
  step(10, TOTAL_STEPS, 'Browser MCP (Chrome DevTools)...');
  log(`${c.dim}  Permite a los agentes inspeccionar el navegador${c.reset}`);

  const enableBrowser = await askYesNo(rl, 'Habilitar Chrome DevTools MCP?', existing.ENABLE_BROWSER_MCP === 'true');
  let chromePort = '9222';

  if (enableBrowser) {
    chromePort = await ask(rl, 'Puerto Chrome debugging', existing.CHROME_DEBUGGER_PORT || '9222');
    log(`${c.dim}  Lanza Chrome con: --remote-debugging-port=${chromePort}${c.reset}`);
  }

  // ═══════════════════════════════════════════
  // Step 11: Telegram
  // ═══════════════════════════════════════════
  step(11, TOTAL_STEPS, 'Telegram Bot...');

  const enableTelegram = await askYesNo(rl, 'Habilitar notificaciones por Telegram?', existing.ENABLE_TELEGRAM === 'true');
  let telegramToken = '';
  let telegramChatId = '';
  let telegramAllowedUsers = '';
  let telegramTimeout = '120000';

  if (enableTelegram) {
    telegramToken = await ask(rl, 'Bot Token (de @BotFather)', existing.TELEGRAM_BOT_TOKEN || '');
    telegramChatId = await ask(rl, 'Chat ID principal', existing.TELEGRAM_CHAT_ID || '');
    telegramAllowedUsers = await ask(rl, 'User IDs autorizados (separados por coma)', existing.TELEGRAM_ALLOWED_USERS || '');
    telegramTimeout = await ask(rl, 'Timeout Claude (ms)', existing.TELEGRAM_CLAUDE_TIMEOUT || '120000');
  }

  // ═══════════════════════════════════════════
  // Step 12: SonarQube & Plugins
  // ═══════════════════════════════════════════
  step(12, TOTAL_STEPS, 'SonarQube y Plugins...');

  let enableSonar = false;
  let sonarToken = '';
  let sonarHostUrl = '';
  let sonarProjectKey = '';
  let sonarOrganization = '';

  const wantsSonar = await askYesNo(rl, 'Configurar análisis estático con SonarQube?', existing.ENABLE_SONAR === 'true');

  if (wantsSonar) {
    sonarHostUrl = await ask(rl, 'SonarQube URL (ej: https://sonarcloud.io)', existing.SONAR_HOST_URL || '');
    sonarProjectKey = await ask(rl, 'Project key', existing.SONAR_PROJECT_KEY || '');
    sonarToken = await ask(rl, 'Token de autenticación', existing.SONAR_TOKEN || '');

    if (sonarHostUrl.includes('sonarcloud.io')) {
      sonarOrganization = await ask(rl, 'Organización (requerido para SonarCloud)', existing.SONAR_ORGANIZATION || '');
    }

    if (sonarToken && sonarHostUrl && sonarProjectKey) {
      enableSonar = true;
      ok('SonarQube configurado');
    } else {
      warn('Configuración incompleta — SonarQube deshabilitado');
    }
  }

  section('Plugins');
  const pluginsDir = await ask(rl, 'Directorio de plugins', existing.PLUGINS_DIR || './plugins');
  const enabledPlugins = await ask(rl, 'Plugins habilitados (separados por coma, vacío = ninguno)', existing.ENABLED_PLUGINS || '');

  rl.close();

  // ═══════════════════════════════════════════
  // Generar archivos
  // ═══════════════════════════════════════════

  header('Generando configuración...');

  // .env
  const envContent = `# ═══════════════════════════════════════════
# Komodo - Generado por setup wizard
# ═══════════════════════════════════════════

# ═══════════════════════════════════════════
# CLIs de Agentes
# ═══════════════════════════════════════════
CLI_PLANNER=${cliPlanner}
CLI_CODER=${cliCoder}
CLI_REVIEWER=${cliReviewer}

# ═══════════════════════════════════════════
# Firebase
# ═══════════════════════════════════════════
GOOGLE_APPLICATION_CREDENTIALS=${googleCreds}
FIREBASE_DATABASE_URL=${firebaseUrl}

# ═══════════════════════════════════════════
# Usuario
# ═══════════════════════════════════════════
DEFAULT_USER_ID=${userId}
DEFAULT_USER_NAME=${userName}

# ═══════════════════════════════════════════
# GitHub
# ═══════════════════════════════════════════
GITHUB_TOKEN=${githubToken}
GITHUB_ISSUE_SYNC=${githubIssueSync}
GITHUB_ISSUE_REPO=${githubIssueRepo}
GITHUB_ISSUE_POLL_MINUTES=${githubIssuePollMinutes}
GITHUB_ISSUE_LABEL=${githubIssueLabel}

# ═══════════════════════════════════════════
# Komodo Config
# ═══════════════════════════════════════════
DEFAULT_PROJECT_ID=${projectId}
AUTO_MERGE=${autoMerge}
MAX_REVIEW_CYCLES=${maxCycles}

# Tests y CI
PRE_PR_TESTS=${prePrTests}
PRE_PR_TEST_CMD=${prePrTestCmd}
CI_MONITOR=${ciMonitor}
CI_MONITOR_TIMEOUT_MINUTES=${ciMonitorTimeout}
AUTO_REVERT=${autoRevert}

# Context affinity (boost para tareas relacionadas, 0-1)
CONTEXT_AFFINITY_BOOST=0.2

# ═══════════════════════════════════════════
# Budget Manager
# ═══════════════════════════════════════════
DAILY_BUDGET_USD=${dailyBudget}
WEEKLY_BUDGET_USD=${weeklyBudget}
BUDGET_WARNING_THRESHOLD=${budgetWarning}
ESTIMATED_COST_PER_INVOCATION=0.05

# ═══════════════════════════════════════════
# Rate Limit & Fallback
# ═══════════════════════════════════════════
RATE_LIMIT_FALLBACK=${rateLimitFallback}
FALLBACK_CLI_ORDER=${fallbackOrder}
RATE_LIMIT_COOLDOWN_MINUTES=${cooldownMinutes}

# Complexity classification (score 1-10)
COMPLEXITY_TRIVIAL_MAX=${trivialMax}
COMPLEXITY_STANDARD_MAX=${standardMax}

# ═══════════════════════════════════════════
# Servidores
# ═══════════════════════════════════════════
WS_PORT=${wsPort}
API_SERVER=${apiServer}
API_PORT=${apiPort}
KOMODO_API_KEY=${komodoApiKey}

# ═══════════════════════════════════════════
# Browser MCP
# ═══════════════════════════════════════════
ENABLE_BROWSER_MCP=${enableBrowser}
CHROME_DEBUGGER_PORT=${chromePort}

# ═══════════════════════════════════════════
# Telegram
# ═══════════════════════════════════════════
ENABLE_TELEGRAM=${enableTelegram}
TELEGRAM_BOT_TOKEN=${telegramToken}
TELEGRAM_CHAT_ID=${telegramChatId}
TELEGRAM_ALLOWED_USERS=${telegramAllowedUsers}
TELEGRAM_CLAUDE_TIMEOUT=${telegramTimeout}

# ═══════════════════════════════════════════
# SonarQube
# ═══════════════════════════════════════════
ENABLE_SONAR=${enableSonar}
SONAR_TOKEN=${sonarToken}
SONAR_HOST_URL=${sonarHostUrl}
SONAR_PROJECT_KEY=${sonarProjectKey}
SONAR_ORGANIZATION=${sonarOrganization}

# ═══════════════════════════════════════════
# Plugins
# ═══════════════════════════════════════════
PLUGINS_DIR=${pluginsDir}
ENABLED_PLUGINS=${enabledPlugins}

# ═══════════════════════════════════════════
# Model Selection (opcional - descomentar para personalizar)
# ═══════════════════════════════════════════
# Formato: trivialModel,standardModel,complexModel
#MODEL_MAP_CLAUDE_PLANNER=sonnet,sonnet,opus
#MODEL_MAP_CLAUDE_CODER=sonnet,sonnet,opus
#MODEL_MAP_CLAUDE_REVIEWER=haiku,sonnet,sonnet
#MODEL_MAP_CODEX_PLANNER=codex-mini,o4-mini,o3
#MODEL_MAP_CODEX_CODER=codex-mini,o4-mini,o3
#MODEL_MAP_CODEX_REVIEWER=codex-mini,o4-mini,o3
#MODEL_MAP_GEMINI_PLANNER=gemini-3-flash,gemini-3-flash,gemini-3-flash
#MODEL_MAP_GEMINI_CODER=gemini-3-flash,gemini-3-flash,gemini-3.1-pro
#MODEL_MAP_GEMINI_REVIEWER=gemini-3-flash,gemini-3-flash,gemini-3.1-pro

# Override global (fuerza modelo específico ignorando complejidad)
#FORCE_MODEL_PLANNER=
#FORCE_MODEL_CODER=
#FORCE_MODEL_REVIEWER=
#FORCE_MODEL_SECURITY=

# Security Agent
#SECURITY_AGENT=true
#CLI_SECURITY=claude

# ═══════════════════════════════════════════
# Scheduler (ventanas de ejecución)
# ═══════════════════════════════════════════
# Formato: HH:MM-HH:MM (soporta cruce de medianoche)
# Vacío = ejecución 24/7
#SCHEDULE=02:00-06:00,14:00-18:00
#SCHEDULE_TIMEZONE=Europe/Madrid
`;

  writeFileSync(resolve(ROOT, '.env'), envContent);
  ok('.env creado');

  // ═══════════════════════════════════════════
  // npm install
  // ═══════════════════════════════════════════

  header('Instalando dependencias...');

  // Root
  try {
    execSync('npm install', { cwd: ROOT, stdio: 'inherit', shell: true });
    ok('Dependencias del proyecto instaladas');
  } catch {
    warn('Error en npm install. Ejecuta manualmente: npm install');
  }

  // MCPs
  for (const mcp of ['planning-task-mcp', 'github-mcp', 'memory-mcp', 'komodo-mcp']) {
    const mcpDir = resolve(ROOT, 'skills', mcp);
    if (existsSync(resolve(mcpDir, 'package.json'))) {
      try {
        execSync('npm install', { cwd: mcpDir, stdio: 'inherit', shell: true });
        ok(`${mcp} instalado`);
      } catch {
        warn(`Error en ${mcp}. Ejecuta: cd skills/${mcp} && npm install`);
      }
    }
  }

  // ═══════════════════════════════════════════
  // Slash command para Claude Code
  // ═══════════════════════════════════════════

  if (availableClis.includes('claude')) {
    const slashCmd = [
      `Lee el archivo ${resolve(ROOT, 'KOMODO.md')} para entender los comandos disponibles de Komodo.`,
      '',
      'Interpreta lo que el usuario pide y ejecuta el comando correspondiente usando Bash.',
      '',
      'Solicitud del usuario: $ARGUMENTS',
    ].join('\n');

    // Global: ~/.claude/commands/ (funciona desde cualquier carpeta)
    const homeDir = process.env.HOME || process.env.USERPROFILE;
    const globalCmdDir = resolve(homeDir, '.claude', 'commands');
    mkdirSync(globalCmdDir, { recursive: true });
    writeFileSync(resolve(globalCmdDir, 'komodo.md'), slashCmd);
    ok('Slash command /komodo instalado globalmente en Claude Code');

    // Local: proyecto/.claude/commands/ (backup por si acaso)
    const localCmdDir = resolve(ROOT, '.claude', 'commands');
    mkdirSync(localCmdDir, { recursive: true });
    writeFileSync(resolve(localCmdDir, 'komodo.md'), slashCmd);
  }

  // ═══════════════════════════════════════════
  // Komodo MCP para Claude Code
  // ═══════════════════════════════════════════

  if (availableClis.includes('claude')) {
    const mcpConfigPath = resolve(ROOT, 'skills', 'komodo-mcp', 'src', 'index.js').replace(/\\/g, '/');
    if (existsSync(mcpConfigPath)) {
      // Registrar komodo-mcp globalmente via claude mcp add (scope user → ~/.claude.json)
      try {
        execSync(
          `claude mcp add -s user -e KOMODO_ROOT="${ROOT.replace(/\\/g, '/')}" -- komodo-mcp node "${mcpConfigPath}"`,
          { stdio: 'pipe' }
        );
        ok('komodo-mcp registrado globalmente (claude mcp add -s user)');
      } catch (err) {
        // Si ya existe, intentar remover y re-agregar
        try {
          execSync('claude mcp remove -s user komodo-mcp', { stdio: 'pipe' });
          execSync(
            `claude mcp add -s user -e KOMODO_ROOT="${ROOT.replace(/\\/g, '/')}" -- komodo-mcp node "${mcpConfigPath}"`,
            { stdio: 'pipe' }
          );
          ok('komodo-mcp actualizado globalmente (claude mcp add -s user)');
        } catch (err2) {
          warn(`No se pudo registrar komodo-mcp: ${err2.message}`);
        }
      }
    }

    // ═══════════════════════════════════════════
    // Auto-approve komodo-mcp tools (no permission prompts)
    // ═══════════════════════════════════════════
    const settingsDir = resolve(ROOT, '.claude');
    mkdirSync(settingsDir, { recursive: true });
    const settingsPath = resolve(settingsDir, 'settings.local.json');

    let settings = {};
    if (existsSync(settingsPath)) {
      try {
        settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      } catch {
        settings = {};
      }
    }

    if (!settings.permissions) settings.permissions = {};
    if (!Array.isArray(settings.permissions.allow)) settings.permissions.allow = [];

    // All komodo-mcp tool permissions
    const komodoPermissions = [
      'mcp__komodo-mcp__komodo_plan',
      'mcp__komodo-mcp__komodo_code',
      'mcp__komodo-mcp__komodo_review',
      'mcp__komodo-mcp__komodo_fix',
      'mcp__komodo-mcp__komodo_finalize',
      'mcp__komodo-mcp__komodo_run',
      'mcp__komodo-mcp__komodo_resume',
      'mcp__komodo-mcp__komodo_status',
    ];

    for (const perm of komodoPermissions) {
      if (!settings.permissions.allow.includes(perm)) {
        settings.permissions.allow.push(perm);
      }
    }

    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    ok('Permisos de komodo-mcp auto-aprobados (sin prompts)');
  }

  // ═══════════════════════════════════════════
  // Resumen
  // ═══════════════════════════════════════════

  log(`\n${c.bold}${c.green}  🦎 Komodo configurado!${c.reset}\n`);
  log(`  ${c.bold}Configuración:${c.reset}`);
  log(`    Proyecto:     ${projectId || c.dim + '(no configurado)' + c.reset}`);
  log(`    Planner:      ${cliPlanner}`);
  log(`    Coder:        ${cliCoder}`);
  log(`    Reviewer:     ${cliReviewer}`);
  log(`    Auto-merge:   ${autoMerge ? 'sí' : 'no'}`);
  log(`    Max cycles:   ${maxCycles}`);
  log(`    Budget:       $${dailyBudget}/día, $${weeklyBudget}/semana`);
  log('');
  log(`  ${c.bold}Servicios:${c.reset}`);
  log(`    WebSocket:    puerto ${wsPort}`);
  if (apiServer) log(`    API Server:   puerto ${apiPort}`);
  if (enableBrowser) log(`    Browser MCP:  puerto ${chromePort}`);
  if (enableTelegram) log(`    Telegram:     habilitado`);
  if (enableSonar) log(`    SonarQube:    ${sonarHostUrl}`);
  log('');
  log(`  ${c.bold}Para ejecutar:${c.reset}`);
  log(`  ${c.cyan}node src/index.js run${projectId ? '' : ' -p <PROJECT_ID>'}${c.reset}`);

  if (availableClis.includes('claude')) {
    log('');
    log(`  ${c.bold}Desde Claude Code:${c.reset}`);
    log(`  ${c.cyan}/komodo ejecuta 3 tareas${c.reset}`);
    log(`  ${c.dim}o escribe en lenguaje natural: "hazme 3 tareas de komodo"${c.reset}`);
  }

  log('');
}

export { main as runSetup };

// Si se ejecuta directamente: node src/setup.js
const isDirectRun = process.argv[1] && resolve(process.argv[1]) === resolve(__dirname, 'setup.js');
if (isDirectRun) {
  main().catch(err => {
    console.error(`\n${c.red}Error: ${err.message}${c.reset}`);
    process.exit(1);
  });
}
