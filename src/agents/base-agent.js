import { spawn } from 'child_process';
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';
import { config } from '../config.js';
import { extractJSON } from '../utils/parser.js';
import { logger } from '../utils/logger.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { checkAndEmitRateLimit } from './rate-limit-detector.js';

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
    /**
     * OpenAI Codex CLI (codex).
     * - `codex exec -` reads prompt from stdin
     * - `--json` enables JSON Lines output for events
     * - `--full-auto` enables workspace-write + on-request approvals
     * - `--dangerously-bypass-approvals-and-sandbox` disables all safety checks
     * - MCP is configured via ~/.codex/config.toml, NOT via CLI flags
     *   We generate a temp config.toml if mcpServerNames are provided.
     */
    buildArgs({ model }) {
      const args = ['exec', '--json', '--full-auto'];
      if (model) args.push('-m', model);
      // Codex reads prompt from stdin when positional arg is `-`
      args.push('-');
      return args;
    },
    buildStdin({ systemPrompt, userPrompt }) {
      if (systemPrompt) return `${systemPrompt}\n\n---\n\n${userPrompt}`;
      return userPrompt;
    },
    /**
     * Parse codex --json output.
     * Codex emits JSON Lines events. Look for the last message content.
     */
    parseOutput(stdout) {
      const lines = stdout.trim().split('\n').filter(l => l.trim());
      let result = null;

      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          // Codex events have different shapes; extract text from message events
          if (msg.type === 'message' && msg.content) {
            result = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
          } else if (msg.message) {
            result = typeof msg.message === 'string' ? msg.message : JSON.stringify(msg.message);
          }
        } catch {
          // Non-JSON line — might be the raw text output
          if (!result && line.trim()) result = line.trim();
        }
      }

      return { rawResult: result || stdout, cost: null, turns: 0 };
    },
  },

  gemini: {
    /**
     * Google Gemini CLI (@google/gemini-cli).
     * - Reads prompt from stdin pipe (like: echo "prompt" | gemini)
     * - `--output-format json` for structured output
     * - `-m` for model selection
     * - `--yolo` for auto-approve all tool calls
     * - MCP is configured via settings.json, NOT via CLI flags
     *   We write a temp settings.json with MCP servers.
     */
    buildArgs({ model }) {
      const args = ['--output-format', 'json', '--yolo'];
      if (model) args.push('-m', model);
      return args;
    },
    buildStdin({ systemPrompt, userPrompt }) {
      if (systemPrompt) return `${systemPrompt}\n\n---\n\n${userPrompt}`;
      return userPrompt;
    },
    /**
     * Parse gemini --output-format json output.
     * Try to find a JSON result, or fall back to raw text.
     */
    parseOutput(stdout) {
      const lines = stdout.trim().split('\n').filter(l => l.trim());
      let result = null;

      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          // Look for result-like fields
          if (msg.result) {
            result = typeof msg.result === 'string' ? msg.result : JSON.stringify(msg.result);
          } else if (msg.response) {
            result = typeof msg.response === 'string' ? msg.response : JSON.stringify(msg.response);
          } else if (msg.text) {
            result = msg.text;
          }
        } catch {
          // Non-JSON line
          if (!result && line.trim()) result = line.trim();
        }
      }

      return { rawResult: result || stdout, cost: null, turns: 0 };
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
    ...(config.enableBrowserMcp ? {
      'chrome-devtools': {
        command: 'npx',
        args: [
          '-y', 'chrome-devtools-mcp@latest',
          `--browserUrl=http://127.0.0.1:${config.chromeDebuggerPort}`,
        ],
        env: {},
      },
    } : {}),
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
 * Supports two timeout modes:
 * - idleTimeout: kills if no stdout/stderr for N ms (good for Planner/Reviewer)
 * - totalTimeout: kills after N ms total regardless of output (good for Coder)
 *
 * On Windows, stdout from child processes can be fully buffered by cmd.exe,
 * so the idle timer never resets even though the process IS working.
 * Use totalTimeout for long-running agents like the Coder.
 *
 * @param {string}   command   - CLI to run (e.g. "claude")
 * @param {string[]} args      - Short, safe flags only
 * @param {Object}   options
 * @param {string}   [options.cwd]          - Working directory
 * @param {string}   [options.stdinData]    - Data to pipe to stdin (the prompt)
 * @param {number}   [options.idleTimeout]  - Kill if silent for this many ms (default 600s)
 * @param {number}   [options.totalTimeout] - Kill after this many ms total (overrides idleTimeout)
 * @param {Function} [options.onOutput]     - Callback for stdout chunks
 * @param {Function} [options.onStderr]     - Callback for stderr chunks
 * @returns {Promise<string>} stdout
 */
