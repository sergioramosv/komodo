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
};

function log(msg = '') { console.log(msg); }
function ok(msg) { log(`  ${c.green}✓${c.reset} ${msg}`); }
function fail(msg) { log(`  ${c.red}✗${c.reset} ${msg}`); }
function warn(msg) { log(`  ${c.yellow}⚠${c.reset} ${msg}`); }
function step(n, total, msg) { log(`\n${c.bold}[${n}/${total}]${c.reset} ${c.cyan}${msg}${c.reset}`); }
function header(msg) { log(`\n${c.bold}${c.cyan}${msg}${c.reset}`); }

// ═══════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════

function cliVersion(cmd) {
  try {
    return execSync(`${cmd} --version`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
      shell: true,
    }).trim().split('\n')[0];
  } catch {
    return null;
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

// ═══════════════════════════════════════════
// Wizard
// ═══════════════════════════════════════════

const TOTAL_STEPS = 8;

async function main() {
  const rl = createInterface({ input: stdin, output: stdout });
  const existing = loadExistingEnv();

  // Banner
  log(`\n${c.bold}${c.green}  🦎 Komodo Setup Wizard${c.reset}`);
  log(`${c.dim}  ─────────────────────────${c.reset}`);

  // ─── Step 1: Prerequisites ───────────────
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

  // ─── Step 2: Agent CLIs ──────────────────
  step(2, TOTAL_STEPS, 'Configurando agentes...');
  log(`${c.dim}  CLIs disponibles: ${availableClis.join(', ')}${c.reset}`);

  const cliPlanner = await askChoice(rl, 'CLI para Planner', availableClis, existing.CLI_PLANNER || availableClis[0]);
  const cliCoder = await askChoice(rl, 'CLI para Coder', availableClis, existing.CLI_CODER || availableClis[0]);
  const cliReviewer = await askChoice(rl, 'CLI para Reviewer', availableClis, existing.CLI_REVIEWER || availableClis[0]);

  // ─── Step 3: Firebase ────────────────────
  step(3, TOTAL_STEPS, 'Configurando Firebase...');

  const defaultCreds = existing.GOOGLE_APPLICATION_CREDENTIALS || './skills/planning-task-mcp/serviceAccountKey.json';
  const googleCreds = await ask(rl, 'Ruta a serviceAccountKey.json', defaultCreds);

  if (!existsSync(resolve(ROOT, googleCreds))) {
    warn(`Archivo no encontrado: ${googleCreds}`);
  } else {
    ok('Credenciales encontradas');
  }

  const defaultDbUrl = existing.FIREBASE_DATABASE_URL || '';
  const firebaseUrl = await ask(rl, 'Firebase Database URL', defaultDbUrl);

  // ─── Step 4: User identity ───────────────
  step(4, TOTAL_STEPS, 'Configurando identidad...');

  const userId = await ask(rl, 'Tu User ID (Firebase UID)', existing.DEFAULT_USER_ID || '');
  const userName = await ask(rl, 'Tu nombre', existing.DEFAULT_USER_NAME || '');

  if (!userId) warn('Sin User ID — algunas operaciones no funcionarán');

  // ─── Step 5: GitHub ──────────────────────
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

  // ─── Step 6: Preferences ─────────────────
  step(6, TOTAL_STEPS, 'Preferencias...');

  const autoMerge = await askYesNo(rl, 'Auto-merge PRs aprobadas?', existing.AUTO_MERGE !== 'false');
  const maxCycles = await ask(rl, 'Máximo rondas de review (1-10)', existing.MAX_REVIEW_CYCLES || '5');

  // ─── Step 7: Project ─────────────────────
  step(7, TOTAL_STEPS, 'Proyecto...');

  const projectId = await ask(rl, 'Project ID del backlog', existing.DEFAULT_PROJECT_ID || '');

  // ─── Step 8: SonarQube (opcional) ─────────
  step(8, TOTAL_STEPS, 'SonarQube (opcional)...');

  let enableSonar = false;
  let sonarToken = '';
  let sonarHostUrl = '';
  let sonarProjectKey = '';

  const wantsSonar = await askYesNo(rl, 'Configurar análisis estático con SonarQube?', existing.ENABLE_SONAR === 'true');

  if (wantsSonar) {
    sonarHostUrl = await ask(rl, 'SonarQube URL (ej: https://sonarcloud.io)', existing.SONAR_HOST_URL || '');
    sonarProjectKey = await ask(rl, 'Project key', existing.SONAR_PROJECT_KEY || '');
    sonarToken = await ask(rl, 'Token de autenticación', existing.SONAR_TOKEN || '');

    if (sonarToken && sonarHostUrl && sonarProjectKey) {
      enableSonar = true;
      ok('SonarQube configurado');
    } else {
      warn('Configuración incompleta — SonarQube deshabilitado');
    }
  } else {
    log(`${c.dim}  SonarQube omitido (puedes configurarlo después en .env)${c.reset}`);
  }

  rl.close();

  // ═══════════════════════════════════════════
  // Generar archivos
  // ═══════════════════════════════════════════

  header('Generando configuración...');

  // .env
  const envContent = [
    '# ═══════════════════════════════════════════',
    '# Komodo - Generado por setup wizard',
    '# ═══════════════════════════════════════════',
    '',
    '# CLIs de agentes (claude, codex, gemini)',
    `CLI_PLANNER=${cliPlanner}`,
    `CLI_CODER=${cliCoder}`,
    `CLI_REVIEWER=${cliReviewer}`,
    '',
    '# Firebase',
    `GOOGLE_APPLICATION_CREDENTIALS=${googleCreds}`,
    `FIREBASE_DATABASE_URL=${firebaseUrl}`,
    '',
    '# Usuario',
    `DEFAULT_USER_ID=${userId}`,
    `DEFAULT_USER_NAME=${userName}`,
    '',
    '# GitHub',
    `GITHUB_TOKEN=${githubToken}`,
    '',
    '# Komodo',
    `AUTO_MERGE=${autoMerge}`,
    `MAX_REVIEW_CYCLES=${maxCycles}`,
    `DEFAULT_PROJECT_ID=${projectId}`,
    '# Multi-project: comma-separated project IDs or * for all user projects',
    '# Example: PROJECTS=id1,id2,id3  or  PROJECTS=*',
    'PROJECTS=',
    '',
    '# SonarQube',
    `ENABLE_SONAR=${enableSonar}`,
    `SONAR_TOKEN=${sonarToken}`,
    `SONAR_HOST_URL=${sonarHostUrl}`,
    `SONAR_PROJECT_KEY=${sonarProjectKey}`,
  ].join('\n');

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
    const mcpConfigPath = resolve(ROOT, 'skills', 'komodo-mcp', 'src', 'index.js');
    if (existsSync(mcpConfigPath)) {
      // Registrar komodo-mcp en settings.local.json del proyecto
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

      // Add komodo-mcp to MCP servers
      if (!settings.mcpServers) settings.mcpServers = {};
      settings.mcpServers['komodo-mcp'] = {
        command: 'node',
        args: [mcpConfigPath],
        env: {
          KOMODO_ROOT: ROOT,
        },
      };

      writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      ok('komodo-mcp registrado en Claude Code (.claude/settings.local.json)');
    }
  }

  // ═══════════════════════════════════════════
  // Resumen
  // ═══════════════════════════════════════════

  log(`\n${c.bold}${c.green}  🦎 Komodo configurado!${c.reset}\n`);
  log(`  Proyecto:  ${projectId || c.dim + '(no configurado)' + c.reset}`);
  log(`  Planner:   ${cliPlanner}`);
  log(`  Coder:     ${cliCoder}`);
  log(`  Reviewer:  ${cliReviewer}`);
  log(`  Auto-merge: ${autoMerge ? 'sí' : 'no'}`);
  log(`  Max cycles: ${maxCycles}`);
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
