import { spawn } from 'child_process';
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';
import { config } from '../config.js';
import { extractJSON } from '../utils/parser.js';
import { logger } from '../utils/logger.js';

const TMP_DIR = resolve(config.rootDir, '.tmp');

/**
 * Flags específicos de cada CLI para modo no-interactivo.
 * Solo claude está completamente soportado. Codex y Gemini son placeholders.
 */
const CLI_ADAPTERS = {
  claude: {
    buildArgs({ systemPrompt, userPrompt, mcpConfigPath, maxTurns, allowedTools, disallowedTools, model }) {
      const args = ['-p', userPrompt, '--output-format', 'json'];

      if (systemPrompt) args.push('--system-prompt', systemPrompt);
      if (mcpConfigPath) args.push('--mcp-config', mcpConfigPath, '--strict-mcp-config');
      if (maxTurns) args.push('--max-turns', String(maxTurns));
      if (model) args.push('--model', model);
      if (allowedTools?.length) args.push('--allowed-tools', ...allowedTools);
      if (disallowedTools?.length) args.push('--disallowed-tools', ...disallowedTools);

      // Modo autónomo: sin pedir permisos
      args.push('--permission-mode', 'bypassPermissions');

      return args;
    },
    parseOutput(stdout) {
      // Claude --output-format json emite líneas JSON, la última con type "result"
      const lines = stdout.trim().split('\n').filter(l => l.trim());

      let result = null;
      let cost = null;
      let turns = 0;

      for (const line of lines) {
        try {
          const msg = JSON.parse(line);

          if (msg.type === 'result') {
            result = msg.result;
            cost = msg.cost_usd ?? msg.costUsd ?? null;
            turns = msg.num_turns ?? msg.numTurns ?? 0;
          }
        } catch {
          // Línea no-JSON, ignorar
        }
      }

      return { rawResult: result, cost, turns };
    },
  },

  codex: {
    buildArgs({ systemPrompt, userPrompt, mcpConfigPath, maxTurns }) {
      // Codex CLI: codex -p "prompt" (ajustar cuando se conozcan los flags exactos)
      const args = ['--quiet', '--full-auto', userPrompt];
      return args;
    },
    parseOutput(stdout) {
      return { rawResult: stdout, cost: null, turns: 0 };
    },
  },

  gemini: {
    buildArgs({ systemPrompt, userPrompt, mcpConfigPath, maxTurns }) {
      // Gemini CLI: gemini -p "prompt" (ajustar cuando se conozcan los flags exactos)
      const args = ['-p', userPrompt];
      return args;
    },
    parseOutput(stdout) {
      return { rawResult: stdout, cost: null, turns: 0 };
    },
  },
};

/**
 * Genera un archivo temporal de configuración MCP para el CLI.
 *
 * @param {Object} mcpServers - { serverName: { command, args, env } }
 * @returns {string} Ruta al archivo temporal
 */
function generateMcpConfig(mcpServers) {
  if (!existsSync(TMP_DIR)) {
    mkdirSync(TMP_DIR, { recursive: true });
  }

  const configPath = resolve(TMP_DIR, `mcp-${randomUUID()}.json`);
  const mcpConfig = { mcpServers };

  writeFileSync(configPath, JSON.stringify(mcpConfig, null, 2), 'utf-8');
  return configPath;
}

/**
 * Construye la definición de MCPs para los agentes de Komodo.
 * Cada MCP es un proceso Node.js que se lanza como servidor.
 */
export function buildMcpServers(serverNames) {
  const definitions = {
    'planning-task-mcp': {
      command: 'node',
      args: [resolve(config.planningMcpDir, 'src', 'index.js')],
      env: {
        GOOGLE_APPLICATION_CREDENTIALS: config.googleCredentials,
        FIREBASE_DATABASE_URL: config.firebaseDatabaseUrl,
        DEFAULT_USER_ID: config.defaultUserId,
        DEFAULT_USER_NAME: config.defaultUserName,
      },
    },
    'github-mcp': {
      command: 'node',
      args: [resolve(config.githubMcpDir, 'src', 'index.js')],
      env: {
        ...(config.githubToken ? { GITHUB_TOKEN: config.githubToken } : {}),
      },
    },
    'memory-mcp': {
      command: 'node',
      args: [resolve(config.memoryMcpDir, 'src', 'index.js')],
      env: {},
    },
  };

  const servers = {};
  for (const name of serverNames) {
    if (!definitions[name]) {
      throw new Error(`MCP server "${name}" no definido. Disponibles: ${Object.keys(definitions).join(', ')}`);
    }
    servers[name] = definitions[name];
  }
  return servers;
}

/**
 * Lanza un proceso CLI y recoge su salida.
 *
 * @returns {Promise<string>} stdout completo
 */