function spawnCli(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;

    function settle(fn, value) {
      if (settled) return;
      settled = true;
      fn(value);
    }

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

    // Timeout strategy: totalTimeout OR idleTimeout (not both)
    let idleTimer = null;
    let totalTimer = null;

    if (options.totalTimeout) {
      // Total timeout: hard limit on entire process duration.
      // Use this for agents like Coder where Windows stdout buffering
      // prevents idle timer from resetting.
      totalTimer = setTimeout(() => {
        child.kill('SIGTERM');
        settle(reject, new Error(`Total timeout: ${command} exceeded ${options.totalTimeout / 1000}s`));
      }, options.totalTimeout);
    } else {
      // Idle timeout: resets every time the CLI produces output.
      const idleMs = options.idleTimeout || 600_000;

      function startIdle() {
        return setTimeout(() => {
          child.kill('SIGTERM');
          settle(reject, new Error(`Idle timeout: ${command} silent for ${idleMs / 1000}s`));
        }, idleMs);
      }

      idleTimer = startIdle();

      // Save resetIdle on options so stdout/stderr handlers can use it
      options._resetIdle = () => {
        clearTimeout(idleTimer);
        idleTimer = startIdle();
      };
    }

    child.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      if (options._resetIdle) options._resetIdle();
      if (options.onOutput) options.onOutput(text);
    });

    child.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      if (options._resetIdle) options._resetIdle();
      if (options.onStderr) options.onStderr(text);
    });

    child.on('close', (code) => {
      clearTimeout(idleTimer);
      clearTimeout(totalTimer);
      if (code === 0) {
        settle(resolve, stdout);
      } else {
        settle(reject, new Error(stderr.trim() || stdout.trim() || `exit code ${code}`));
      }
    });

    child.on('error', (err) => {
      clearTimeout(idleTimer);
      clearTimeout(totalTimer);
      settle(reject, new Error(`Failed to launch "${command}": ${err.message}`));
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
 * @param {number}   [options.idleTimeout]  - Idle timeout ms (default 600000)
 * @param {number}   [options.totalTimeout] - Total timeout ms (overrides idleTimeout, use for Coder on Windows)
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
  totalTimeout,
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
    // Generate MCP config file if needed (only works with Claude's --mcp-config)
    if (mcpServerNames.length > 0) {
      const mcpServers = buildMcpServers(mcpServerNames);
      mcpConfigPath = generateMcpConfig(mcpServers);

      // Warn if using non-Claude CLI — they don't support --mcp-config
      if (resolvedCli !== 'claude') {
        logger.warn(
          `${resolvedCli} does not support --mcp-config. MCP servers must be configured globally.`,
          name
        );
      }
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

    // Progress logging: parse JSON lines from Claude's --output-format json
    // to log what the agent is doing in real time.
    // Also emits agent:output events for the dashboard live log.
    const onOutput = (chunk) => {
      for (const line of chunk.split('\n')) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          // Claude JSON lines: log tool uses for progress visibility
          if (msg.type === 'assistant' && msg.message?.content) {
            const toolUses = msg.message.content.filter(c => c.type === 'tool_use');
            for (const tu of toolUses) {
              logger.info(`[tool] ${tu.name}`, name);
              eventBus.emitEvent(EVENT_TYPES.AGENT_OUTPUT, {
                agentName: name,
                metadata: {
                  kind: 'tool',
                  tool: tu.name,
                  input: tu.input ? JSON.stringify(tu.input).slice(0, 200) : '',
                },
              });
            }
            const textBlocks = msg.message.content.filter(c => c.type === 'text' && c.text);
            for (const tb of textBlocks) {
              const preview = tb.text.slice(0, 200).replace(/\n/g, ' ');
              logger.info(`[text] ${preview.slice(0, 120)}${tb.text.length > 120 ? '...' : ''}`, name);
              eventBus.emitEvent(EVENT_TYPES.AGENT_OUTPUT, {
                agentName: name,
                metadata: { kind: 'text', text: preview },
              });
            }
          }
        } catch {
          // Non-JSON line, skip
        }
      }
    };

    // Rate limit detection on stderr (transparent — no-op if no match)
    const onStderr = (chunk) => {
      checkAndEmitRateLimit(chunk, resolvedCli, name);
    };

    // Spawn the process and pipe the prompt via stdin
    const stdout = await spawnCli(resolvedCli, args, {
      cwd: cwd || config.rootDir,
      idleTimeout,
      totalTimeout,
      stdinData,
      onOutput,
      onStderr,
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

    // Check if the error itself contains rate limit signals
    checkAndEmitRateLimit(err.message, resolvedCli, name);

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
