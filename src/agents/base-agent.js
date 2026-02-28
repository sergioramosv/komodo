import { spawn } from 'child_process';
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';
import { config } from '../config.js';
import { extractJSON } from '../utils/parser.js';
import { logger } from '../utils/logger.js';

const TMP_DIR = resolve(config.rootDir, '.tmp');

// ═══════════════════════════════════════════════════════════════════════
// CLI Adapters — how to talk to each AI CLI
//
// All prompts (system + user) are sent via stdin, NEVER as CLI args.
// This avoids shell escaping issues on Windows (cmd.exe) and any platform
// where long strings with quotes/special chars break argument parsing.
// ═══════════════════════════════════════════════════════════════════════

const CLI_ADAPTERS = {
  claude: {
    /**
     * Build CLI arguments. Prompts are NOT included here — they go via stdin.
     * Only short, safe flags go as CLI args.
     */
    buildArgs({ mcpConfigPath, maxTurns, allowedTools, disallowedTools, model }) {
      const args = ['--output-format', 'json'];

      if (mcpConfigPath) args.push('--mcp-config', mcpConfigPath, '--strict-mcp-config');
      if (maxTurns) args.push('--max-turns', String(maxTurns));
      if (model) args.push('--model', model);
      if (allowedTools?.length) args.push('--allowed-tools', ...allowedTools);
      if (disallowedTools?.length) args.push('--disallowed-tools', ...disallowedTools);

      args.push('--permission-mode', 'bypassPermissions');
      return args;
    },

    /**
     * Combine system prompt + user prompt into a single stdin payload.
     * Claude CLI reads from stdin when it detects a pipe (not a TTY).
     */
    buildStdin({ systemPrompt, userPrompt }) {
      if (systemPrompt) {
        return `${systemPrompt}\n\n---\n\n${userPrompt}`;
      }
      return userPrompt;
    },

    /**
     * Parse claude --output-format json output.
     * Emits JSON lines; the last one with type "result" has the answer.
     */
    parseOutput(stdout) {
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
          // Non-JSON line, skip
        }
      }

      return { rawResult: result, cost, turns };
    },
  },

  codex: {
    buildArgs({ mcpConfigPath, maxTurns }) {
      return ['--quiet', '--full-auto'];
    },
    buildStdin({ systemPrompt, userPrompt }) {
      if (systemPrompt) return `${systemPrompt}\n\n---\n\n${userPrompt}`;
      return userPrompt;
    },
    parseOutput(stdout) {
      return { rawResult: stdout, cost: null, turns: 0 };
    },
  },

  gemini: {
    buildArgs({ mcpConfigPath, maxTurns }) {
      return [];
    },
    buildStdin({ systemPrompt, userPrompt }) {
      if (systemPrompt) return `${systemPrompt}\n\n---\n\n${userPrompt}`;
      return userPrompt;
    },
    parseOutput(stdout) {
      return { rawResult: stdout, cost: null, turns: 0 };
    },
  },
};

// ═══════════════════════════════════════════════════════════════════════
// MCP config generation
// ═══════════════════════════════════════════════════════════════════════

/**
 * Write a temp MCP config JSON file for the CLI subprocess.
 * @param {Object} mcpServers - { serverName: { command, args, env } }
 * @returns {string} Path to the temp config file
 */
function generateMcpConfig(mcpServers) {
  if (!existsSync(TMP_DIR)) {
    mkdirSync(TMP_DIR, { recursive: true });
  }
  const configPath = resolve(TMP_DIR, `mcp-${randomUUID()}.json`);
  writeFileSync(configPath, JSON.stringify({ mcpServers }, null, 2), 'utf-8');
  return configPath;
}

/**
 * Build MCP server definitions for the agent subprocess.
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
      throw new Error(`MCP server "${name}" not defined. Available: ${Object.keys(definitions).join(', ')}`);
    }
    servers[name] = definitions[name];
  }
  return servers;
}

// ═══════════════════════════════════════════════════════════════════════
// Process spawning
//
// Key design: prompts go via stdin, never as CLI args.
// On Windows, shell: true is needed so cmd.exe can resolve .cmd files
// (e.g. claude.cmd from npm). But we never pass anything complex as an
// arg — only short flags like --output-format json.
// ═══════════════════════════════════════════════════════════════════════

/**
 * Spawn a CLI process, pipe stdinData, and collect stdout.
 *
 * @param {string}   command   - CLI to run (e.g. "claude")
 * @param {string[]} args      - Short, safe flags only
 * @param {Object}   options
 * @param {string}   [options.cwd]          - Working directory
 * @param {string}   [options.stdinData]    - Data to pipe to stdin (the prompt)
 * @param {number}   [options.idleTimeout]  - Kill if silent for this many ms (default 180s)
 * @param {Function} [options.onOutput]     - Callback for stdout chunks
 * @returns {Promise<string>} stdout
 */
