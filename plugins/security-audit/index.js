/**
 * security-audit plugin — scans changed files for insecure patterns.
 *
 * Detects:
 * - Hardcoded secrets (passwords, tokens, API keys assigned to literals)
 * - eval() usage
 * - exec() usage (child_process)
 * - TODO/FIXME comments referencing passwords or credentials
 *
 * Position: before-review
 * The issues surface in the Reviewer prompt as mandatory items to address.
 *
 * ─── Plugin Authoring Guide ─────────────────────────────────────────────────
 *
 * Use this plugin as a reference to create new Komodo plugins.
 *
 * 1. Create a directory under `plugins/` with your plugin name (e.g. `plugins/my-plugin/`).
 * 2. Add an `index.js` that default-exports an object with the Plugin interface:
 *
 *    export default {
 *      name: 'my-plugin',                    // unique identifier
 *      role: 'What the plugin does',         // human-readable description
 *      position: 'before-review',            // 'before-review' | 'after-review' | 'after-merge'
 *      async execute(context) {              // main entry point
 *        // context: { task, prNumber, branchName, repoPath, repo, changedFiles, previousPluginOutputs }
 *        return {
 *          success: true,
 *          issues: [],       // strings — shown as mandatory items in Reviewer prompt
 *          suggestions: [],  // strings — non-blocking improvement hints
 *          data: {},         // arbitrary payload for downstream plugins
 *        };
 *      },
 *    };
 *
 * 3. Enable it in `.env`:  ENABLED_PLUGINS=security-audit,my-plugin
 * 4. Plugins at 'before-review' feed issues into the Reviewer; errors are caught
 *    so a failing plugin never blocks the pipeline.
 *
 * See `src/plugins/plugin-interface.js` for the full type definitions.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

/** @type {Array<{ id: string, pattern: RegExp, message: (match: string, file: string) => string }>} */
const SECURITY_PATTERNS = [
  {
    id: 'hardcoded-secret',
    pattern: /(?:password|passwd|secret|token|api_?key|auth_?key)\s*[:=]\s*['"`][^'"`\s]{4,}['"`]/gi,
    message: (match, file) => `Hardcoded secret detected in ${file}: \`${match.trim()}\``,
  },
  {
    id: 'eval-usage',
    pattern: /\beval\s*\(/g,
    message: (_match, file) => `eval() usage detected in ${file} — arbitrary code execution risk`,
  },
  {
    id: 'exec-usage',
    pattern: /\bexec\s*\(\s*(?:[^)]*\+|`[^`]*\$\{)/g,
    message: (_match, file) => `Dynamic exec() call detected in ${file} — command injection risk`,
  },
  {
    id: 'todo-password',
    pattern: /\/\/\s*(?:TODO|FIXME)[^\n]*(?:password|secret|credential|token)/gi,
    message: (match, file) => `Security TODO left unresolved in ${file}: \`${match.trim()}\``,
  },
];

/** Extensions to scan (binary files are skipped). */
const SCANNABLE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.py', '.rb', '.go', '.java', '.php', '.sh',
  '.env.example', '.yml', '.yaml', '.json', '.toml',
]);

/**
 * Returns true if the file extension is in the scannable list.
 * @param {string} filePath
 */
function isScannable(filePath) {
  const dotIdx = filePath.lastIndexOf('.');
  if (dotIdx === -1) return false;
  return SCANNABLE_EXTENSIONS.has(filePath.slice(dotIdx).toLowerCase());
}

/**
 * Scans a single file for security patterns.
 * Returns an array of issue strings found.
 *
 * @param {string} filePath - Absolute path to the file
 * @param {string} displayName - Relative path shown in issue messages
 * @returns {string[]}
 */
function scanFile(filePath, displayName) {
  let content;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }

  const issues = [];
  for (const { pattern, message } of SECURITY_PATTERNS) {
    // Reset stateful regex
    pattern.lastIndex = 0;
    const matches = content.match(pattern);
    if (matches) {
      for (const match of matches) {
        issues.push(message(match, displayName));
      }
    }
  }
  return issues;
}

/** @type {import('../../src/plugins/plugin-interface.js').Plugin} */
const securityAuditPlugin = {
  name: 'security-audit',
  role: 'Scans changed files for insecure patterns: hardcoded secrets, eval(), dynamic exec(), and unresolved security TODOs',
  position: 'before-review',

  /**
   * @param {import('../../src/plugins/plugin-interface.js').PluginContext} context
   * @returns {Promise<import('../../src/plugins/plugin-interface.js').PluginResult>}
   */
  async execute(context) {
    const { changedFiles = [], repoPath } = context;
    const issues = [];
    const suggestions = [];
    const scannedFiles = [];

    for (const relPath of changedFiles) {
      if (!isScannable(relPath)) continue;

      const absPath = repoPath ? join(repoPath, relPath) : relPath;
      if (!existsSync(absPath)) continue;

      const fileIssues = scanFile(absPath, relPath);
      if (fileIssues.length > 0) {
        issues.push(...fileIssues);
      }
      scannedFiles.push(relPath);
    }

    if (scannedFiles.length === 0) {
      suggestions.push('No scannable source files found in changed files list');
    }

    return {
      success: true,
      issues,
      suggestions,
      data: {
        scannedFiles,
        patternsChecked: SECURITY_PATTERNS.map(p => p.id),
      },
    };
  },
};

export default securityAuditPlugin;