function spawnCli(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    // En Windows con shell=true, Node.js auto-envuelve args con espacios en comillas dobles
    // pero NO escapa las comillas dobles embebidas dentro del arg.
    // Esto causa que cmd.exe rompa el parsing: un arg como
    //   'texto "valor-con-guion" más texto'
    // se convierte en:  "texto "valor-con-guion" más texto"
    // y cmd.exe ve "valor-con-guion" como un token separado.
    // Fix: escapar " como \" (el C runtime de Windows entiende \" dentro de strings quoted).
    const safeArgs = process.platform === 'win32'
      ? args.map(a => a.replace(/"/g, '\\"'))
      : args;

    const child = spawn(command, safeArgs, {
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
      shell: process.platform === 'win32',
    });

    let stdout = '';
    let stderr = '';

    // Idle timeout: se reinicia cada vez que el CLI produce output.
    // Si el CLI está activo (haciendo tool calls), nunca salta.
    // Solo mata el proceso si se queda completamente callado.
    const idleMs = options.idleTimeout || 180_000; // 3 min sin output = muerto
    let idleTimer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Idle timeout: ${command} lleva ${idleMs / 1000}s sin producir output`));
    }, idleMs);

    function resetIdleTimer() {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Idle timeout: ${command} lleva ${idleMs / 1000}s sin producir output`));
      }, idleMs);
    }

    child.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      resetIdleTimer(); // El CLI sigue vivo, reiniciar timer

      if (options.onOutput) {
        options.onOutput(text);
      }
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
      resetIdleTimer(); // stderr también cuenta como actividad
    });

    child.on('close', (code) => {
      clearTimeout(idleTimer);
      if (code === 0) {
        resolve(stdout);
      } else {
        const errMsg = stderr.trim() || stdout.trim() || `exit code ${code}`;
        reject(new Error(errMsg));
      }
    });

    child.on('error', (err) => {
      clearTimeout(idleTimer);
      reject(new Error(`No se pudo lanzar "${command}": ${err.message}`));
    });
  });
}

/**
 * Lanza un agente IA como subproceso CLI.
 *
 * @param {Object} options
 * @param {string} options.name - Nombre del agente para logs (PLANNER, CODER, REVIEWER)
 * @param {string} [options.cli] - CLI a usar (claude, codex, gemini). Default: según config
 * @param {string} options.systemPrompt - System prompt del agente
 * @param {string} options.userPrompt - Prompt con la tarea/instrucciones específicas
 * @param {string[]} [options.mcpServerNames] - Nombres de MCPs a conectar
 * @param {string} [options.cwd] - Directorio de trabajo
 * @param {number} [options.maxTurns=30] - Máximo de turnos del agente
 * @param {string[]} [options.allowedTools] - Tools permitidos
 * @param {string[]} [options.disallowedTools] - Tools prohibidos
 * @param {string} [options.model] - Modelo a usar
 * @param {number} [options.idleTimeout] - Idle timeout en ms (default: 180000 = 3min sin output)
 * @returns {Promise<{success: boolean, result: object|null, cost: number|null, turns: number, duration: number, error?: string}>}
 */
export async function runAgent({
  name,
  cli,
  systemPrompt,
  userPrompt,
  mcpServerNames = [],
  cwd,
  maxTurns = 30,
  allowedTools,
  disallowedTools,
  model,
  idleTimeout,
}) {
  // Determinar qué CLI usar
  const cliMap = { PLANNER: config.cliPlanner, CODER: config.cliCoder, REVIEWER: config.cliReviewer };
  const resolvedCli = cli || cliMap[name] || 'claude';

  const adapter = CLI_ADAPTERS[resolvedCli];
  if (!adapter) {
    return {
      success: false,
      result: null,
      cost: null,
      turns: 0,
      duration: 0,
      error: `CLI "${resolvedCli}" no soportado. Disponibles: ${Object.keys(CLI_ADAPTERS).join(', ')}`,
    };
  }

  const startTime = Date.now();
  let mcpConfigPath = null;

  try {
    // Generar config de MCPs si hay
    let mcpServers = {};
    if (mcpServerNames.length > 0) {
      mcpServers = buildMcpServers(mcpServerNames);
      mcpConfigPath = generateMcpConfig(mcpServers);
    }

    // Construir argumentos del CLI
    const args = adapter.buildArgs({
      systemPrompt,
      userPrompt,
      mcpConfigPath,
      maxTurns,
      allowedTools,
      disallowedTools,
      model,
    });

    logger.info(`Lanzando ${resolvedCli} CLI...`, name);

    // Lanzar el proceso
    const stdout = await spawnCli(resolvedCli, args, {
      cwd: cwd || config.rootDir,
      idleTimeout,
    });

    // Parsear la salida del CLI
    const { rawResult, cost, turns } = adapter.parseOutput(stdout);

    // Extraer JSON del resultado
    const result = extractJSON(rawResult);
    const duration = (Date.now() - startTime) / 1000;

    if (!result) {
      logger.warn('No se pudo extraer JSON de la respuesta', name);
      logger.warn(`Respuesta raw (primeros 500 chars): ${(rawResult || '').slice(0, 500)}`, name);
    }

    logger.success(`Completado en ${duration.toFixed(1)}s`, name);

    return {
      success: !!result,
      result,
      rawResult,
      cost,
      turns,
      duration: Math.round(duration * 10) / 10,
    };
  } catch (err) {
    const duration = (Date.now() - startTime) / 1000;
    logger.error(`Error después de ${duration.toFixed(1)}s: ${err.message}`, name);

    return {
      success: false,
      result: null,
      cost: null,
      turns: 0,
      duration: Math.round(duration * 10) / 10,
      error: err.message,
    };
  } finally {
    // Limpiar archivo temporal de MCP config
    if (mcpConfigPath) {
      try { unlinkSync(mcpConfigPath); } catch {}
    }
  }
}