function spawnCli(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
      // Windows needs shell to resolve .cmd files (claude.cmd, etc.)
      // Unix does not need shell.
      shell: process.platform === 'win32',
    });

    // Pipe prompt via stdin — this is the core of the fix.
    // By sending prompts through stdin instead of CLI args, we avoid
    // all shell escaping issues on every platform.
    if (options.stdinData) {
      child.stdin.write(options.stdinData);
      child.stdin.end();
    }

    let stdout = '';
    let stderr = '';

    // Idle timeout: resets every time the CLI produces output.
    // Only kills if the process goes completely silent.
    const idleMs = options.idleTimeout || 180_000;
    let idleTimer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Idle timeout: ${command} silent for ${idleMs / 1000}s`));
    }, idleMs);

    function resetIdle() {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Idle timeout: ${command} silent for ${idleMs / 1000}s`));
      }, idleMs);
    }

    child.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      resetIdle();
      if (options.onOutput) options.onOutput(text);
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
      resetIdle();
    });

    child.on('close', (code) => {
      clearTimeout(idleTimer);
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr.trim() || stdout.trim() || `exit code ${code}`));
      }
    });

    child.on('error', (err) => {
      clearTimeout(idleTimer);
      reject(new Error(`Failed to launch "${command}": ${err.message}`));
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════
// Public API — runAgent
// ═══════════════════════════════════════════════════════════════════════

/**
 * Launch an AI agent as a CLI subprocess.
 *
 * @param {Object}   options
 * @param {string}   options.name           - Agent name for logs (PLANNER, CODER, REVIEWER)
 * @param {string}   [options.cli]          - CLI override (claude, codex, gemini)
 * @param {string}   options.systemPrompt   - System instructions
 * @param {string}   options.userPrompt     - Task-specific prompt
 * @param {string[]} [options.mcpServerNames] - MCPs to connect
 * @param {string}   [options.cwd]          - Working directory
 * @param {number}   [options.maxTurns=30]  - Max agent turns
 * @param {string[]} [options.allowedTools]
 * @param {string[]} [options.disallowedTools]
 * @param {string}   [options.model]
 * @param {number}   [options.idleTimeout]  - Idle timeout ms (default 180000)
 * @returns {Promise<{success, result, rawResult, cost, turns, duration, error?}>}
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
  // Resolve which CLI to use
  const cliMap = {
    PLANNER: config.cliPlanner,
    CODER: config.cliCoder,
    REVIEWER: config.cliReviewer,
  };
  const resolvedCli = cli || cliMap[name] || 'claude';

  const adapter = CLI_ADAPTERS[resolvedCli];
  if (!adapter) {
    return {
      success: false,
      result: null,
      cost: null,
      turns: 0,
      duration: 0,
      error: `CLI "${resolvedCli}" not supported. Available: ${Object.keys(CLI_ADAPTERS).join(', ')}`,
    };
  }

  const startTime = Date.now();
  let mcpConfigPath = null;

  try {
    // Generate MCP config file if needed
    if (mcpServerNames.length > 0) {
      const mcpServers = buildMcpServers(mcpServerNames);
      mcpConfigPath = generateMcpConfig(mcpServers);
    }

    // Build CLI args (short flags only, no prompts)
    const args = adapter.buildArgs({
      mcpConfigPath,
      maxTurns,
      allowedTools,
      disallowedTools,
      model,
    });

    // Build stdin payload (system + user prompt combined)
    const stdinData = adapter.buildStdin({ systemPrompt, userPrompt });

    logger.info(`Launching ${resolvedCli} CLI (stdin pipe)...`, name);

    // Spawn the process and pipe the prompt via stdin
    const stdout = await spawnCli(resolvedCli, args, {
      cwd: cwd || config.rootDir,
      idleTimeout,
      stdinData,
    });

    // Parse CLI output
    const { rawResult, cost, turns } = adapter.parseOutput(stdout);
    const result = extractJSON(rawResult);
    const duration = (Date.now() - startTime) / 1000;

    if (!result) {
      logger.warn('Could not extract JSON from response', name);
      logger.warn(`Raw (first 500 chars): ${(rawResult || '').slice(0, 500)}`, name);
    }

    logger.success(`Done in ${duration.toFixed(1)}s`, name);

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
    logger.error(`Error after ${duration.toFixed(1)}s: ${err.message}`, name);

    return {
      success: false,
      result: null,
      cost: null,
      turns: 0,
      duration: Math.round(duration * 10) / 10,
      error: err.message,
    };
  } finally {
    if (mcpConfigPath) {
      try { unlinkSync(mcpConfigPath); } catch {}
    }
  }
}
