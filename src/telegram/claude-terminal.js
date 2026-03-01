import { spawn } from 'child_process';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { withAuth } from './auth.js';

const AGENT = 'TELEGRAM';
const MAX_MESSAGE_LENGTH = 4096;

/** Active sessions per chat — prevents concurrent Claude calls in the same chat. */
const activeSessions = new Map();

// ═══════════════════════════════════════════════════════════════════════
// Claude CLI spawning
// ═══════════════════════════════════════════════════════════════════════

/**
 * Spawns Claude CLI with a prompt and returns the text response.
 * Uses --output-format json to parse the result reliably, same as base-agent.
 * Prompt is sent via stdin to avoid shell escaping issues on Windows.
 *
 * @param {string} prompt - User's message
 * @param {Object} [options]
 * @param {number} [options.timeout] - Total timeout in ms
 * @returns {Promise<string>} Claude's text response
 */
function spawnClaude(prompt, options = {}) {
  const timeout = options.timeout || config.telegramClaudeTimeout;

  return new Promise((resolve, reject) => {
    let settled = false;

    function settle(fn, value) {
      if (settled) return;
      settled = true;
      fn(value);
    }

    const args = [
      '--output-format', 'json',
      '--max-turns', '3',
      '--permission-mode', 'bypassPermissions',
    ];

    const child = spawn('claude', args, {
      cwd: config.rootDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
      shell: process.platform === 'win32',
    });

    // Pipe prompt via stdin
    child.stdin.write(prompt);
    child.stdin.end();

    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      settle(reject, new Error(`Timeout: Claude Code no respondio en ${timeout / 1000}s`));
    }, timeout);

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        settle(resolve, parseClaudeOutput(stdout));
      } else {
        settle(reject, new Error(stderr.trim() || stdout.trim() || `exit code ${code}`));
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      settle(reject, new Error(`No se pudo ejecutar Claude Code: ${err.message}`));
    });
  });
}

/**
 * Parses Claude CLI --output-format json output.
 * Looks for the last "result" JSON line and extracts the text.
 *
 * @param {string} stdout - Raw stdout from Claude CLI
 * @returns {string} Extracted text response
 */
function parseClaudeOutput(stdout) {
  const lines = stdout.trim().split('\n').filter(l => l.trim());
  let resultText = '';

  for (const line of lines) {
    try {
      const msg = JSON.parse(line);
      if (msg.type === 'result' && msg.result) {
        resultText = msg.result;
      }
    } catch {
      // Non-JSON line, skip
    }
  }

  return resultText || stdout.trim();
}

// ═══════════════════════════════════════════════════════════════════════
// Response formatting for Telegram
// ═══════════════════════════════════════════════════════════════════════

/**
 * Converts Claude's markdown response to Telegram HTML format.
 * HTML parse_mode is more forgiving than MarkdownV2 and handles
 * code blocks, bold, italic naturally.
 *
 * @param {string} text - Claude's raw text response
 * @returns {string} HTML-formatted text for Telegram
 */
function markdownToHtml(text) {
  // Escape HTML entities first (before adding our own tags)
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks: ```lang\ncode\n``` → <pre><code class="language-lang">code</code></pre>
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    return lang
      ? `<pre><code class="language-${lang}">${code.trimEnd()}</code></pre>`
      : `<pre>${code.trimEnd()}</pre>`;
  });

  // Inline code: `code` → <code>code</code>
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold: **text** → <b>text</b>
  html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

  // Italic: *text* → <i>text</i> (only single *, after bold ** is handled)
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<i>$1</i>');

  return html;
}

// ═══════════════════════════════════════════════════════════════════════
// Message chunking
// ═══════════════════════════════════════════════════════════════════════

/**
 * Splits a message into chunks that fit Telegram's 4096-char limit.
 * Tries to split at newlines, then spaces, to preserve readability.
 *
 * @param {string} text - Full response text
 * @returns {string[]} Array of chunks, each <= MAX_MESSAGE_LENGTH
 */
function splitMessage(text) {
  if (text.length <= MAX_MESSAGE_LENGTH) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_MESSAGE_LENGTH) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a newline within the limit
    let splitIndex = remaining.lastIndexOf('\n', MAX_MESSAGE_LENGTH);
    if (splitIndex <= 0) {
      // No newline found, try a space
      splitIndex = remaining.lastIndexOf(' ', MAX_MESSAGE_LENGTH);
    }
    if (splitIndex <= 0) {
      // No good split point, hard cut
      splitIndex = MAX_MESSAGE_LENGTH;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).replace(/^\n/, '');
  }

  return chunks;
}

// ═══════════════════════════════════════════════════════════════════════
// Message handler registration
// ═══════════════════════════════════════════════════════════════════════

/**
 * Registers the free-text terminal handler on the bot.
 * Non-command messages are interpreted as Claude Code prompts.
 * Responses are formatted as HTML and split into chunks if needed.
 *
 * @param {import('node-telegram-bot-api')} bot
 */
export function registerTerminalHandler(bot) {
  bot.on('message', withAuth(async (msg) => {
    // Skip non-text messages
    if (!msg.text) return;

    // Skip commands — those are handled by registerCommands
    if (msg.text.startsWith('/')) return;

    const chatId = msg.chat.id;
    const prompt = msg.text.trim();
    if (!prompt) return;

    // Prevent concurrent sessions per chat
    if (activeSessions.has(chatId)) {
      bot.sendMessage(chatId, 'Ya hay un prompt en proceso. Espera la respuesta antes de enviar otro.')
        .catch(err => logger.error(`sendMessage error: ${err.message}`, AGENT));
      return;
    }

    activeSessions.set(chatId, true);

    // Send typing indicator (Telegram clears it after ~5s, so we refresh it)
    let typingInterval = null;
    try {
      await bot.sendChatAction(chatId, 'typing');
      typingInterval = setInterval(() => {
        bot.sendChatAction(chatId, 'typing').catch(() => {});
      }, 4000);
    } catch {
      // Typing indicator is non-critical
    }

    try {
      logger.info(`Claude terminal prompt from ${msg.from.id}: ${prompt.slice(0, 100)}`, AGENT);

      const response = await spawnClaude(prompt);

      if (!response) {
        await bot.sendMessage(chatId, 'Claude Code no devolvio respuesta.');
        return;
      }

      // Format and send response
      const html = markdownToHtml(response);
      const chunks = splitMessage(html);

      for (const chunk of chunks) {
        try {
          await bot.sendMessage(chatId, chunk, { parse_mode: 'HTML' });
        } catch {
          // HTML parse failed — fallback to plain text for this chunk
          const plainChunk = response.length <= MAX_MESSAGE_LENGTH
            ? response
            : chunk.replace(/<[^>]+>/g, '');
          await bot.sendMessage(chatId, plainChunk);
        }
      }

      logger.info(`Claude terminal response sent (${response.length} chars, ${chunks.length} chunk(s))`, AGENT);
    } catch (err) {
      logger.error(`Claude terminal error: ${err.message}`, AGENT);

      let errorMsg;
      if (err.message.includes('Timeout')) {
        errorMsg = `Timeout: Claude Code no respondio en el tiempo limite. Intenta con un prompt mas corto.`;
      } else if (err.message.includes('No se pudo ejecutar')) {
        errorMsg = `Claude Code no esta disponible. Verifica que este instalado y en el PATH.`;
      } else {
        errorMsg = `Error al ejecutar Claude Code: ${err.message}`;
      }

      bot.sendMessage(chatId, errorMsg)
        .catch(e => logger.error(`sendMessage error: ${e.message}`, AGENT));
    } finally {
      if (typingInterval) clearInterval(typingInterval);
      activeSessions.delete(chatId);
    }
  }));
}
